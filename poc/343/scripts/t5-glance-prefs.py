#!/usr/bin/env python3
"""PoC #343: decode a Jetpack DataStore Preferences file (preferences_pb) from stdin into JSON.

PreferenceMap { map<string, Value> preferences = 1 }; Value is a oneof of
boolean=1, float=2, integer=3, long=4, string=5, string_set=6, double=7, bytes=8.
"""
import json, struct, sys


def varint(b, i):
    shift = result = 0
    while True:
        c = b[i]; i += 1
        result |= (c & 0x7F) << shift
        if not c & 0x80:
            return result, i
        shift += 7


def fields(b):
    i = 0
    while i < len(b):
        key, i = varint(b, i)
        num, wt = key >> 3, key & 7
        if wt == 0:
            v, i = varint(b, i)
        elif wt == 1:
            v = b[i:i + 8]; i += 8
        elif wt == 5:
            v = b[i:i + 4]; i += 4
        elif wt == 2:
            n, i = varint(b, i); v = b[i:i + n]; i += n
        else:
            raise ValueError(f"wire type {wt}")
        yield num, wt, v


def value(b):
    for num, wt, v in fields(b):
        if num == 1: return bool(v)
        if num == 2: return struct.unpack('<f', v)[0]
        if num in (3, 4): return v - (1 << 64) if v >= 1 << 63 else v
        if num == 5: return v.decode('utf-8')
        if num == 6: return [s.decode('utf-8') for n, _, s in fields(v) if n == 1]
        if num == 7: return struct.unpack('<d', v)[0]
        if num == 8: return v.hex()
    return None


out = {}
for num, wt, entry in fields(sys.stdin.buffer.read()):
    if num != 1: continue
    k = v = None
    for n, _, x in fields(entry):
        if n == 1: k = x.decode('utf-8')
        if n == 2: v = value(x)
    out[k] = v
print(json.dumps(out, ensure_ascii=False, sort_keys=True))
