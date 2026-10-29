"""譜面ノーツが実際の音の立ち上がり（オンセット）に乗っているかの簡易チェック。
usage: python3 -I chart_onset_check.py <bands.npy (local.pyの出力)> <songs.json> <chart.json>"""
import sys, json, numpy as np
low, mid, hi, full = np.load(sys.argv[1]); fr = 22050 / 64
song = [s for s in json.load(open(sys.argv[2])) if s['id'] == 'vote'][0]
bm = np.array(song['beatMap']); ch = json.load(open(sys.argv[3]))
def b2s(b):
    i = int(np.clip(np.floor(b), 0, len(bm) - 2)); return bm[i] + (b - i) * (bm[i + 1] - bm[i])
def at(t, w=0.025):
    a = int((t - w) * fr); c = int((t + w) * fr); return full[a:c].max()
ts = sorted({round(b2s(n['bar'] * 4 + n['slot'] / 4), 4) for n in ch['notes']})
v = np.array([at(t) for t in ts])
rng = np.random.default_rng(0); rnd = np.array([at(t) for t in rng.uniform(2, 71, 2000)])
# 同じ数の「8分グリッド上のランダム位置」とも比較
grid = [b2s(b / 2) for b in range(8, 2 * (len(bm) - 8))]
gv = np.array([at(t) for t in grid])
print(f"note times={len(ts)} median onset={np.median(v):.3f}  vs random={np.median(rnd):.3f}  vs any 8th-grid={np.median(gv):.3f}")
print(f"strong(>0.3): notes {np.mean(v>0.3):.0%}  random {np.mean(rnd>0.3):.0%}  grid {np.mean(gv>0.3):.0%}")
