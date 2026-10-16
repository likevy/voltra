#!/usr/bin/env python3
"""PoC #343 task 8: median/max per widget (C/D/H, from the tap label) over t5-latency.py rows.

Usage: t8-agg.py [--skip-first] <logcat>...   --skip-first drops the first tap per widget and file
(the tap that opens the Glance session in a warm-session series).
"""
import json, statistics, subprocess, sys, os

skip = '--skip-first' in sys.argv
files = [a for a in sys.argv[1:] if not a.startswith('--')]
here = os.path.dirname(os.path.abspath(__file__))
cols = ['callbackMs', 'commitMs', 'updateMs', 'renderMs', 'bundleMs', 'interactMs', 'replayMs']
by = {}
for f in files:
    rows = json.loads(subprocess.check_output([sys.executable, os.path.join(here, 't5-latency.py'), f, '--json']))
    seen = set()
    for r in rows:
        parts = r['label'].split('-')
        w = next((p for p in parts if p in ('C', 'D', 'H')), '?')
        if skip and w not in seen:
            seen.add(w); continue
        seen.add(w)
        by.setdefault(w, []).append(r)
for w in sorted(by):
    rs = by[w]
    out = [f'{w} n={len(rs)}']
    for c in cols:
        v = [r[c] for r in rs if c in r]
        if v: out.append(f'{c} {statistics.median(v):g}/{max(v)}')
    bad = [r['label'] for r in rs if r.get('callbacks') != 1 or r.get('commits') != 1]
    if bad: out.append(f'not-1/1: {bad}')
    print('  '.join(out))
