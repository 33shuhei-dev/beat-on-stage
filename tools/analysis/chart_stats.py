"""全譜面の指標を並べる（難易度の段差・無理がないかの目安）。usage: python3 -I chart_stats.py"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'charts'))
from chartlib import beat_time, ROOT
songs = json.load(open(os.path.join(ROOT, 'public/data/songs.json')))
print(f"{'song/diff':14} {'notes':>5} {'/s':>5} {'max1s':>5} {'chord':>5} {'hold':>4} {'tapInHold':>9} {'minHandGap':>10} {'<250ms':>6} {'run<250':>7} {'jack<300':>8}  L0 L1 L2 L3")
for s in songs:
    bm = s['beatMap']
    for d in ('easy', 'normal', 'hard'):
        c = json.load(open(os.path.join(ROOT, 'public', s['charts'][d])))
        ev = []
        for n in c['notes']:
            t = beat_time(bm, n['bar'], n['slot']); e = beat_time(bm, n['endBar'], n['endSlot']) if 'endBar' in n else None
            ev.append((t, e, n['lane']))
        ev.sort()
        ts = [e[0] for e in ev]
        span = ts[-1] - ts[0]
        m1 = max(sum(1 for u in ts if t <= u < t + 1) for t in ts)
        chords = len(ts) - len(set(round(t, 3) for t in ts))
        holds = [e for e in ev if e[1]]
        tih = sum(1 for h in holds for e in ev if e is not h and h[0] + 0.001 < e[0] < h[1] - 0.001)
        gaps = []
        for hand in (0, 1):
            hn = [e for e in ev if (e[2] <= 1) == (hand == 0)]
            for a, b in zip(hn, hn[1:]):
                if abs(b[0] - a[0]) < 0.001: continue
                gaps.append(b[0] - (a[1] or a[0]))
        fast = sum(1 for g in gaps if g < 0.25)
        runmax = 0
        for hand in (0, 1):
            hn = [e for e in ev if (e[2] <= 1) == (hand == 0)]
            run = 0
            for a, b in zip(hn, hn[1:]):
                if abs(b[0] - a[0]) < 0.001: continue
                g = b[0] - (a[1] or a[0])
                run = run + 1 if g < 0.25 else 0
                runmax = max(runmax, run)
        jack = 0
        for lane in range(4):
            ln = [e for e in ev if e[2] == lane]
            jack += sum(1 for a, b in zip(ln, ln[1:]) if b[0] - (a[1] or a[0]) < 0.3)
        lanes = [sum(1 for e in ev if e[2] == l) for l in range(4)]
        print(f"{s['id']+'/'+d:14} {len(ev):5d} {len(ev)/span:5.2f} {m1:5d} {chords:5d} {len(holds):4d} {tih:9d} {min(gaps):10.3f} {fast:6d} {runmax:7d} {jack:8d}  {lanes}")
