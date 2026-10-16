#!/usr/bin/env bash
# PoC #343 task 5: a series of taps, each with the app process killed first (am kill, empty pidof).
# Usage: t5-cold-series.sh <evidence-prefix> <W:row> ... where W is C or D and row is t1|t2|t3
# Streams the PoC log tags to <prefix>-logcat.log for the whole series.
set -uo pipefail
P="$1"; shift; here="$(cd "$(dirname "$0")" && pwd)"
PKG=com.callstackincubator.voltraexample
declare -A YC=([t1]=900 [t2]=988 [t3]=1076 [sw]=1157) YD=([t1]=290 [t2]=378 [t3]=466 [sw]=547)
: > "$P-steps.txt"; adb logcat -c
adb logcat -v epoch -s DynamicWidgetState VoltraClientGlanceWidget VoltraJSRenderer Poc343Tap ActivityManager:I > "$P-raw.log" &
LC=$!
for spec in "$@"; do
  W="${spec%%:*}"; row="${spec##*:}"
  if [ "$W" = C ]; then y=${YC[$row]}; else y=${YD[$row]}; fi
  "$here/t5-page.sh" "$W" >> "$P-steps.txt" || { echo "page $W not found, stopping"; break; }
  "$here/t5-kill.sh" 55 | tee -a "$P-steps.txt"
  echo "$(date +%T) $spec pidof='$(adb shell pidof $PKG | tr -d '\r')'" | tee -a "$P-steps.txt"
  "$here/t5-tap.sh" "cold-$W-$row" 200 "$y"
  sleep 8
  "$here/t5-checked.sh" >> "$P-steps.txt"
done
kill $LC
grep -E 'DynamicWidgetState|VoltraClientGlanceWidget|VoltraJSRenderer|Poc343Tap|ActivityManager.*voltraexample' "$P-raw.log" > "$P-logcat.log"; rm -f "$P-raw.log"
