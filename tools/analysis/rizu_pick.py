"""りず『ひとつぶんの晴れ』の仮譜面ソースを生成する（自動選択）。
usage: python3 -I tools/analysis/rizu_pick.py <rizu_beats.py の出力json> > tools/charts/rizu_hitotsubun_no_hare.py
音の強い16分スロットを機械的に拾い、難易度別の密度目標に合わせる。拾ったあと chartlib の規則（同じ手160ms・長押し中は逆の手）で
衝突したものは弱い方を外す。手配置ではない。聴取未確認。
"""
import sys, json, re, os
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "charts"))
import chartlib as C

d = json.load(open(sys.argv[1]))
st = {k: np.array(v) for k, v in d["slot_strength"].items()}
times = np.array(d["slot_times"])
n_slots = len(times)
grid = d["grid"]
SID = "rizu_hitotsubun_no_hare"
FADE_START = 85.0
LAST_OK = 83.4   # 最後のノーツ/ホールド終端の上限（フェード開始の約1.6秒前）
FIRST_BAR = 1

score = 0.40 * st["low"] + 0.25 * st["mid"] + 0.20 * st["hi"] + 0.15 * st["full"]
score = np.minimum(score, 1.5)
slot_in_bar = np.arange(n_slots) % 16
pos_bonus = np.where(slot_in_bar % 4 == 0, 0.30, np.where(slot_in_bar % 2 == 0, 0.12, 0.0))
total = score + pos_bonus

def bar_slot(i): return i // 16, i % 16

