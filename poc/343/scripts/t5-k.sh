#!/usr/bin/env bash
# PoC #343 task 5, concurrency cases for both widgets (needs a live Appduct session).
#   K1: rapid double tap on row t1 in one adb shell call.
#   K3: interactDelayMs=1500, tap t2 then t3 ~0.3 s apart (inside the first tap's window).
# Usage: t5-k.sh <evidence-prefix>
set -uo pipefail
P="$1"; here="$(cd "$(dirname "$0")" && pwd)"; EX="$here/../../../example"
A() { (cd "$EX" && appduct tools call "$1" --input "$2" 2>&1 | tail -1); }
log() { echo "$(date +%T) $*" | tee -a "$P-steps.txt"; }
: > "$P-steps.txt"; adb logcat -c
(cd "$EX" && appduct sessions ls 2>&1 | grep -q active) || { echo "no active Appduct session"; exit 1; }
log "flags: $(A android_set_dynamic_widget_state_flags '{"flags":{"precedence":null,"scope":null,"interactDelayMs":null}}')"
log "reset C: $(A android_reset_dynamic_widget_state '{"appWidgetId":4}') D: $(A android_reset_dynamic_widget_state '{"appWidgetId":5}')"
for W in C D; do
  if [ $W = C ]; then y1=900; y2=988; y3=1076; awid=4; else y1=290; y2=378; y3=466; awid=5; fi
  "$here/t5-page.sh" $W >/dev/null || exit 1
  sleep 2
  adb shell "log -t Poc343Tap TAP K1-$W-double; input tap 200 $y1; input tap 200 $y1"
  sleep 4
  log "K1 $W checked:"; "$here/t5-checked.sh" | tee -a "$P-steps.txt"; adb exec-out screencap -p > "$P-K1-$W.png"
  log "K1 $W state: $(A android_read_dynamic_widget_state "{\"appWidgetId\":$awid}")"
done
log "flags: $(A android_set_dynamic_widget_state_flags '{"flags":{"interactDelayMs":1500}}')"
for W in C D; do
  if [ $W = C ]; then y2=988; y3=1076; awid=4; else y2=378; y3=466; awid=5; fi
  "$here/t5-page.sh" $W >/dev/null || exit 1
  sleep 2
  adb shell "log -t Poc343Tap TAP K3-$W-t2; input tap 200 $y2; sleep 0.3; log -t Poc343Tap TAP K3-$W-t3; input tap 200 $y3"
  sleep 6
  log "K3 $W checked:"; "$here/t5-checked.sh" | tee -a "$P-steps.txt"; adb exec-out screencap -p > "$P-K3-$W.png"
  log "K3 $W state: $(A android_read_dynamic_widget_state "{\"appWidgetId\":$awid}")"
done
log "flags: $(A android_set_dynamic_widget_state_flags '{"flags":{"interactDelayMs":null}}')"
"$here/t5-logcat.sh" > "$P-logcat.log"
