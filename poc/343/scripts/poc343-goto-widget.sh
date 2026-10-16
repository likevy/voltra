#!/usr/bin/env bash
# PoC #343: press HOME, then swipe through launcher pages until a node matching $1 is visible.
set -uo pipefail
pattern="${1:-text=\"Ping\"}"
here="$(cd "$(dirname "$0")" && pwd)"
adb shell input keyevent HOME; sleep 2
for i in 1 2 3 4; do
  n=$("$here/poc343-widget-nodes.sh" "$pattern" | wc -l | tr -d ' ')
  if [ "$n" -gt 0 ]; then echo "widget visible after $((i-1)) swipe(s)"; exit 0; fi
  adb shell input swipe 900 1200 100 1200 300; sleep 2
done
echo "widget not found"; exit 1
