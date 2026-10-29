"""Vote Vote Vote / NORMAL 譜面ソース（手配置）。

位置は「小節・16分スロット」で書き、秒への変換はゲーム側が songs.json の beatMap で行う。
テンポが揺れている曲なので、ここで秒を固定しない。
  bar: 小節番号（bar 0 = beatMap[0..3]、1小節 = 4拍）
  slot: 0..15（16分音符単位。0=1拍目, 4=2拍目, 8=3拍目, 12=4拍目）
  lanes: [0..3]  0,1=左手側 / 2,3=右手側。同時押しは必ず左右に1つずつ
  hold: (endBar, endSlot)

リズムは tools/analysis/grid16.py の16分オンセット表を元に選んだ（自動解析ベース・聴取未確認）。
同じフレーズは同じ配置を再利用している（ヴァース2回、サビ4ブロック=前半2回同一/後半2回は左右反転）。

実行: python3 tools/charts/vote_normal.py  → public/data/charts/vote.normal.json
"""
import json, os

def T(slot, *lanes):
    return {"slot": slot, "lanes": list(lanes)}

def H(slot, lane, end_slot, end_bar_offset=0):
    return {"slot": slot, "lanes": [lane], "hold": (end_bar_offset, end_slot)}

def mirror(bar):
    out = []
    for n in bar:
        m = dict(n)
        m["lanes"] = [3 - l for l in n["lanes"]]
        out.append(m)
    return out

# ---- イントロ（bar1-8）: 4分中心 → 後半でトレシージョ(3+3+2)を入れる
intro = {
    1: [T(0, 1), T(8, 2), T(12, 1)],
    2: [T(0, 2), T(4, 1), T(8, 2), T(12, 3)],
    3: [T(0, 1), T(8, 2), T(12, 0)],
    4: [T(0, 3), T(8, 1), H(12, 2, 0, 1)],          # 4拍目から次小節頭まで長押し
    5: [T(0, 0), T(3, 3), T(6, 1), T(8, 2), T(12, 1)],
    6: [T(0, 2), T(4, 1), T(8, 3), T(10, 0), T(12, 2)],
    7: [T(0, 0), T(3, 3), T(6, 1), T(8, 2), T(12, 1), T(14, 2)],
    8: [T(0, 1, 2), T(4, 0), T(8, 3), H(12, 1, 0, 1)],
}

# ---- ヴァース（bar9-12 を bar13-16 で再利用）
verse = [
    [T(0, 2), T(4, 1), T(6, 2), T(8, 0), T(12, 3), T(14, 1)],
    [T(0, 1, 3), T(4, 2), T(6, 0), T(8, 3), T(12, 1)],
    [T(0, 2), T(4, 1), T(8, 3), T(10, 0), T(12, 2), T(14, 1)],
    [T(0, 0, 3), T(4, 1), T(8, 2), H(12, 1, 0, 1)],
]

# ---- プレサビ（bar17-20）: 一度落ち着き、bar20で8分の階段で盛り上げる
pre = {
    17: [T(0, 2), T(4, 1), T(8, 2), T(12, 1)],
    18: [T(0, 0), T(4, 3), T(6, 1), T(8, 2), T(12, 0)],
    19: [T(4, 1, 2), T(8, 0), T(12, 3)],
    20: [T(0, 1), T(4, 2), T(6, 1), T(8, 2), T(10, 0), T(12, 3)],
}

# ---- ブレイク（bar21, 音量が下がる1小節）: 休符多め
brk = {21: [T(4, 0, 3), H(8, 2, 14)]}

# ---- サビ 4小節ブロック（bar22-25, 26-29 同一 / 30-33, 34-37 は左右反転）
chorus = [
    [T(0, 0, 2), T(4, 3), T(6, 1), T(8, 2), T(12, 0), T(14, 3)],
    [T(0, 1), T(4, 2), T(8, 1), T(10, 3), T(12, 0)],
    [T(0, 1, 3), T(4, 0), T(6, 2), T(8, 1), T(10, 3), T(12, 2)],
    [T(0, 0), T(3, 2), T(6, 1), H(8, 3, 14), T(10, 0), T(12, 1)],   # 右手長押し中に左手2打
]
chorus_last_bar = [T(0, 3), T(4, 0), T(6, 2), T(8, 1), T(10, 3), T(12, 0), T(14, 2)]

# ---- アウトロ（bar38-39）: 39小節頭の同時押しで締め。72秒からのフェードには置かない
outro = {
    38: [T(0, 1, 2), T(4, 0), T(8, 3), T(12, 1)],
    39: [T(0, 0, 3)],
}

bars = {}
bars.update(intro)
for i, b in enumerate(verse):
    bars[9 + i] = b
    bars[13 + i] = b
bars.update(pre)
bars.update(brk)
for i, b in enumerate(chorus):
    bars[22 + i] = b
    bars[26 + i] = b
    bars[30 + i] = mirror(b)
    bars[34 + i] = mirror(b)
bars[37] = chorus_last_bar
bars.update(outro)

notes = []
for bar in sorted(bars):
    for n in bars[bar]:
        for lane in n["lanes"]:
            e = {"bar": bar, "slot": n["slot"], "lane": lane}
            if "hold" in n:
                off, es = n["hold"]
                e["endBar"] = bar + off
                e["endSlot"] = es
            notes.append(e)

chart = {
    "songId": "vote",
    "difficulty": "normal",
    "chartVersion": "0.1.0-draft",
    "status": "draft",
    "statusNote": "仮譜面。自動解析した拍・オンセットを元に手配置。聴取・実機プレイでの気持ちよさは未確認",
    "grid": 16,
    "offsetMs": 0,
    "sections": [
        {"name": "イントロ", "fromBar": 1, "toBar": 8},
        {"name": "ヴァース", "fromBar": 9, "toBar": 16},
        {"name": "プレサビ", "fromBar": 17, "toBar": 20},
        {"name": "ブレイク", "fromBar": 21, "toBar": 21},
        {"name": "サビ", "fromBar": 22, "toBar": 37},
        {"name": "アウトロ", "fromBar": 38, "toBar": 39},
    ],
    "notes": notes,
}
out = os.path.join(os.path.dirname(__file__), "..", "..", "public", "data", "charts", "vote.normal.json")
with open(out, "w") as f:
    json.dump(chart, f, ensure_ascii=False, separators=(",", ":"))
taps = sum(1 for n in notes if "endBar" not in n)
holds = len(notes) - taps
print(f"notes={len(notes)} taps={taps} holds={holds} units={taps + 2 * holds}")
