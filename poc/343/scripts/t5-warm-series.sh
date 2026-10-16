#!/usr/bin/env bash
# PoC #343 task 5: warm latency series. Usage:
#   t5-warm-series.sh session <prefix> C|D <taps>    taps 4 s apart on rows t1..t3 (the first tap opens a session)
#   t5-warm-series.sh process <prefix> <rounds>      per round: tap C, tap D, then 65 s idle (sessions expire)
set -uo pipefail
mode="$1"; P="$2"; here="$(cd "$(dirname "$0")" && pwd)"
PKG=com.callstackincubator.voltraexample
declare -A YC=([t1]=900 [t2]=988 [t3]=1076) YD=([t1]=290 [t2]=378 [t3]=466)
rows=(t1 t2 t3)
: > "$P-steps.txt"; adb logcat -c
adb logcat -v epoch -s DynamicWidgetState VoltraClientGlanceWidget VoltraJSRenderer Poc343Tap ActivityManager:I > "$P-raw.log" &
LC=$!
y() { if [ "$1" = C ]; then echo ${YC[$2]}; else echo ${YD[$2]}; fi; }
if [ "$mode" = session ]; then
  W="$3"; n="$4"
  "$here/t5-page.sh" "$W" >> "$P-steps.txt" || { kill $LC; exit 1; }
  for i in $(seq 1 "$n"); do
    r=${rows[$(( (i - 1) % 3 ))]}
    "$here/t5-tap.sh" "warmsession-$W-$i-$r" 200 "$(y "$W" "$r")"; sleep 4
  done
else
  n="$3"
  for i in $(seq 1 "$n"); do
    r=${rows[$(( (i - 1) % 3 ))]}
    for W in C D; do
      "$here/t5-page.sh" "$W" >> "$P-steps.txt" || { echo "page $W not found"; break 2; }
      echo "$(date +%T) round $i $W pid=$(adb shell pidof $PKG | tr -d '\r')" >> "$P-steps.txt"
      "$here/t5-tap.sh" "warmprocess-$W-$i-$r" 200 "$(y "$W" "$r")"; sleep 4
    done
    [ "$i" -lt "$n" ] && sleep 65
  done
fi
sleep 3; kill $LC
grep -E 'DynamicWidgetState|VoltraClientGlanceWidget|VoltraJSRenderer|Poc343Tap|ActivityManager.*voltraexample' "$P-raw.log" > "$P-logcat.log"; rm -f "$P-raw.log"
