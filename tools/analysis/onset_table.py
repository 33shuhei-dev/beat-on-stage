"""譜面設計用：曲の beatMap に合わせた16分グリッドのオンセット強度表（0-9）。NORMAL譜面のノーツ位置も * で重ねる。
usage: python3 -I onset_table.py <bands.npy> <songs.json> <songId> [chart.json]
出力: 小節ごとに 時刻 | 全帯域(F) | 中域=歌/シンセ(M) | 低域=キック(L) | 高域=ハイハット(H) | 既存譜面(*)
"""
import sys, json, numpy as np
low, mid, hi, full = np.load(sys.argv[1]); fr = 22050 / 64
song = [s for s in json.load(open(sys.argv[2])) if s['id'] == sys.argv[3]][0]
bm = np.array(song['beatMap'])
chart = json.load(open(sys.argv[4])) if len(sys.argv) > 4 else None
def b2s(b):
    i = int(np.clip(np.floor(b), 0, len(bm) - 2)); return bm[i] + (b - i) * (bm[i + 1] - bm[i])
def at(e, t, w=0.022):
    a = max(0, int((t - w) * fr)); c = int((t + w) * fr); return e[a:c].max() if c > a else 0
nb = (len(bm) - 1) // 4
mark = set()
if chart:
    for n in chart['notes']: mark.add((n['bar'], n['slot']))
def row(e, b):
    out = ''
    for s in range(16):
        v = at(e, b2s(b * 4 + s / 4)); out += str(min(9, int(v * 14))) if v > 0.12 else '.'
    return out
print('bar   time  | F                | M                | L                | H                | chart')
for b in range(nb):
    ch = ''.join('*' if (b, s) in mark else '.' for s in range(16))
    print(f'{b:3d} {b2s(b*4):6.2f} | {row(full,b)} | {row(mid,b)} | {row(low,b)} | {row(hi,b)} | {ch}')
