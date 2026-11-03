"""おすそわけしたいんです：オンセット強度から EASY/NORMAL/HARD の小節文字列を機械的に拾って tools/charts/minato_osusowake.py 用の辞書を出力する。
usage: python3 -I gen_bars_minato.py <bands.npy> <songs.json> > bars.txt
ノーツ位置は 全帯域・中域・高域のオンセット強度の合成値が強い16分スロット。密度の目標は EASY約1.2 / NORMAL約2.3 / HARD約3.5 ノーツ/秒。
chartlib の規則で衝突したものは弱い方を外す（コンパイルして例外が出たら該当ノーツを削る）。
"""
import sys, json, re, numpy as np
sys.path.insert(0, __import__('os').path.join(__import__('os').path.dirname(__file__), '..', 'charts'))
import chartlib
low, mid, hi, full = np.load(sys.argv[1]); fr = 22050 / 64
SID = "minato_osusowake"; LAST_BAR = 46; END_T = 87.4
bm = chartlib.load_beatmap(SID)
def at(e, t, w=0.022):
    a = max(0, int((t - w) * fr)); c = int((t + w) * fr); return float(e[a:c].max()) if c > a else 0.0
score = {}
for b in range(1, LAST_BAR + 1):
    for sl in range(16):
        t = chartlib.beat_time(bm, b, sl)
        if t > END_T: continue
        v = 0.5 * at(full, t) + 0.3 * at(mid, t) + 0.2 * at(hi, t)
        score[(b, sl)] = v + (0.12 if sl % 4 == 0 else 0.05 if sl % 2 == 0 else 0)
def pick(slots_ok, target):
    """4小節ごとのブロックで上位を拾う（曲の終盤まで偏りなく置く）。ブロックの密度は、ブロック内の強さの平均で±少し変える。"""
    cand = {k: v for k, v in score.items() if slots_ok(k[1])}
    blocks = {}
    for k, v in cand.items(): blocks.setdefault((k[0] - 1) // 4, []).append((v, k))
    means = {b: np.mean([v for v, _ in lst]) for b, lst in blocks.items()}; gm = np.mean(list(means.values()))
    out = set()
    for b, lst in blocks.items():
        t0 = chartlib.beat_time(bm, 4 * b + 1, 0); t1 = chartlib.beat_time(bm, min(4 * b + 5, LAST_BAR + 1), 0)
        n = int(round(target * (t1 - t0) * (0.75 + 0.25 * means[b] / gm)))
        out |= {k for _, k in sorted(lst, reverse=True)[:n]}
    return out
def thin(sel, min_gap_beats):
    # 近すぎるノーツ（時刻差が最小間隔未満）は弱い方を外す
    ks = sorted(sel, key=lambda k: chartlib.beat_time(bm, *k)); out = []
    for k in sorted(ks, key=lambda k: -score[k]):
        t = chartlib.beat_time(bm, *k)
        if all(abs(t - chartlib.beat_time(bm, *o)) >= min_gap_beats * 0.465 for o in out): out.append(k)
    return set(out)
def holdify(sel, n_holds, need_gap_slots, length_slots):
    ks = sorted(sel); res = {}; idx = {k: i for i, k in enumerate(ks)}
    cands = []
    for i, k in enumerate(ks[:-1]):
        nxt = ks[i + 1]; gap = (nxt[0] - k[0]) * 16 + nxt[1] - k[1]
        if gap >= need_gap_slots and k[0] >= 2:
            t = chartlib.beat_time(bm, *k); sus = float(np.mean(mid[int(t * fr):int((t + 0.45) * fr)])) / (at(mid, t) + 1e-6)
            cands.append((sus, k))
    chosen = {k for _, k in sorted(cands, reverse=True)[:n_holds]}
    return chosen
def fmt(sel, holds, length_slots):
    bars = {}
    for (b, s) in sorted(sel):
        tok = str(s)
        if (b, s) in holds:
            e = s + length_slots; eb = b
            if e >= 16: e -= 16; eb += 1
            tok += "h" + ">" * (eb - b) + str(e)
        bars.setdefault(b, []).append(tok)
    return {b: " ".join(v) for b, v in bars.items()}
def compile_ok(bars, d):
    bars = dict(bars)
    for _ in range(400):
        try:
            chartlib.compile_chart(bars, SID, d, "x", [], ""); return bars
        except ValueError as ex:
            m = re.search(r"bar (\d+) slot (\d+)", str(ex)); b, sl = int(m.group(1)), int(m.group(2))
            toks = bars[b].split(); toks = [t for t in toks if not re.match(rf"^{sl}(?!\d)", t)]
            if toks: bars[b] = " ".join(toks)
            else: del bars[b]
    raise RuntimeError("収束しない")
cfg = {
    "easy": dict(ok=lambda s: s % 4 == 0, target=1.15, gap=0.9, holds=5, need=8, length=4),
    "normal": dict(ok=lambda s: s % 2 == 0, target=2.3, gap=0.45, holds=7, need=6, length=4),
    "hard": dict(ok=lambda s: True, target=3.5, gap=0.2, holds=9, need=6, length=4),
}
out = {}
for d, c in cfg.items():
    sel = thin(pick(c["ok"], c["target"]), c["gap"])
    holds = holdify(sel, c["holds"], c["need"], c["length"])
    bars = compile_ok(fmt(sel, holds, c["length"]), d)
    out[d] = {int(k): v for k, v in bars.items()}
for d in ("easy", "normal", "hard"):
    print(f"{d} = {{")
    for b in sorted(out[d]): print(f"    {b}: {json.dumps(out[d][b])},")
    print("}\n")
