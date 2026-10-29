import type { TimedNote } from '../types';
import { makeClickTrack } from './audio';

/** 初回の操作練習：100BPMのクリック音に合わせた短い譜面（タップ・同時押し・長押し＋別レーン） */
export function buildPractice(ctx: BaseAudioContext) {
  const beat = 0.6;
  const first = 0.6;
  const beats = Array.from({ length: 22 }, (_, i) => first + i * beat);
  const b = (i: number) => beats[i] * 1000;
  const raw: Omit<TimedNote, 'id'>[] = [
    { lane: 0, t: b(4) },
    { lane: 1, t: b(5) },
    { lane: 2, t: b(6) },
    { lane: 3, t: b(7) },
    { lane: 0, t: b(8) },
    { lane: 3, t: b(8) },
    { lane: 1, t: b(10) },
    { lane: 2, t: b(10) },
    { lane: 1, t: b(12), end: b(15) },
    { lane: 2, t: b(13) },
    { lane: 3, t: b(14) },
    { lane: 0, t: b(17) },
    { lane: 2, t: b(17) },
    { lane: 1, t: b(18) },
    { lane: 3, t: b(19) },
  ];
  const notes: TimedNote[] = raw.map((n, id) => ({ ...n, id }));
  const buffer = makeClickTrack(ctx, beats, 4, beats[beats.length - 1] + 1.2);
  const barLines = beats.filter((_, i) => i % 4 === 0).map((s) => s * 1000);
  return { notes, buffer, barLines };
}

/** タイミング調整テスト用：120BPMのクリック */
export function buildCalibration(ctx: BaseAudioContext) {
  const beat = 0.5;
  const beats = Array.from({ length: 32 }, (_, i) => 1 + i * beat);
  const buffer = makeClickTrack(ctx, beats, 4, beats[beats.length - 1] + 1);
  return { beats, buffer };
}
