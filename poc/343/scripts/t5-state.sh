#!/usr/bin/env bash
# PoC #343: print one placement's Glance state (record + revisions) straight from its DataStore
# file, without starting the app process (run-as only reads the file). Usage: t5-state.sh <appWidgetId>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
PKG=com.callstackincubator.voltraexample
f="files/datastore/appWidget-$1.preferences_pb"
if ! adb shell run-as $PKG ls "$f" >/dev/null 2>&1; then echo "{\"_note\":\"$f does not exist (no write yet)\"}"; exit 0; fi
adb exec-out run-as $PKG cat "$f" | python3 "$here/t5-glance-prefs.py"
