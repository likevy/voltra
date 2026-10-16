#!/usr/bin/env python3
"""PoC #343 task 5: per-tap timings from a `t5-logcat.sh` dump (logcat -v epoch).

For every `Poc343Tap: TAP <label>` marker: marker -> callback entered -> commit -> update returned
-> first `render` line of the committed appWidgetId with stateRevision >= the committed revision.
Also counts callbacks/commits between this marker and the next one.
Usage: t5-latency.py <logcat-file>... [--label-filter SUBSTR] [--json]
"""
import json, re, statistics, sys

args = [a for a in sys.argv[1:] if not a.startswith('--')]
flt = None
if '--label-filter' in sys.argv:
    flt = sys.argv[sys.argv.index('--label-filter') + 1]; args.remove(flt)
rows = []
for path in args:
    lines = []
    for raw in open(path, encoding='utf-8', errors='replace'):
        m = re.match(r'\s*(\d+\.\d+)\s+\d+\s+\d+\s+\w\s+(\S+?)\s*:\s(.*)', raw)
        if m: lines.append((float(m.group(1)), m.group(2), m.group(3)))
    taps = [i for i, l in enumerate(lines) if l[1] == 'Poc343Tap' and l[2].startswith('TAP ')]
    for n, i in enumerate(taps):
        end = taps[n + 1] if n + 1 < len(taps) else len(lines)
        t0, label = lines[i][0], lines[i][2][4:].strip()
        if flt and flt not in label: continue
        seg = lines[i:end]
        cb = [l for l in seg if l[2].startswith('callback entered')]
        cm = [l for l in seg if l[2].startswith('commit ')]
        up = [l for l in seg if l[2].startswith('update returned')]
        procstart = [l for l in seg if 'Start proc' in l[2]]
        r = {'label': label, 'callbacks': len(cb), 'commits': len(cm)}
        if procstart: r['procStartMs'] = round((procstart[0][0] - t0) * 1000)
        if cb: r['callbackMs'] = round((cb[0][0] - t0) * 1000)
        if cm:
            r['commitMs'] = round((cm[0][0] - t0) * 1000)
            mm = re.search(r'appWidgetId=(\S+).*wrote=(\w+).*via=(\S+) stateRevision=(\d+)', cm[0][2])
            awid, wrote, via, rev = mm.group(1), mm.group(2), mm.group(3), int(mm.group(4))
            r.update(appWidgetId=awid, via=via, wrote=wrote, stateRevision=rev)
            revs = [re.search(r'stateRevision=(\d+)', l[2]).group(1) for l in cm]
            r['revisions'] = ','.join(revs)
            rend = [l for l in lines[i:] if l[1] == 'VoltraClientGlanceWidget' and l[2].startswith('render ')
                    and f'appWidgetId={awid} ' in l[2]
                    and int(re.search(r'stateRevision=(\d+)', l[2]).group(1)) >= rev]
            if rend: r['renderMs'] = round((rend[0][0] - t0) * 1000)
        if up: r['updateMs'] = round((up[0][0] - t0) * 1000)
        if cb and cm: r['cb->commit'] = round((cm[0][0] - cb[0][0]) * 1000)
        if cb and 'renderMs' in r: r['cb->render'] = r['renderMs'] - r['callbackMs']
        rows.append(r)
if '--json' in sys.argv:
    print(json.dumps(rows, indent=1)); sys.exit()
cols = ['label', 'callbacks', 'commits', 'revisions', 'via', 'procStartMs', 'callbackMs', 'commitMs', 'updateMs', 'renderMs', 'cb->render']
print('\t'.join(cols))
for r in rows: print('\t'.join(str(r.get(c, '')) for c in cols))
for c in ['callbackMs', 'commitMs', 'updateMs', 'renderMs', 'cb->render']:
    v = [r[c] for r in rows if c in r]
    if v: print(f'# {c}: n={len(v)} median={statistics.median(v):g} max={max(v)}')
