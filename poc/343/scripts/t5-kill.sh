#!/usr/bin/env bash
# PoC #343 task 5: "killed" = HOME already pressed, Glance sessions over, `am kill`, empty `pidof`.
# Never `am force-stop` (Android 15 disables the widgets). Retries while a live SessionWorker keeps
# the process unkillable. Usage: t5-kill.sh [initial-wait-seconds]
set -uo pipefail
PKG=com.callstackincubator.voltraexample
sleep "${1:-0}"
for i in 1 2 3 4 5 6; do
  adb shell am kill $PKG; sleep 2
  pid=$(adb shell pidof $PKG | tr -d '\r')
  if [ -z "$pid" ]; then echo "$(date +%T) killed: pidof empty after attempt $i"; exit 0; fi
  echo "$(date +%T) attempt $i: pid $pid still alive (a Glance session is probably running); waiting 15 s"
  sleep 15
done
echo "process survived am kill"; exit 1
