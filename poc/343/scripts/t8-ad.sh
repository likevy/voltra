#!/usr/bin/env bash
# PoC #343 task 8: call one Appduct tool of the example app. Usage: t8-ad.sh <tool> [json-input]
# Runs from example/ (where .appduct/config.json lives). Sessions left "suspended" by a killed app
# make an unqualified call ambiguous, so they are revoked first. Prints the JSON result on one line.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../../../example" || exit 1
for alias in $(appduct sessions ls --json 2>/dev/null | python3 -c 'import sys,json
for s in json.load(sys.stdin).get("data", []):
    if s.get("state") != "active": print(s["alias"])'); do
  appduct sessions revoke "$alias" >/dev/null 2>&1
done
input="${2:-}"; [ -n "$input" ] || input='{}'
appduct tools call "$1" --input "$input" --json 2>&1
