"""譜面ソース共通ライブラリ（EASY/HARD 用）。

小節ごとに「どの16分スロットに何を置くか」を手で書き、レーン（4本のどれか）は
親指2本で無理なく押せるルールで自動配置する。配置の意図は各譜面ソースのコメントに書く。

書き方（1小節=1文字列、空白区切り）:
  "0"        スロット0にタップ（レーンは自動）
  "4@2"      スロット4にレーン2のタップ
  "0c"       スロット0に同時押し（左右1つずつ。レーンは自動）
  "0:13"     スロット0にレーン1と3の同時押し
  "8h12"     スロット8から同じ小節のスロット12まで長押し
  "8h>0"     スロット8から次の小節のスロット0まで長押し（">"が増えるごとに1小節先）
  "~"        この小節の最初のノーツから、左右の手の順番を入れ替える（反復の見え方を変える）
  "-"        空の小節
スロット: 0..15（16分音符。0=1拍目、4=2拍目、8=3拍目、12=4拍目、2/6/10/14=裏拍の8分）

自動配置のルール:
  - 単打は前のノーツと逆の手（左=レーン0,1／右=レーン2,3）。同じ手の次のノーツまで160ms以上あける。
  - 長押し中は、長押しをしていない手だけで打つ。長押しが終わってから160ms以内は、その手を使わない。
  - 手が足りない（無理な配置）ときは例外を出して知らせる。黙って崩さない。
  - レーンは同じ手の中で前回と違うほうへ（1↔0、2↔3）。同時押しは (1,2)(0,3)(1,3)(0,2) を順番に使う。
"""
import json, os, re

MIN_GAP = 0.16  # 同じ手の次のノーツまでの最小間隔（秒）
_TOK = re.compile(r"^(\d+)(?:@(\d))?(?:(c)|:(\d)(\d)|h(>*)(\d+))?$")
_CHORDS = [(1, 2), (0, 3), (1, 3), (0, 2)]

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def load_beatmap(song_id):
    songs = json.load(open(os.path.join(ROOT, "public", "data", "songs.json")))
    return [s for s in songs if s["id"] == song_id][0]["beatMap"]


def beat_time(bm, bar, slot):
    b = bar * 4 + slot / 4
    i = min(int(b), len(bm) - 2)
    return bm[i] + (b - i) * (bm[i + 1] - bm[i])


def parse_bar(bar, text):
    flip = False
    ev = []
    for tok in text.split():
        if tok == "-":
            continue
        if tok == "~":
            flip = True
            continue
        m = _TOK.match(tok)
        if not m:
            raise ValueError(f"bar {bar}: 解釈できない記法 {tok!r}")
        slot, lane, chord, l1, l2, arrows, hend = m.groups()
        e = {"bar": bar, "slot": int(slot)}
        if not 0 <= e["slot"] < 16:
            raise ValueError(f"bar {bar}: スロットは0..15 {tok!r}")
        if lane is not None:
            e["lane"] = int(lane)
        if chord:
            e["kind"] = "chord"
        elif l1 is not None:
            e["kind"] = "chord"
            e["lanes"] = (int(l1), int(l2))
        elif hend is not None:
            e["kind"] = "hold"
            e["endBar"] = bar + len(arrows)
            e["endSlot"] = int(hend)
        else:
            e["kind"] = "tap"
        ev.append(e)
    if ev and flip:
        ev[0]["flip"] = True
    return ev


def compile_chart(bars, song_id, difficulty, version, sections, status_note, hand0=0):
    """bars: {小節番号: 文字列}。戻り値: 譜面dict"""
    bm = load_beatmap(song_id)
    events = []
    for b in sorted(bars):
        events += parse_bar(b, bars[b])
    events.sort(key=lambda e: (e["bar"], e["slot"]))

    free = [0.0, 0.0]  # 手ごとの「次に押せる時刻」
    last_lane = [1, 2]
    last_hand = 1 - hand0  # 次の単打はこの逆の手から
    notes = []
    cnt = 0

    def err(e, msg):
        raise ValueError(f"{song_id}/{difficulty} bar {e['bar']} slot {e['slot']}: {msg}")

    def lane_for(h, prefer_outer=False):
        lanes = (0, 1) if h == 0 else (3, 2)  # 先頭が外側
        if prefer_outer:
            return lanes[0]
        other = [l for l in lanes if l != last_lane[h]]
        return other[0] if other else lanes[0]

    for e in events:
        t = beat_time(bm, e["bar"], e["slot"])
        e["t"] = t
        if e.get("flip"):
            last_hand = 1 - last_hand
        kind = e["kind"]
        if kind == "chord":
            if free[0] > t + 1e-6 or free[1] > t + 1e-6:
                err(e, "同時押しの手が空いていない（直前のノーツが近すぎる／長押し中）")
            if "lanes" in e:
                l, r = sorted(e["lanes"])
                if not (l <= 1 and r >= 2):
                    err(e, "同時押しは左右1つずつ")
            else:
                cands = [c for c in _CHORDS if not (c[0] == last_lane[0] and c[1] == last_lane[1])]
                l, r = cands[cnt % len(cands)]
                cnt += 1
            for lane in (l, r):
                notes.append({"bar": e["bar"], "slot": e["slot"], "lane": lane})
            last_lane[0], last_lane[1] = l, r
            free[0] = free[1] = t + MIN_GAP
            continue
        # 単打 / 長押し：手を決める
        if "lane" in e:
            h = 0 if e["lane"] <= 1 else 1
            if free[h] > t + 1e-6:
                err(e, f"レーン{e['lane']}の手が空いていない")
            lane = e["lane"]
        else:
            h = 1 - last_hand
            if free[h] > t + 1e-6:
                h = 1 - h
                if free[h] > t + 1e-6:
                    err(e, "両手とも空いていない（間隔が近すぎる／長押し中の同時操作）")
            lane = lane_for(h, prefer_outer=(kind == "hold"))
        n = {"bar": e["bar"], "slot": e["slot"], "lane": lane}
        if kind == "hold":
            n["endBar"], n["endSlot"] = e["endBar"], e["endSlot"]
            te = beat_time(bm, e["endBar"], e["endSlot"])
            if te - t < 0.3:
                err(e, "長押しが短すぎる（300ms未満）")
            free[h] = te + MIN_GAP
        else:
            free[h] = t + MIN_GAP
        last_lane[h] = lane
        last_hand = h
        notes.append(n)
    return {
        "songId": song_id,
        "difficulty": difficulty,
        "chartVersion": version,
        "status": "draft",
        "statusNote": status_note,
        "grid": 16,
        "offsetMs": 0,
        "sections": sections,
        "notes": notes,
    }


def write_chart(chart, path_name):
    out = os.path.join(ROOT, "public", "data", "charts", path_name)
    with open(out, "w") as f:
        json.dump(chart, f, ensure_ascii=False, separators=(",", ":"))
    n = chart["notes"]
    holds = sum(1 for x in n if "endBar" in x)
    taps = len(n) - holds
    bm = load_beatmap(chart["songId"])
    ts = sorted(beat_time(bm, x["bar"], x["slot"]) for x in n)
    chords = len(n) - len({(x["bar"], x["slot"]) for x in n})
    print(f"{path_name}: notes={len(n)} taps={taps} holds={holds} chords={chords} units={taps + 2 * holds} "
          f"first={ts[0]:.2f}s last={ts[-1]:.2f}s avg={len(n) / (ts[-1] - ts[0]):.2f}/s")
