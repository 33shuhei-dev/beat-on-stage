import { describe, expect, it } from 'vitest';
import { JUDGE, MAX_SCORE } from '../config';
import type { TimedNote } from '../types';
import { Judge } from './judge';

const tap = (id: number, lane: number, t: number): TimedNote => ({ id, lane, t });
const hold = (id: number, lane: number, t: number, end: number): TimedNote => ({ id, lane, t, end });

describe('判定境界', () => {
  const cases: [number, string][] = [
    [0, 'perfect'],
    [JUDGE.perfectMs, 'perfect'],
    [-JUDGE.perfectMs, 'perfect'],
    [JUDGE.perfectMs + 1, 'great'],
    [JUDGE.greatMs, 'great'],
    [-(JUDGE.greatMs + 1), 'good'],
    [JUDGE.goodMs, 'good'],
    [-JUDGE.goodMs, 'good'],
    [-(JUDGE.goodMs + 1), 'miss'],
    [-JUDGE.missEarlyMs, 'miss'],
  ];
  for (const [d, g] of cases) {
    it(`Δ=${d}ms → ${g}`, () => {
      const j = new Judge([tap(0, 1, 1000)]);
      const ev = j.press(1, 1000 + d, 'k');
      expect(ev[0]?.grade).toBe(g);
    });
  }
  it('missEarly より早い押下は空打ち（何も起きない）', () => {
    const j = new Judge([tap(0, 1, 1000)]);
    expect(j.press(1, 1000 - JUDGE.missEarlyMs - 1, 'k')).toEqual([]);
    expect(j.stats.judgedUnits).toBe(0);
    expect(j.score).toBe(0);
  });
  it('GOOD幅より遅い押下は無視され、時間経過で自動MISS', () => {
    const j = new Judge([tap(0, 1, 1000)]);
    expect(j.press(1, 1000 + JUDGE.goodMs + 1, 'k')).toEqual([]);
    const ev = j.update(1000 + JUDGE.goodMs + 1);
    expect(ev.map((e) => e.grade)).toEqual(['miss']);
  });
  it('別レーンの押下は判定しない', () => {
    const j = new Judge([tap(0, 1, 1000)]);
    expect(j.press(2, 1000, 'k')).toEqual([]);
  });
});

describe('得点', () => {
  it('全PERFECTで100万点ちょうど（タップ+長押し混在）', () => {
    const notes = [tap(0, 0, 1000), tap(1, 3, 1000), hold(2, 1, 1500, 2500), tap(3, 2, 2000), tap(4, 0, 3000)];
    const j = new Judge(notes);
    j.press(0, 1000, 'a');
    j.press(3, 1000, 'b');
    j.press(1, 1500, 'c');
    j.press(2, 2000, 'd');
    j.release('d', 2010);
    j.update(2500); // 長押し終端到達
    j.release('c', 2600); // 終端後に離しても二重計上しない
    j.press(0, 3000, 'e');
    j.update(10000);
    expect(j.complete).toBe(true);
    expect(j.stats.totalUnits).toBe(6);
    expect(j.stats.judgedUnits).toBe(6);
    expect(j.score).toBe(MAX_SCORE);
    expect(j.stats.maxCombo).toBe(6);
  });
  it('全MISSで0点、コンボ0', () => {
    const j = new Judge([tap(0, 0, 1000), hold(1, 1, 2000, 3000)]);
    j.update(5000);
    expect(j.score).toBe(0);
    expect(j.stats.miss).toBe(3);
    expect(j.stats.maxCombo).toBe(0);
    expect(j.complete).toBe(true);
  });
  it('重みどおりの部分点（1.0/0.7/0.3/0）', () => {
    const j = new Judge([tap(0, 0, 1000), tap(1, 0, 2000), tap(2, 0, 3000), tap(3, 0, 4000)]);
    j.press(0, 1000, 'a');
    j.press(0, 2000 + 60, 'a');
    j.press(0, 3000 - 120, 'a');
    j.update(10000);
    expect(j.score).toBe(Math.floor((MAX_SCORE * 2.0) / 4));
    expect(j.stats.fast).toBe(1);
    expect(j.stats.slow).toBe(1);
  });
  it('押しっぱなし・連打でも同じノーツは1回しか加点されない', () => {
    const j = new Judge([tap(0, 0, 1000)]);
    j.press(0, 990, 'a');
    j.press(0, 1000, 'a');
    j.press(0, 1010, 'b');
    expect(j.stats.judgedUnits).toBe(1);
    expect(j.score).toBe(MAX_SCORE);
  });
  it('1回の押下で後ろのノーツを先取りしない（連続ノーツ）', () => {
    const j = new Judge([tap(0, 0, 1000), tap(1, 0, 1100)]);
    const ev = j.press(0, 1100, 'a'); // 1つ目に対してΔ=+100 → GOOD
    expect(ev[0].noteId).toBe(0);
    expect(ev[0].grade).toBe('good');
    expect(j.press(0, 1100, 'b')[0].noteId).toBe(1);
  });
  it('空打ちで加点されない', () => {
    const j = new Judge([tap(0, 0, 5000)]);
    for (let t = 0; t < 4000; t += 50) j.press(t % 200 === 0 ? 1 : 2, t, 'x');
    expect(j.score).toBe(0);
    expect(j.stats.judgedUnits).toBe(0);
  });
});

