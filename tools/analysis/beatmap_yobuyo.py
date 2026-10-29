"""何度でも呼ぶよ：struct.py が出した拍（beats.json）から、曲頭の誤検出を除いた beatMap を作る。

struct.py の拍トラッカーは最初の約8拍で不安定（実際より遅い間隔で検出）だったため、
拍8以降（残差RMS約6ms）に3次多項式を当てて先頭側を外挿し、拍8以降は検出値を使う。
さらに「和音が変わる拍位相」(struct.pyの出力で phase 2 が最大) を小節頭として、モデル上の拍2を bar0 とする。

usage: python3 -I beatmap_yobuyo.py <beats.json> <out beatmap.json>
"""
import sys, json, numpy as np
b = np.array(json.load(open(sys.argv[1]))["beats"]); n = np.arange(len(b))
p = np.polyfit(n[8:], b[8:], 3)
m = [float(np.polyval(p, i)) if i < 8 else float(b[i]) for i in range(len(b))]
i = len(b)
while m[-1] < 80.5:
    m.append(float(np.polyval(p, i))); i += 1
final = [round(x, 4) for x in m[2:] if x < 79.6]
json.dump({"beats": final, "downbeatPhase": 2, "bpmStart": round(60 / (final[1] - final[0]), 1), "bpmEnd": round(60 / (final[-1] - final[-2]), 1)}, open(sys.argv[2], "w"))
print(len(final), final[:4], final[-2:], "bpm", 60 / (final[1] - final[0]), 60 / (final[-1] - final[-2]))
