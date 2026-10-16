#!/usr/bin/env bash
# PoC #343 task 5: dump the in-widget state tags with epoch timestamps. Usage: t5-logcat.sh > file
set -euo pipefail
adb logcat -d -v epoch -s DynamicWidgetState VoltraClientGlanceWidget VoltraJSRenderer Poc343Tap ActivityManager:I \
  | grep -E 'DynamicWidgetState|VoltraClientGlanceWidget|VoltraJSRenderer|Poc343Tap|ActivityManager.*voltraexample'
