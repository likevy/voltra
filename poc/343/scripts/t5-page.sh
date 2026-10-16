#!/usr/bin/env bash
# PoC #343 task 5: bring the launcher page with widget C (TodoStateWidget, "Todo · onInteraction")
# or D (TodoStateKeyWidget, "Todo · stateKey") to the front. Launcher layout on the API 35 AVD after
# Task 4: [Discover feed] [default page] [C] [D]. HOME from an app returns to the last page; HOME on
# the launcher scrolls to the default page. Usage: t5-page.sh C|D [nohome]
# Exits non-zero when the page cannot be found, so callers never tap blind.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
visible() { "$here/poc343-widget-nodes.sh" "Todo · $1" | grep -q .; }
case "$1" in C) want='onInteraction'; n=1;; D) want='stateKey'; n=2;; *) exit 2;; esac
if [ "${2:-}" = nohome ] && visible "$want"; then echo "page $1 visible"; exit 0; fi
for attempt in 1 2 3; do
  adb shell input keyevent HOME; sleep 1.5; adb shell input keyevent HOME; sleep 1.5
  for i in $(seq 1 $n); do adb shell input swipe 900 1200 100 1200 300; sleep 1.5; done
  visible "$want" && { echo "page $1 visible"; exit 0; }
done
echo "page $1 not found"; exit 1
