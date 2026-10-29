import type { ChartData, TimedNote } from '../types';

/**
 * 拍番号（小数可）→ 曲頭からの秒。beatMap[i] = i 拍目の秒。
 * 区間内は線形補間、範囲外は端の拍間隔で外挿する。
 */
export function beatToSeconds(beatMap: number[], beat: number): number {
  const n = beatMap.length;
  if (n < 2) throw new Error('beatMap needs at least 2 beats');
  if (beat <= 0) return beatMap[0] + beat * (beatMap[1] - beatMap[0]);
  if (beat >= n - 1) return beatMap[n - 1] + (beat - (n - 1)) * (beatMap[n - 1] - beatMap[n - 2]);
  const i = Math.floor(beat);
  const f = beat - i;
  return beatMap[i] + f * (beatMap[i + 1] - beatMap[i]);
}

/** 小節・スロット表記の譜面を、テンポマップでms時刻のノーツへ変換 */
export function buildTimedNotes(chart: ChartData, beatMap: number[], beatsPerBar = 4): TimedNote[] {
  const slotsPerBeat = chart.grid / beatsPerBar;
  const toMs = (bar: number, slot: number) =>
    beatToSeconds(beatMap, bar * beatsPerBar + slot / slotsPerBeat) * 1000 + chart.offsetMs;
  const notes: TimedNote[] = chart.notes.map((n, i) => {
    const t = toMs(n.bar, n.slot);
    const note: TimedNote = { id: i, lane: n.lane, t };
    if (n.endBar !== undefined && n.endSlot !== undefined) note.end = toMs(n.endBar, n.endSlot);
    return note;
  });
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  notes.forEach((n, i) => (n.id = i));
  return notes;
}

/** 小節線の時刻(ms)一覧（描画用） */
export function barLinesMs(beatMap: number[], beatsPerBar = 4): number[] {
  const out: number[] = [];
  for (let b = 0; b < beatMap.length; b += beatsPerBar) out.push(beatMap[b] * 1000);
  return out;
}
