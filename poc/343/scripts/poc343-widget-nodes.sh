#!/usr/bin/env bash
# PoC #343: dump the launcher's view tree and print the text/class/checked/bounds of every node
# whose text or class matches $1 (default: CheckBox|Button). Use the bounds centre with `input tap`.
set -euo pipefail
pattern="${1:-CheckBox|Button}"
adb shell uiautomator dump /sdcard/ui.xml >/dev/null
adb exec-out cat /sdcard/ui.xml \
  | grep -o '<node[^>]*>' \
  | grep -o 'text="[^"]*"\|class="[^"]*"\|checked="[^"]*"\|bounds="[^"]*"' \
  | paste - - - - \
  | grep -E "$pattern" || true
