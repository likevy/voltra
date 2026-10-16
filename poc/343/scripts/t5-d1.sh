#!/usr/bin/env bash
# PoC #343 task 5, demo step D1 for one widget: tap row t1 with the app just in front (tap-then-return),
# row t2 with the app in the background, row t3 with the app killed. Records logcat, screenshots,
# the widget's checked flags and its stored state. Usage: t5-d1.sh C|D <appWidgetId> <evidence-dir>
set -uo pipefail
W="$1"; AWID="$2"; EV="$3"; here="$(cd "$(dirname "$0")" && pwd)"
PKG=com.callstackincubator.voltraexample
if [ "$W" = C ]; then X=200; Y1=900; Y2=988; Y3=1076; else X=200; Y1=290; Y2=378; Y3=466; fi
p="$EV/t5-d1-$W"
log() { echo "$(date +%T) $*" | tee -a "$p-steps.txt"; }
: > "$p-steps.txt"
adb logcat -c
# --- foreground (tap-then-return) ---
adb shell am start -W -a android.intent.action.VIEW -d voltra://android-widgets/todo-state $PKG >/dev/null
sleep 3
log "fg: top activity before HOME: $(adb shell dumpsys activity activities | grep -m1 topResumedActivity | tr -s ' ')"
"$here/t5-page.sh" "$W" | tee -a "$p-steps.txt"
log "fg: process state at tap: $(adb shell dumpsys activity processes $PKG | grep -m1 -oE 'curProcState=[0-9]+|mCurProcState=[0-9]+' ) pid=$(adb shell pidof $PKG | tr -d '\r')"
"$here/t5-tap.sh" "D1-$W-fg-t1" $X $Y1; log "fg: tapped t1"
sleep 3; "$here/t5-checked.sh" | tee -a "$p-steps.txt"; adb exec-out screencap -p > "$p-fg.png"
adb shell am start -W -a android.intent.action.VIEW -d voltra://android-widgets/todo-state $PKG >/dev/null; sleep 3
adb exec-out screencap -p > "$p-fg-return-app.png"; log "fg: returned to the app"
# --- background ---
"$here/t5-page.sh" "$W" | tee -a "$p-steps.txt"; sleep 8
log "bg: pid=$(adb shell pidof $PKG | tr -d '\r') top=$(adb shell dumpsys activity activities | grep -m1 topResumedActivity | tr -s ' ')"
"$here/t5-tap.sh" "D1-$W-bg-t2" $X $Y2; log "bg: tapped t2"
sleep 3; "$here/t5-checked.sh" | tee -a "$p-steps.txt"; adb exec-out screencap -p > "$p-bg.png"
# --- killed ---
log "killed: waiting for the Glance sessions to end"
"$here/t5-kill.sh" 60 | tee -a "$p-steps.txt"
log "killed: pidof='$(adb shell pidof $PKG | tr -d '\r')'"
"$here/t5-tap.sh" "D1-$W-killed-t3" $X $Y3; log "killed: tapped t3"
sleep 6; "$here/t5-checked.sh" | tee -a "$p-steps.txt"; adb exec-out screencap -p > "$p-killed.png"
log "after: pid=$(adb shell pidof $PKG | tr -d '\r') state=$("$here/t5-state.sh" "$AWID")"
"$here/t5-logcat.sh" > "$p-logcat.log"
log "callbacks=$(grep -c 'callback entered' "$p-logcat.log") commits=$(grep -c ' commit ' "$p-logcat.log")"
