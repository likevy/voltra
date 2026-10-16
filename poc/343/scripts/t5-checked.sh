#!/usr/bin/env bash
# PoC #343 task 5: print the checked flag of every CheckBox/Switch the launcher currently shows.
here="$(cd "$(dirname "$0")" && pwd)"
"$here/poc343-widget-nodes.sh" 'Todo ·|CheckBox|Switch' | awk -F'\t' '{print $1, $3, $4}'
