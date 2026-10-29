"""何度でも呼ぶよ / EASY 譜面ソース（手配置・仮）。書き方は chartlib.py を参照。

方針：テンポが速い曲（約164 BPM）なので、EASYは「2拍に1回（1・3拍目）」を土台にし、
サビだけ4分音符（約0.37秒）を足す。同時押しなし。長押しは単独（押している間は何も打たない）で、
4小節のまとまりの終わりに置く。長押しの終わりと同時に次のノーツは置かない。
  - 導入・間奏相当は「0 8」だけ。歌が詰まるヴァース相当は、1小節おきに4分を足す。
  - サビ相当の4小節ループ：[4分×4 → 2つ → 4分×4 → 2つ＋長押し]。2回目以降のループ頭は、長押しが終わった後の拍（4）から。
  - 最後（bar51）は歌が長く伸びる所を単独の長押しで締める。
実行: python3 tools/charts/yobuyo_easy.py → public/data/charts/yobuyo.easy.json
"""
from chartlib import compile_chart, write_chart

bars = {
    # 導入（bar1-7）：1・3拍目だけ。bar7 の3拍目から最初の長押し（単独）
    1: "0 8", 2: "0 8", 3: "0 8", 4: "0 8", 5: "0 8", 6: "0 8", 7: "0 8h>0",
    # Aメロ相当（bar8-15）：歌が詰まるので1小節おきに4分を足す。bar12 のフレーズ終わりに長押し
    8: "4 8", 9: "0 4 8", 10: "0 8", 11: "0 8 12",
    12: "0 8h>0", 13: "4 8", 14: "0 8", 15: "0 4 8 12",
}
# サビ相当（bar16-31）と サビ相当2（bar36-47）：4小節ループ
LOOP = ["0 4 8 12", "0 8", "0 4 8 12", "0 8h>0"]
LOOP_AFTER_HOLD = ["4 8 12", "0 8", "0 4 8 12", "0 8h>0"]
for start in (16, 20, 24, 28):
    for k, text in enumerate(LOOP if start == 16 else LOOP_AFTER_HOLD):
        bars[start + k] = text
bars[31] = "0 4 8 12"  # 間奏相当へ入る前は長押しなしで切る
# 歌が薄い区間（bar32-35）：2つずつ
for b in range(32, 36):
    bars[b] = "0 8"
for start in (36, 40, 44):
    for k, text in enumerate(LOOP if start == 36 else LOOP_AFTER_HOLD):
        bars[start + k] = text
# ラスト（bar48-51）
bars[48] = "4 8 12"
bars[49] = "0 4 8 12"
bars[50] = "0 4 8 12"
bars[51] = "0h10"  # 歌が長く伸びる所。フェード（77秒）の前に離す

sections = [
    {"name": "導入", "fromBar": 1, "toBar": 7}, {"name": "Aメロ相当", "fromBar": 8, "toBar": 15},
    {"name": "サビ相当", "fromBar": 16, "toBar": 31}, {"name": "間奏相当", "fromBar": 32, "toBar": 35},
    {"name": "サビ相当2", "fromBar": 36, "toBar": 47}, {"name": "ラスト", "fromBar": 48, "toBar": 51},
]
chart = compile_chart(bars, "yobuyo", "easy", "0.1.0-draft", sections,
                      "仮譜面（EASY）。1・3拍目中心、サビだけ4分。同時押しなし・長押しは単独。聴取・実機プレイでの手応えは未確認")
write_chart(chart, "yobuyo.easy.json")
