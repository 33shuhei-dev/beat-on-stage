"""誘 リョウ『風まで連れて』(ゲーム用101秒版) のテンポ解析。自動推定・聴取未確認。
usage: python3 -I tools/analysis/kaze_beats.py <mono wav 22.05k> <out.json>
手順（他曲のBPM・オフセットは流用しない。本曲の音から計測）:
  1. 帯域別オンセット強度（低域/中域/高域）を計算
  2. 10秒窓ごとに「周期×位相」の総当たりで櫛形スコア最大の拍格子を探し、テンポが緩やかに上昇していることを確認
     （約131.6BPM→約135.4BPM。固定BPMだと終盤でずれるので拍ごとの時刻表 beatMap で扱う）
  3. 初期モデルの各拍を ±50ms の範囲でオンセットのピークへ吸着 → 外れ値(>30ms)を除いた5次多項式（吸着し直しを繰り返す）で平滑化
  4. 小節頭の位相(0..3)は、拍頭の低域オンセット強度と、拍直後の和音(chroma)変化量の2指標で比較
出力: grid(秒。grid[0] が bar0 の頭)、拍ずれrms、位相スコア、16分スロット時刻と帯域別強度
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


bands = {"low": env(30, 150), "mid": env(150, 2000), "hi": env(2000, 10000), "full": env(30, 10000)}
comb = 0.5 * bands["low"] + 0.3 * bands["mid"] + 0.2 * bands["hi"]

# 2. 窓ごとの格子探索（周期0.43〜0.47s）
win = []
for a in range(0, int(dur) - 5, 10):
    b = min(a + 10, dur - 0.5)
    best = (0.0, 0.0, 0.0)
    for T in np.arange(0.43, 0.47, 0.001):
        for ph in np.arange(0, T, 0.006):
            ts = np.arange(a + ph, b, T)
            idx = np.clip((ts * fr).astype(int), 3, len(comb) - 4)
            s = float(np.mean([comb[i - 2:i + 3].max() for i in idx]))
            if s > best[0]:
                best = (s, T, a + ph)
    win.append((a, 60 / best[1], best[2]))
print("window tempo (start s, bpm, phase):", [(a, round(b, 1), round(p, 3)) for a, b, p in win])
bpm0, bpm1 = win[0][1], win[-1][1]

# 3. 初期モデル（窓ごとのテンポを窓中心で補間。最初の拍 = 窓0の位相）→ 各拍を ±45ms でオンセットのピークへ吸着 →
#    外れ値(>30ms)を除く5次多項式で平滑化 → 平滑化した拍を中心に吸着し直す、を4回繰り返す（初期モデルのずれで終盤が吸着しそこなうのを防ぐ）
t0 = win[0][2]
centers = np.array([a + 5 for a, _, _ in win])
bpms = np.array([b_ for _, b_, _ in win])
tm = [t0]
while tm[-1] < dur + 6:
    T = 60 / np.interp(tm[-1], centers, bpms)
    tm.append(tm[-1] + T)
tm = np.array(tm)
n = np.arange(len(tm))


def snap(centers_t, w=0.045):
    snapped, conf = [], []
    for t in centers_t:
        a = int((t - w) * fr)
        b = int((t + w) * fr) + 1
        if a < 0 or b > len(comb):
            snapped.append(np.nan)
            conf.append(0)
            continue
        seg = comb[a:b]
        i = int(np.argmax(seg))
        snapped.append((a + i) / fr)
        conf.append(seg[i])
    return np.array(snapped), np.array(conf)


bm = tm
for it in range(4):
    snapped, conf = snap(bm)
    ok = ~np.isnan(snapped) & (conf > 0.15)
    m = ok.copy()
    for _ in range(8):
        c = np.polyfit(n[m], snapped[m], 5)
        r = snapped - np.polyval(c, n)
        m = ok & (np.abs(r) < 0.03)
    bm = np.polyval(c, n)
res_rms = float(1000 * np.sqrt((r[m] ** 2).mean()))
ibi = np.diff(bm)
print(f"inliers {m.sum()}/{ok.sum()} residual rms {res_rms:.1f} ms max {1000*np.abs(r[m]).max():.1f} ms; ibi {ibi[0]:.4f}->{ibi[-1]:.4f}")
assert 0.43 < ibi.min() and ibi.max() < 0.47, "beatMap が不自然（多項式の暴れ）"
grid = bm[bm < dur + 4]

# 4. 小節頭位相
chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512)
cf = sr / 512


def chroma_change(t):
    a = int((t - 0.2) * cf)
    b = int((t + 0.05) * cf)
    c2 = int((t + 0.25) * cf)
    if a < 0 or c2 >= chroma.shape[1]:
        return np.nan
    return float(np.linalg.norm(chroma[:, b:c2 + 1].mean(1) - chroma[:, a:b].mean(1)))


phase_scores = []
for p in range(4):
    idx = [i for i in range(p, len(grid), 4) if 4 < grid[i] < dur - 3]
    lw = float(np.mean([bands["low"][int(grid[i] * fr) - 1:int(grid[i] * fr) + 3].max() for i in idx]))
    cc = float(np.nanmean([chroma_change(grid[i]) for i in idx]))
    phase_scores.append((lw, cc))
print("phase scores (low, chroma_change):", [tuple(round(v, 3) for v in x) for x in phase_scores])
best_low = int(np.argmax([x[0] for x in phase_scores]))
best_chroma = int(np.argmax([x[1] for x in phase_scores]))
print("best phase by low:", best_low, " by chroma:", best_chroma)
if best_low != 0 or best_chroma != 0:
    print("WARNING: 位相0以外が優勢。grid の先頭を ずらして再実行すること")


def at(t, e):
    return float(np.mean([e[max(int(x * fr) - 2, 0):int(x * fr) + 3].max() for x in t if 0 < x < dur - 1]))


half = (grid[:-1] + grid[1:]) / 2
for k in ("low", "mid", "hi"):
    print(f"{k}: beat {at(grid, bands[k]):.3f} half {at(half, bands[k]):.3f}")

# 16分スロット（拍を4等分）
slots = []
for i in range(len(grid) - 1):
    for s in range(4):
        slots.append(grid[i] + (grid[i + 1] - grid[i]) * s / 4)
slots = np.array(slots)


def peak(e, t, w=0.03):
    n_ = len(e)
    a = np.clip(((t - w) * fr).astype(int), 0, n_ - 1)
    bb = np.clip(((t + w) * fr).astype(int) + 1, 1, n_)
    return np.array([e[x:max(x + 1, y_)].max() for x, y_ in zip(a, bb)])


json.dump({"duration": dur, "grid": grid.round(4).tolist(), "residual_rms_ms": res_rms,
           "tempo_windows": [(a, b_, p) for a, b_, p in win],
           "phase_scores": phase_scores, "slot_times": slots.round(4).tolist(),
           "slot_strength": {k: peak(e, slots).round(4).tolist() for k, e in bands.items()}}, open(out, "w"))
print("grid beats", len(grid), "first", grid[:3].round(4), "last", round(float(grid[-1]), 3))
