"""りず『ひとつぶんの晴れ』(ゲーム用89秒版) のテンポ解析。自動推定・聴取未確認。
usage: python3 -I tools/analysis/rizu_beats.py <mono wav 22.05k> <out.json>
出力: beatMap(秒, 多項式平滑)、拍ずれrms、帯域別の16分スロット強度(onset)、小節頭位相の候補スコア
"""
import sys, json, numpy as np, librosa
wav, out = sys.argv[1], sys.argv[2]
y, sr = librosa.load(wav, sr=22050, mono=True)
dur = len(y) / sr
hop = 128
fr = sr / hop
S = np.abs(librosa.stft(y, n_fft=1024, hop_length=hop))
f = librosa.fft_frequencies(sr=sr, n_fft=1024)
def env(lo, hi):
    m = (f >= lo) & (f < hi)
    e = np.log1p(100 * S[m]).sum(0)
    d = np.maximum(0, np.diff(e, prepend=e[0]))
    return d / np.percentile(d, 99.5)
bands = {"low": env(30, 150), "mid": env(150, 2000), "hi": env(2000, 10000)}
bands["full"] = env(30, 10000)
oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
_, b = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, hop_length=hop, start_bpm=135, tightness=300)
bt = b * hop / sr
print("tracked beats", len(bt), "first", bt[:4], "median ibi", np.median(np.diff(bt)))
# 追跡拍を全域オンセット(低域重視)のピークへ吸着 → ibi を軽く平滑化（65秒前後に約0.5秒の拍間隔の揺れがあるため多項式は使わない）
from scipy.ndimage import gaussian_filter1d
snap = []
for t in bt:
    a = int((t - 0.03) * fr); bb = int((t + 0.03) * fr) + 1
    seg = bands["low"][a:bb] + bands["full"][a:bb]
    snap.append((a + int(np.argmax(seg))) / fr if seg.max() > 0 else t)
snap = np.array(snap)
tb = bt.copy()  # 追跡拍をそのまま使う（ibi 0.44〜0.45s。64〜66秒付近だけ約0.5sに緩む）
# スナップ位置との誤差
res = tb - snap
# 全体の位相ずれを最小二乗で中和
print("smoothed vs snapped residual rms ms", 1000 * np.sqrt((res ** 2).mean()), "max", 1000 * np.abs(res).max())
base_ibi = float(np.median(np.diff(tb)))
# 先頭側 (0秒まで) と末尾側 (duration+4秒まで) を一定ibiで外挿
pre = []
t0 = tb[0]
while t0 - base_ibi > -0.001:
    t0 -= base_ibi; pre.append(t0)
post = []
t1 = tb[-1]
while t1 < dur + 4:
    t1 += float(np.mean(np.diff(tb[-8:]))); post.append(t1)
grid = np.array(pre[::-1] + list(tb) + post)
c = None
# 拍位相が半拍ずれていないか: 拍位置と半拍位置のonset強度
def at(t, e): return e[np.clip((np.asarray(t) * fr).astype(int), 0, len(e) - 1)]
half = (grid[:-1] + grid[1:]) / 2
for k, e in bands.items():
    print(f"{k}: beat {at(grid, e).mean():.3f} half {at(half, e).mean():.3f}")
# 小節頭位相(0..3): 低域・全域の平均
ph = []
for p in range(4):
    g = grid[p::4]
    ph.append((float(at(g, bands['low']).mean()), float(at(g, bands['full']).mean())))
print("phase scores (low, full):", [tuple(round(v, 3) for v in x) for x in ph])
# 16分スロット強度: 拍をまたいで4等分 (小節頭位相は仮に0。後で並べ替え可能なように拍単位で出す)
slots = []
for i in range(len(grid) - 1):
    for s in range(4):
        slots.append(grid[i] + (grid[i + 1] - grid[i]) * s / 4)
slots = np.array(slots)
def peak(e, t, w=0.03):
    n = len(e)
    a = np.clip(((t - w) * fr).astype(int), 0, n - 1); bb = np.clip(((t + w) * fr).astype(int) + 1, 1, n)
    return np.array([e[x:max(x + 1, y_)].max() for x, y_ in zip(a, bb)])
out_d = {"duration": dur, "grid": grid.round(4).tolist(), "residual_rms_ms": float(1000 * np.sqrt((res ** 2).mean())),
         "phase_scores": ph, "slot_times": slots.round(4).tolist(),
         "slot_strength": {k: peak(e, slots).round(4).tolist() for k, e in bands.items()}}
json.dump(out_d, open(out, "w"))
print("grid beats", len(grid), "first", grid[:3], "last", grid[-1])
