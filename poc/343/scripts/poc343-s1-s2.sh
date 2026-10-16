#!/usr/bin/env bash
# PoC #343 spikes S1 (update() repaint: live / expired / killed), S2 (am kill semantics), S3 (threads, session timing).
# Precondition: PocTodoSpike pinned and visible on the launcher page in front, Metro up, debug build.
# Usage: poc343-s1-s2.sh <evidence-dir> [pingX pingY]
set -uo pipefail
EV="$1"; PING_X="${2:-179}"; PING_Y="${3:-977}"
PKG=com.callstackincubator.voltraexample
log() { echo "$(date +%T) $*"; }
tap() { adb shell "log -t VoltraPoc343 TAP_SENT $1; input tap $PING_X $PING_Y"; log "tap $1"; }
dev_now() { adb shell date +%s | tr -d '\r'; }
# Wait until the spike's composition was disposed after device epoch $1 (session ended), max 120 s.
wait_disposed_after() {
  local since="$1" i
  for i in $(seq 1 24); do
    local n
    n=$(adb logcat -d -v epoch -s VoltraPoc343 | awk -v s="$since" '/CONTENT_DISPOSED widget=PocTodoSpike/ { if ($1+0 >= s) c++ } END { print c+0 }')
    if [ "$n" -gt 0 ]; then log "session disposed ($n CONTENT_DISPOSED lines after $since)"; return 0; fi
    sleep 5
  done
  log "WARN: no CONTENT_DISPOSED seen within 120 s"; return 1
}

adb logcat -c
log "pid before: $(adb shell pidof $PKG)"
tap T1-first-tap
sleep 4
tap T2-live-session
sleep 3
log "waiting 65 s for the session to expire (45 s deadline after the last event)"
sleep 65
T3_DEV=$(dev_now)
tap T3-expired-session
sleep 8
log "waiting for T3's session to end before am kill"
wait_disposed_after "$T3_DEV"
sleep 2
# No HOME here: the callback never brings the app forward, and a HOME press while the launcher is
# already in front scrolls it to its default page, where the widget may not be (first run hit wallpaper).
PID_BEFORE=$(adb shell pidof $PKG | tr -d '\r')
KILL_DEV=$(dev_now)
log "am kill (pid before=$PID_BEFORE, device epoch=$KILL_DEV)"
adb shell am kill $PKG
sleep 2
PID_AFTER=$(adb shell pidof $PKG | tr -d '\r')
log "pidof after am kill: '${PID_AFTER}'"
if [ -n "$PID_AFTER" ]; then
  log "process survived am kill; fallback: adb root && adb shell kill $PID_AFTER"
  adb root >/dev/null 2>&1; sleep 2; adb wait-for-device
  adb shell kill "$PID_AFTER"; sleep 2
  log "pidof after kill fallback: '$(adb shell pidof $PKG | tr -d '\r')'"
  echo "FALLBACK_USED=1" > "$EV/s2-kill-method.txt"
else
  echo "FALLBACK_USED=0 (am kill sufficed)" > "$EV/s2-kill-method.txt"
fi
tap T4-killed-process
sleep 10
log "pid after cold tap: $(adb shell pidof $PKG)"
{
  echo "# S1/S2/S3 run $(date -u +%Y-%m-%dT%H:%M:%SZ); kill at device epoch $KILL_DEV; pid before kill $PID_BEFORE"
  adb logcat -d -v time -s VoltraPoc343 VoltraClientGlanceWidget VoltraJSRenderer ActivityManager WM-WorkerWrapper \
    | grep -E 'VoltraPoc343|PocTodoSpike|voltraexample|SessionWorker|WM-WorkerWrapper.*voltra' \
    | grep -v 'CLICK_RULE'
} > "$EV/s1-s2-s3-logcat.log"
log "saved $EV/s1-s2-s3-logcat.log ($(wc -l < "$EV/s1-s2-s3-logcat.log") lines)"
