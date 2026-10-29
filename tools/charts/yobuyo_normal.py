"""何度でも呼ぶよ / NORMAL 譜面ソース（手配置・仮）。

位置は「小節・16分スロット」。秒への変換はゲーム側が songs.json の beatMap で行う。
  bar 0 = beatMap[0..3]（1.08秒〜。曲頭〜1.08秒は拍の前の導入で、ノーツなし）
  slot: 0..15（16分音符単位。0=1拍目, 4=2拍目, 8=3拍目, 12=4拍目。2,6,10,14=裏拍(8分)）
  lanes: 0,1=左手側 / 2,3=右手側。同時押しは必ず左右1つずつ。

テンポは約162→166 BPM（1拍≒0.37秒、1小節≒1.47秒）。NORMALなので基本は4分音符、フレーズの切れ目や
歌が詰まる箇所にだけ8分の裏拍を足す。8分が続くのは同じ手に連続させず、左右交互にする。

リズムの選び方（自動解析ベース。聴取未確認）:
  tools/analysis の16分オンセット表（打楽器・中域・全帯域）で、各小節の「強い音の立ち上がり」の位置を見て、
  拍頭＋その小節で目立つ裏拍を採った。小節頭のキック/シンセの拍に必ず1つ置く。
構成（推定。波形の変化量と音量から。歌詞・歌い出しは聴いていない）:
  bar1-7  導入（歌が入る手前）  bar8-15 Aメロ相当（歌が詰まる）  bar14-15 盛り上げ
  bar16-31 サビ相当（4小節の2周期×4）  bar32-35 歌が薄い区間（間奏相当）
  bar36-47 サビ相当（再び）  bar48-51 ラスト。bar51 は歌が長く伸びる箇所を長押しにして、77秒からのフェードに入る前に終える。
同じフレーズは同じ配置を再利用している（Aメロ前半/後半、サビ前半と後半は左右反転、サビ2は反転の組み替え）。

実行: python3 tools/charts/yobuyo_normal.py → public/data/charts/yobuyo.normal.json
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


bars = {}

# ---- 導入 bar1-7：キックの拍を4分で。bar5-6 で少し足し、bar7 の終わりで長押しして歌へ
bars[1] = [T(0, 1), T(4, 2), T(12, 1)]
bars[2] = [T(0, 2), T(4, 1), T(12, 2)]
bars[3] = [T(0, 1), T(4, 2), T(8, 1), T(12, 3)]
bars[4] = [T(0, 2), T(4, 1), T(8, 3), T(12, 0)]
bars[5] = [T(0, 1), T(4, 2), T(12, 1), T(14, 2)]
bars[6] = [T(0, 2), T(4, 0), T(8, 3), T(14, 1)]
bars[7] = [T(0, 1), T(4, 2), H(8, 3, 14), T(10, 0)]  # 右手長押しの間に左手1打。bar8頭の同時押しへ

# ---- Aメロ相当 bar8-15：2小節ずつ A / B / A' / B'
A1 = [T(0, 1, 2), T(4, 0), T(8, 3), T(12, 1)]
A2 = [T(0, 3), T(4, 1), T(8, 2), T(12, 0)]
B1 = [T(0, 1), T(4, 2), T(8, 1), T(12, 2)]
B2 = [T(0, 3), T(4, 1), T(8, 2), T(12, 0)]
bars[8], bars[9], bars[10], bars[11] = A1, A2, B1, B2
# A' ：歌が長く伸びる bar12 を右手の長押しに（その間は左手だけ）
bars[12] = [T(0, 1, 2), H(4, 3, 0, 1), T(8, 0), T(12, 1)]
bars[13] = [T(0, 0), T(4, 3), T(8, 1), T(12, 2)]
# bar14-15：ドラムが入る盛り上げ。bar15 は裏拍を足してサビへ駆け上がる
bars[14] = [T(0, 1), T(4, 2), T(8, 0), T(12, 3)]
bars[15] = [T(0, 2), T(2, 1), T(4, 3), T(8, 0), T(12, 2), T(14, 1)]

# ---- サビ相当 bar16-23（前半）
C = {
    16: [T(0, 0, 3), T(4, 1), T(8, 2), T(12, 0)],
    17: [T(0, 2), T(4, 1), T(8, 3), T(12, 0)],
    18: [T(0, 1), T(4, 2), T(8, 0), T(12, 3)],
    19: [T(0, 2), T(4, 0), T(8, 3), T(12, 1)],
    20: [T(0, 0, 3), T(4, 2), T(8, 1), T(12, 3)],
    21: [T(0, 1), T(4, 3), T(8, 0), T(12, 2)],
    22: [T(0, 3), T(4, 1), T(8, 2), T(12, 0)],
    23: [T(0, 1), T(4, 2), T(8, 1), T(10, 3), T(12, 0), T(14, 2)],
}
bars.update(C)

# ---- サビ相当 bar24-31（後半）：前半の左右反転。bar31 は右手長押しを bar32 頭で離して区切る
for k in range(8):
    bars[24 + k] = mirror(C[16 + k])
bars[31] = [T(0, 2), T(4, 1), H(8, 3, 0, 1), T(10, 1), T(14, 0)]

# ---- 歌が薄い区間 bar32-35（間奏相当）：4分中心、長押しを1回
bars[32] = [T(0, 1), T(4, 2), T(8, 0), T(12, 3)]
bars[33] = [T(0, 2), T(4, 1), T(10, 3), T(12, 0)]
bars[34] = [T(0, 1), H(4, 2, 12), T(8, 0), T(14, 3)]
bars[35] = [T(0, 2), T(4, 1), T(8, 3), T(12, 0)]

# ---- サビ相当 bar36-47（2回目）：前半=bar16-19の反転、中盤=元の向き、終盤=bar20-23の反転
for k in range(4):
    bars[36 + k] = mirror(C[16 + k])
bars[38].append(T(14, 2))
bars[36] = [T(0, 1, 2), T(4, 2), T(8, 1), T(12, 3), T(14, 0)]   # 区間頭は中央寄りの同時押しで別の見え方に
bars[40] = [T(0, 1, 2), T(4, 0), T(8, 3), T(10, 1), T(12, 2)]
bars[41] = [T(0, 2), T(2, 1), T(4, 3), T(8, 0), T(12, 2)]
bars[42] = [T(0, 1), T(4, 2), T(8, 0), T(12, 3), T(14, 1)]
bars[43] = [T(0, 3), T(4, 0), T(6, 2), T(8, 1), H(12, 3, 0, 1)]   # 右手長押しを bar44 頭へ
for k in range(4):
    bars[44 + k] = mirror(C[20 + k])
bars[44] = [T(0, 1), T(4, 2), T(8, 0), T(12, 3), T(14, 1)]
bars[46].append(T(14, 0))
bars[47] = [T(0, 2), T(4, 1), T(8, 3), T(10, 0), T(12, 2), T(14, 1)]

# ---- ラスト bar48-51：bar51 は歌が長く伸びる所を長押し、最後は同時押しで締めてフェードへ
bars[48] = [T(0, 0, 3), T(4, 1), T(6, 2), T(10, 0), T(12, 3)]
bars[49] = [T(0, 2), T(4, 1), T(8, 3), T(12, 0), T(14, 2)]
bars[50] = [T(0, 1), T(4, 2), T(6, 0), T(8, 3), T(12, 1)]
bars[51] = [H(0, 3, 10), T(4, 1), T(8, 0), T(12, 1, 2)]

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
    "songId": "yobuyo",
    "difficulty": "normal",
    "chartVersion": "0.1.0-draft",
    "status": "draft",
    "statusNote": "仮譜面。自動解析した拍・オンセットを元に手配置。歌のフレーズは聴取しておらず、実機プレイでの気持ちよさは未確認",
    "grid": 16,
    "offsetMs": 0,
    "sections": [
        {"name": "導入", "fromBar": 1, "toBar": 7},
        {"name": "Aメロ相当", "fromBar": 8, "toBar": 15},
        {"name": "サビ相当", "fromBar": 16, "toBar": 31},
        {"name": "間奏相当", "fromBar": 32, "toBar": 35},
        {"name": "サビ相当2", "fromBar": 36, "toBar": 47},
        {"name": "ラスト", "fromBar": 48, "toBar": 51},
    ],
    "notes": notes,
}
out = os.path.join(os.path.dirname(__file__), "..", "..", "public", "data", "charts", "yobuyo.normal.json")
with open(out, "w") as f:
    json.dump(chart, f, ensure_ascii=False, separators=(",", ":"))
taps = sum(1 for n in notes if "endBar" not in n)
holds = len(notes) - taps
print(f"notes={len(notes)} taps={taps} holds={holds} units={taps + 2 * holds}")
