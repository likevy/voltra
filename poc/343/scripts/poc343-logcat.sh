#!/usr/bin/env bash
# PoC #343: the logcat filter every spike uses. `-c` clears first; `-d` dumps and exits.
# Usage: poc343-logcat.sh [-c] [-d]
set -euo pipefail
clear=0; dump=0
for a in "$@"; do case "$a" in -c) clear=1;; -d) dump=1;; esac; done
[ "$clear" = 1 ] && adb logcat -c
args=(-v time -s VoltraPoc343 VoltraClientGlanceWidget VoltraJSRenderer ActivityManager WM-WorkerWrapper AndroidRuntime DEBUG)
if [ "$dump" = 1 ]; then adb logcat -d "${args[@]}"; else adb logcat "${args[@]}"; fi
