#!/usr/bin/env bash
# PoC #343 task 5, demo step D3 for both widgets: with t1 ticked, push a 4th item at the FRONT, then
# at the END; then once more at the front under precedence=resetOnPush. Needs a live Appduct session.
# Usage: t5-d3.sh <evidence-prefix>
set -uo pipefail
P="$1"; here="$(cd "$(dirname "$0")" && pwd)"; EX="$here/../../../example"
A() { (cd "$EX" && appduct tools call "$1" --input "$2" 2>&1 | tail -1); }
log() { echo "$(date +%T) $*" | tee -a "$P-steps.txt"; }
snap() { # $1 = tag
  sleep 3
  for W in C D; do
    "$here/t5-page.sh" "$W" >/dev/null && { log "[$1] $W:"; "$here/t5-checked.sh" | tee -a "$P-steps.txt"; adb exec-out screencap -p > "$P-$1-$W.png"; }
  done
  log "[$1] state C: $(A android_read_dynamic_widget_state '{"appWidgetId":4}')"
  log "[$1] state D: $(A android_read_dynamic_widget_state '{"appWidgetId":5}')"
}
base='[{"id":"t1","title":"Buy 🍞"},{"id":"t2","title":"Water the plants"},{"id":"t3","title":"Call the dentist"}]'
front='[{"id":"t4","title":"NEW at front"},{"id":"t1","title":"Buy 🍞"},{"id":"t2","title":"Water the plants"},{"id":"t3","title":"Call the dentist"}]'
end='[{"id":"t1","title":"Buy 🍞"},{"id":"t2","title":"Water the plants"},{"id":"t3","title":"Call the dentist"},{"id":"t4","title":"NEW at end"}]'
push() { for w in TodoStateWidget TodoStateKeyWidget; do log "push $1 to $w: $(A android_update_dynamic_widget "{\"widgetId\":\"$w\",\"props\":{\"items\":$2}}")"; done; }
: > "$P-steps.txt"; adb logcat -c
(cd "$EX" && appduct sessions ls 2>&1 | grep -q active) || { echo "no active Appduct session"; exit 1; }
log "flags: $(A android_set_dynamic_widget_state_flags '{"flags":{"precedence":null,"scope":null,"interactDelayMs":null}}')"
push base "$base"
log "reset C: $(A android_reset_dynamic_widget_state '{"appWidgetId":4}') D: $(A android_reset_dynamic_widget_state '{"appWidgetId":5}')"
sleep 2
"$here/t5-page.sh" C >/dev/null && "$here/t5-tap.sh" D3-C-t1 200 900
sleep 2
"$here/t5-page.sh" D >/dev/null && "$here/t5-tap.sh" D3-D-t1 200 290
snap 1-t1-ticked
push front "$front"; snap 2-front-survive
push end "$end"; snap 3-end-survive
log "flags: $(A android_set_dynamic_widget_state_flags '{"flags":{"precedence":"resetOnPush"}}')"
push front "$front"; snap 4-front-resetOnPush
log "flags: $(A android_set_dynamic_widget_state_flags '{"flags":{"precedence":null}}')"
push base "$base"
"$here/t5-logcat.sh" > "$P-logcat.log"
