#!/usr/bin/env bash
# PoC #343: mark the device log, then tap. Usage: t5-tap.sh <label> <x> <y>
# The marker is written just before `input tap`, so marker -> callback includes the start-up of the
# `input` command itself (an app_process launch on the device).
set -euo pipefail
adb shell "log -t Poc343Tap TAP $1; input tap $2 $3"
