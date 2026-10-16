#!/usr/bin/env bash
# PoC #343 task 8: latency and cold series for widgets C, D and H in one script (t5-warm-series.sh
# and t5-cold-series.sh only know C and D). Rows: t1|t2|t3; launcher pages via t5-page.sh.
#   t8-series.sh session <prefix> <W> <taps>         taps 4 s apart (the first one opens a session)
#   t8-series.sh process <prefix> <rounds> <W>...     per round one tap per widget, then 65 s idle
#   t8-series.sh cold <prefix> <W:row>...             each tap after HOME, session end, am kill, empty pidof
# Streams the PoC log tags to <prefix>-logcat.log. Never `am force-stop`.
set -uo pipefail
mode="$1"; P="$2"; shift 2; here="$(cd "$(dirname "$0")" && pwd)"
PKG=com.callstackincubator.voltraexample
declare -A YC=([t1]=900 [t2]=988 [t3]=1076) YDH=([t1]=290 [t2]=378 [t3]=466)
rows=(t1 t2 t3)
y() { if [ "$1" = C ]; then echo "${YC[$2]}"; else echo "${YDH[$2]}"; fi; }
: > "$P-steps.txt"; adb logcat -c
adb logcat -v epoch -s DynamicWidgetState VoltraClientGlanceWidget VoltraJSRenderer Poc343Tap ActivityManager:I > "$P-raw.log" &
LC=$!
case "$mode" in
session)
  W="$1"; n="$2"
  "$here/t5-page.sh" "$W" >> "$P-steps.txt" || { kill $LC; exit 1; }
  for i in $(seq 1 "$n"); do
    r=${rows[$(( (i - 1) % 3 ))]}
    "$here/t5-tap.sh" "warmsession-$W-$i-$r" 200 "$(y "$W" "$r")"; sleep 4
  done ;;
process)
  n="$1"; shift
  for i in $(seq 1 "$n"); do
    r=${rows[$(( (i - 1) % 3 ))]}
    for W in "$@"; do
      "$here/t5-page.sh" "$W" >> "$P-steps.txt" || { echo "page $W not found"; break 2; }
      echo "$(date +%T) round $i $W pid=$(adb shell pidof $PKG | tr -d '\r')" >> "$P-steps.txt"
      "$here/t5-tap.sh" "warmprocess-$W-$i-$r" 200 "$(y "$W" "$r")"; sleep 4
    done
    [ "$i" -lt "$n" ] && sleep 65
  done ;;
cold)
  for spec in "$@"; do
    W="${spec%%:*}"; row="${spec##*:}"
    "$here/t5-page.sh" "$W" >> "$P-steps.txt" || { echo "page $W not found, stopping"; break; }
    "$here/t5-kill.sh" 55 | tee -a "$P-steps.txt"
    echo "$(date +%T) $spec pidof='$(adb shell pidof $PKG | tr -d '\r')'" | tee -a "$P-steps.txt"
    "$here/t5-tap.sh" "cold-$W-$row" 200 "$(y "$W" "$row")"
    sleep 8
    "$here/t5-checked.sh" >> "$P-steps.txt"
  done ;;
*) echo "unknown mode $mode"; kill $LC; exit 2 ;;
esac
sleep 3; kill $LC
grep -E 'DynamicWidgetState|VoltraClientGlanceWidget|VoltraJSRenderer|Poc343Tap|ActivityManager.*voltraexample' "$P-raw.log" > "$P-logcat.log"; rm -f "$P-raw.log"