def pick(density, grid_step, mingap, min_score, window):
    lo, hi = window
    cand = [i for i in range(n_slots) if lo <= times[i] <= hi and i % grid_step == 0 and (i // 16) >= FIRST_BAR and score[i] >= min_score]
    cand.sort(key=lambda i: -total[i])
    target = int(density * (hi - lo))
    acc = []
    for i in cand:
        if len(acc) >= target: break
        if all(abs(times[i] - times[j]) >= mingap for j in acc):
            acc.append(i)
    return sorted(acc)

def to_dict(acc, holds):
    bars = {}
    hold_at = {s: (eb, es) for s, eb, es in holds}
    for i in acc:
        b, s = bar_slot(i)
        if i in hold_at:
            eb, es = hold_at[i]
            tok = f"{s}h{'>' * (eb - b)}{es}"
        else:
            tok = str(s)
        bars.setdefault(b, []).append(tok)
    return {b: " ".join(v) for b, v in sorted(bars.items())}

def choose_holds(acc, n_holds, solo, span_min):
    """拍頭の音を数か所だけ長押しに。solo=True(EASY): 終端後も0.45s以上あけ、途中にノーツなし。
    solo=False: 長押し中は反対の手で刻める（途中の裏拍までの数ノーツは残す。多すぎる区間は候補にしない）。
    戻り値: [(開始スロット, 終端bar, 終端slot)]、削除するスロットは別途 acc から取り除く。"""
    out, used_t, drop = [], [], set()
    ts = [times[i] for i in acc]
    cands = []
    for k, i in enumerate(acc[:-1]):
        if i % 4 != 0 or ts[k] < 4.0: continue
        gap = ts[k + 1] - ts[k]
        if solo:
            if gap < span_min: continue
            want_end = ts[k + 1] - 0.55
            ends = [j for j in range(i + 4, n_slots) if j % 4 == 0 and times[j] <= want_end and times[j] - ts[k] <= 3.0]
            if not ends or times[ends[-1]] - ts[k] < 0.8: continue
            cands.append((total[i] + 0.2 * gap, i, ends[-1], []))
        else:
            # 終端 = 開始から約1.0〜1.8秒後の拍頭。途中のノーツは「偶数スロットのみ・最大3つ」に間引いて残す
            ends = [j for j in range(i + 4, n_slots) if j % 4 == 0 and 1.0 <= times[j] - ts[k] <= 1.8]
            if not ends: continue
            j = ends[0]
            if times[j] > LAST_OK - 0.6: continue
            inside = [x for x in acc if i < x <= j + 0 and times[x] < times[j] + 0.3]
            keep = [x for x in inside if x % 2 == 0 and x < j - 1][:3]
            cands.append((total[i] + 0.1 * len(keep), i, j, [x for x in inside if x not in keep]))
    cands.sort(reverse=True, key=lambda c: c[0])
    for _, i, j, dr in cands:
        if len(out) >= n_holds: break
        if all(abs(times[i] - t) > 9 for t in used_t):
            out.append((i, j // 16, j % 16)); used_t.append(times[i]); drop.update(dr)
    return out, drop

SECT = [("導入", 0, 3), ("区間A", 4, 15), ("区間B", 16, 29), ("区間C", 30, int(d["grid"].__len__() // 4))]

def build(diff, density, grid_step, mingap, min_score, n_holds, solo, span_min):
    window = (times[16 * FIRST_BAR], LAST_OK - 0.4)
    acc = pick(density, grid_step, mingap, min_score, window)
    for _ in range(40):
        holds, drop = choose_holds(acc, n_holds, solo, span_min)
        acc = [x for x in acc if x not in drop]
        bars = to_dict(acc, holds)
        try:
            C.compile_chart(bars, SID, diff, "x", [], "x")
            return bars, acc, holds
        except ValueError as e:
            m = re.search(r"bar (\d+) slot (\d+)", str(e))
            b, s = int(m.group(1)), int(m.group(2)); idx = b * 16 + s
            if idx in acc: acc.remove(idx)
            else: raise
    raise SystemExit("収束しない")

# EASY: 拍頭+裏拍の強い所のみ、間隔0.38s以上、約1.2/s。 NORMAL: 8分格子で約2.3/s。 HARD: 16分も許可、約3.5/s
# 同時押しなし（既存曲のEASY/NORMAL/HARDと同方針。HARDも同時押しは置かない）
res = {}
res["easy"] = build("easy", 1.25, 2, 0.40, 0.18, 3, True, 1.6)
res["normal"] = build("normal", 2.30, 2, 0.21, 0.12, 4, False, 1.1)
res["hard"] = build("hard", 3.55, 1, 0.11, 0.10, 5, False, 0.9)

import json as J
print('"""りず『ひとつぶんの晴れ』（ゲーム用89秒版）の譜面ソース：EASY / NORMAL / HARD（仮）。書き方は chartlib.py を参照。')
print()
print(f"テンポ：約134BPM（4分音符≒0.447秒、1小節≒1.79秒）。全体の自己相関は約67BPM（半分）にも山があり約134BPMを採用。")
print(f"songs.json の beatMap は librosa の拍追跡（ibi 0.44〜0.45秒、64〜66秒付近だけ約0.5秒に緩む）。bar0 = {grid[0]:.2f}秒（拍頭の低域エネルギーが最大の位相。聴取未確認）。")
print("0.4秒前後までは導入でノーツなし。85秒からフェードアウト（89秒終了）なので、ノーツ・ホールドとも 83.4 秒までに終える。")
print("区間（推定。歌詞・サビ位置は聴いていない）: bar0-3 導入 / bar4-15 区間A / bar16-29 区間B / bar30- 区間C")
print("置く位置は、帯域別オンセット強度の合成値＋拍頭/裏拍ボーナスが強いスロットを機械的に拾い、密度目標（EASY約1.2 / NORMAL約2.3 / HARD約3.5 ノーツ/秒）に合わせた。")
print("chartlib の規則（同じ手160ms・長押し中は逆の手のみ）で衝突したものは外す。長押しは次の音まで十分あいた拍頭の音を数か所だけ変換。同時押しなし。")
print(f"実行: python3 tools/charts/{SID}.py → public/data/charts/{SID}.{{easy,normal,hard}}.json")
print('"""')
print("from chartlib import compile_chart, write_chart\n")
print(f'SID = "{SID}"')
last_bar = max(max(b for b in r[0]) for r in res.values())
print("SECTIONS = [")
for nm, a, b in [("導入", 0, 3), ("区間A", 4, 15), ("区間B", 16, 29), ("区間C", 30, last_bar + 3)]:
    print(f'    {{"name": "{nm}", "fromBar": {a}, "toBar": {b}}},')
print("]\n")
for k, (bars, acc, holds) in res.items():
    print(f"{k} = {{")
    items = [f"{b}: {J.dumps(v)}" for b, v in bars.items()]
    line = "   "
    for it in items:
        if len(line) + len(it) > 118:
            print(line); line = "   "
        line += " " + it + ","
    print(line); print("}\n")
print('NOTE = "仮譜面（{d}）。89秒版を約134BPMの拍位置で解析し、音の強い位置から自動で候補を拾って整形（小節頭の位相・実際の拍は聴取未確認）。85秒以降のフェードにノーツなし"')
print('for d, bars in (("easy", easy), ("normal", normal), ("hard", hard)):')
print('    chart = compile_chart(bars, SID, d, "0.1.0-draft", SECTIONS, NOTE.format(d=d.upper()))')
print('    write_chart(chart, f"{SID}.{d}.json")')
