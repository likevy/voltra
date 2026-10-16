#!/usr/bin/env bash
# PoC #343 task 5, demo step D4: two placements of TodoStateWidget (awid 4 on launcher page 2,
# the second one on page 4). Tick t1 in placement 1 under scope=placement, then under
# scope=widgetScope, and record both placements. Needs a live Appduct session.
# Usage: t5-d4.sh <evidence-prefix> <appWidgetId of placement 2>
set -uo pipefail
P="$1"; AW2="$2"; here="$(cd "$(dirname "$0")" && pwd)"; EX="$here/../../../example"
A() { (cd "$EX" && appduct tools call "$1" --input "$2" 2>&1 | tail -1); }
log() { echo "$(date +%T) $*" | tee -a "$P-steps.txt"; }
page() { adb shell input keyevent HOME; sleep 1.5; adb shell input keyevent HOME; sleep 1.5; for i in $(seq 1 "$1"); do adb shell input swipe 900 1200 100 1200 300; sleep 1.5; done; }
snap() {
  sleep 3
  page 1; log "[$1] placement 1 (awid 4):"; "$here/t5-checked.sh" | tee -a "$P-steps.txt"; adb exec-out screencap -p > "$P-$1-placement1.png"
  page 3; log "[$1] placement 2 (awid $AW2):"; "$here/t5-checked.sh" | tee -a "$P-steps.txt"; adb exec-out screencap -p > "$P-$1-placement2.png"
  log "[$1] read 4: $(A android_read_dynamic_widget_state '{"appWidgetId":4}') read $AW2: $(A android_read_dynamic_widget_state "{\"appWidgetId\":$AW2}")"
}
: > "$P-steps.txt"; adb logcat -c
(cd "$EX" && appduct sessions ls 2>&1 | grep -q active) || { echo "no active Appduct session"; exit 1; }
for scope in placement widgetScope; do
  if [ $scope = placement ]; then f=null; else f='"widgetScope"'; fi
  log "scope=$scope: $(A android_set_dynamic_widget_state_flags "{\"flags\":{\"scope\":$f}}")"
  log "reset 4: $(A android_reset_dynamic_widget_state '{"appWidgetId":4}') reset $AW2: $(A android_reset_dynamic_widget_state "{\"appWidgetId\":$AW2}")"
  sleep 3
  page 1; "$here/t5-checked.sh" | grep -q 'Todo · onInteraction' || { log "placement 1 not visible"; exit 1; }
  "$here/t5-tap.sh" "D4-$scope-placement1-t1" 200 900
  snap "$scope"
done
log "scope back to default: $(A android_set_dynamic_widget_state_flags '{"flags":{"scope":null}}')"
"$here/t5-logcat.sh" > "$P-logcat.log"
