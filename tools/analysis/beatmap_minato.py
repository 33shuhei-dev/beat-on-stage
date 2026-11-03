"""おすそわけしたいんです：テンポ・拍位置の解析と beatMap 出力（自動推定。聴取未確認）。
手順: 全帯域オンセット強度 → 広い範囲(60〜200BPM)の自己相関でテンポ候補を確認 → 拍格子の位相・倍率を
オンセット強度の最大化で決定 → オンセットピークへ吸着 → 4次多項式のロバスト回帰（外れ値除去を反復）。
usage: python3 -I beatmap_minato.py <bands.npy(local.py出力)> <out.json>
"""
import sys, json, numpy as np
low, mid, hi, full = np.load(sys.argv[1]); fr = 22050 / 64
dur = len(full) / fr
x = full - full.mean(); ac = np.correlate(x, x, 'full')[len(x) - 1:]; ac /= ac[0]
print("== 全体の自己相関（BPM候補、60〜200）")
cand = []
for bpm in np.arange(60, 200, 0.25):
    L = fr * 60 / bpm; i = int(round(L)); cand.append((ac[i], bpm))
for v, b in sorted(cand, reverse=True)[:0]: pass
pk = [(ac[i], 60 * fr / i) for i in range(int(fr * 60 / 200), int(fr * 60 / 60)) if ac[i] > ac[i - 1] and ac[i] > ac[i + 1] and ac[i] > 0.08]
for v, b in sorted(pk, reverse=True)[:8]: print(f"  {b:7.2f} BPM  ac={v:.3f}")
def at(e, t, w=0.02):
    a = max(0, int((t - w) * fr)); c = int((t + w) * fr); return e[a:c].max() if c > a else 0
# 128〜130BPMで位相をスキャン
best = None
for bpm in np.arange(127.5, 130.5, 0.05):
    T = 60 / bpm
    for ph in np.arange(0, T, 0.004):
        ts = np.arange(ph, 85, T); s = np.mean([at(full, t) for t in ts])
        if best is None or s > best[0]: best = (s, bpm, ph)
print("格子最適", best)
_, bpm0, ph0 = best; T0 = 60 / bpm0
# 半拍ずらしとの比較（拍そのものか裏拍かの確認）
for name, off in (("拍", 0), ("半拍ずれ", T0 / 2)):
    print(" ", name, np.mean([at(full, t) for t in np.arange(ph0 + off, 85, T0)]))
# 吸着
ts = np.arange(ph0, dur - 0.2, T0); snapped = []
for t in ts:
    a = int((t - 0.05) * fr); c = int((t + 0.05) * fr); seg = full[a:c]
    snapped.append((a + int(np.argmax(seg))) / fr if seg.max() > 0.15 else t)
snapped = np.array(snapped); n = np.arange(len(ts)); keep = np.ones(len(n), bool)
for _ in range(6):
    p = np.polyfit(n[keep], snapped[keep], 4); r = snapped - np.polyval(p, n); keep = np.abs(r) < 0.025
rms = float(np.sqrt(np.mean(r[keep] ** 2)))
fit = np.polyval(p, np.arange(len(n) + 20))
bm = [round(float(v), 4) for v in fit if v < dur + 2]
print(f"BPM {60/(bm[1]-bm[0]):.2f}→{60/(bm[-1]-bm[-2]):.2f}  rms={rms*1000:.1f}ms keep={keep.sum()}/{len(keep)} first={bm[0]} beats={len(bm)}")
json.dump({"beats": bm, "rmsMs": rms * 1000, "bpmStart": 60 / (bm[1] - bm[0]), "bpmEnd": 60 / (bm[-1] - bm[-2])}, open(sys.argv[2], "w"))