describe('長押し', () => {
  it('開始を取り逃すと開始・終端とも MISS', () => {
    const j = new Judge([hold(0, 1, 1000, 2000)]);
    const ev = j.update(1000 + JUDGE.goodMs + 1);
    expect(ev.map((e) => `${e.part}:${e.grade}`)).toEqual(['head:miss', 'tail:miss']);
    // その後押しても何も起きない
    expect(j.press(1, 1500, 'a')).toEqual([]);
    j.update(3000);
    expect(j.stats.judgedUnits).toBe(2);
  });
  it('早離しは終端 MISS、開始の判定は残る', () => {
    const j = new Judge([hold(0, 1, 1000, 2000)]);
    expect(j.press(1, 1000, 'a')[0].grade).toBe('perfect');
    const ev = j.release('a', 1500);
    expect(ev.map((e) => `${e.part}:${e.grade}`)).toEqual(['tail:miss']);
    j.update(3000);
    expect(j.stats.judgedUnits).toBe(2);
    expect(j.score).toBe(MAX_SCORE / 2);
  });
  it('終端直前（猶予内）に離しても成功', () => {
    const j = new Judge([hold(0, 1, 1000, 2000)]);
    j.press(1, 1000, 'a');
    expect(j.release('a', 2000 - JUDGE.holdReleaseGraceMs)[0].grade).toBe('perfect');
  });
  it('終端まで維持すると自動で終端成功、その後の離しは何もしない', () => {
    const j = new Judge([hold(0, 1, 1000, 2000)]);
    j.press(1, 1000, 'a');
    expect(j.update(1999)).toEqual([]);
    expect(j.update(2000).map((e) => e.grade)).toEqual(['perfect']);
    expect(j.release('a', 2100)).toEqual([]);
    expect(j.score).toBe(MAX_SCORE);
  });
  it('長押し中に別レーンを叩いても阻害しない', () => {
    const j = new Judge([hold(0, 0, 1000, 3000), tap(1, 3, 1500), tap(2, 2, 2000)]);
    j.press(0, 1000, 'L');
    expect(j.press(3, 1500, 'R')[0].grade).toBe('perfect');
    j.release('R', 1550);
    expect(j.press(2, 2000, 'R2')[0].grade).toBe('perfect');
    j.release('R2', 2050);
    expect(j.isHeld(0)).toBe(true);
    j.update(3000);
    expect(j.score).toBe(MAX_SCORE);
  });
  it('一時停止時の releaseAll は保持中の長押しを離した扱いにする', () => {
    const j = new Judge([hold(0, 0, 1000, 3000)]);
    j.press(0, 1000, 'L');
    const ev = j.releaseAll(1500);
    expect(ev.map((e) => e.grade)).toEqual(['miss']);
  });
});
