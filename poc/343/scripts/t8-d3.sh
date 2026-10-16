#!/usr/bin/env bash
# PoC #343 task 8, demo step D3 plus "Clear all" for widget H (TodoStateSetterWidget, appWidgetId 8):
# with t1 ticked, push a 4th item at the FRONT, then at the END (the tick must stay with t1); then
# tick t2, switch "Show completed" off and on (a second state key), and tap "Clear all" (a button
# whose inline onPress writes done = {}). Taps are placed from the uiautomator bounds of the node
# text, so rows can move. Needs a live Appduct session. Usage: t8-d3.sh <evidence-prefix>
set -uo pipefail
P="$1"; here="$(cd "$(dirname "$0")" && pwd)"
A() { "$here/t8-ad.sh" "$@"; }
log() { echo "$(date +%T) $*" | tee -a "$P-steps.txt"; }
tapText() { # $1 = label, $2 = node text regex
  local b; b=$("$here/poc343-widget-nodes.sh" "text=\"$2\"" | head -1 | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]')
  [ -n "$b" ] || { log "node '$2' not found"; return 1; }
  local x1 y1 x2 y2; read -r x1 y1 x2 y2 <<<"$(echo "$b" | tr -c '0-9' ' ')"
  log "tap $1 at $(( (x1 + x2) / 2 )),$(( (y1 + y2) / 2 ))"
  "$here/t5-tap.sh" "$1" $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))
}
snap() { sleep 3; log "[$1]"; "$here/t5-checked.sh" | tee -a "$P-steps.txt"; adb exec-out screencap -p > "$P-$1.png"
  log "[$1] state: $(A android_read_dynamic_widget_state '{"appWidgetId":8}')"; }
base='[{"id":"t1","title":"Buy 🍞"},{"id":"t2","title":"Water the plants"},{"id":"t3","title":"Call the dentist"}]'
front='[{"id":"t4","title":"NEW at front"},{"id":"t1","title":"Buy 🍞"},{"id":"t2","title":"Water the plants"},{"id":"t3","title":"Call the dentist"}]'
end='[{"id":"t1","title":"Buy 🍞"},{"id":"t2","title":"Water the plants"},{"id":"t3","title":"Call the dentist"},{"id":"t4","title":"NEW at end"}]'
push() { log "push $1: $(A android_update_dynamic_widget "{\"widgetId\":\"TodoStateSetterWidget\",\"props\":{\"items\":$2}}")"; }
: > "$P-steps.txt"; adb logcat -c
log "flags: $(A android_set_dynamic_widget_state_flags '{"flags":{"precedence":null,"scope":null,"interactDelayMs":null}}')"
push base "$base"
log "reset: $(A android_reset_dynamic_widget_state '{"appWidgetId":8}')"
"$here/t5-page.sh" H >/dev/null || exit 1; sleep 2
tapText D3-H-t1 'Buy[^"]*'; snap 1-t1-ticked
push front "$front"; "$here/t5-page.sh" H nohome >/dev/null; snap 2-front-survive
push end "$end"; "$here/t5-page.sh" H nohome >/dev/null; snap 3-end-survive
push base "$base"; "$here/t5-page.sh" H nohome >/dev/null; sleep 3
tapText D3-H-t2 'Water the plants'; snap 4-t1-t2-ticked
tapText D3-H-switch-off 'Show completed'; snap 5-show-completed-off
tapText D3-H-switch-on 'Show completed'; snap 6-show-completed-on
tapText D3-H-clear 'Clear all'; snap 7-clear-all
"$here/t5-logcat.sh" > "$P-logcat.log"
