import { describe, expect, it } from 'vitest';
import { REACTION } from '../config';
import { isComboMilestone, PRIORITY, ReactionController, resultState } from './reaction';

const mk = () => new ReactionController();
/** 1フレーム分の判定を入れて tick する */
function frame(c: ReactionController, now: number, ...ev: ['perfect' | 'great' | 'good' | 'miss', number][]) {
  for (const [g, combo] of ev) c.judge(g, combo);
  return c.tick(now);
}

describe('優先順位', () => {
  it('README の順序どおり', () => {
    const order = ['best', 'clear', 'ready', 'select', 'combo', 'cheer', 'miss', 'perfect', 'hit', 'idle'] as const;
    for (let i = 1; i < order.length; i++) expect(PRIORITY[order[i - 1]]).toBeGreaterThanOrEqual(PRIORITY[order[i]]);
    expect(PRIORITY.ready).toBeGreaterThan(PRIORITY.select);
    expect(PRIORITY.select).toBeGreaterThan(PRIORITY.combo);
    expect(PRIORITY.combo).toBeGreaterThan(PRIORITY.cheer);
    expect(PRIORITY.cheer).toBeGreaterThan(PRIORITY.miss);
    expect(PRIORITY.miss).toBeGreaterThan(PRIORITY.perfect);
    expect(PRIORITY.perfect).toBeGreaterThan(PRIORITY.hit);
    expect(PRIORITY.hit).toBeGreaterThan(PRIORITY.idle);
  });
});

describe('コンボ節目', () => {
  it('25/50/100/150/200… だけ', () => {
    const hits = Array.from({ length: 260 }, (_, i) => i).filter(isComboMilestone);
    expect(hits).toEqual([25, 50, 100, 150, 200, 250]);
  });
});

describe('結果ポーズ', () => {
  it('初回は clear、更新は best、同点・低下は clear、オートプレイは常に clear', () => {
    expect(resultState({ autoplay: false, hadPreviousBest: false, improved: true })).toBe('clear');
    expect(resultState({ autoplay: false, hadPreviousBest: true, improved: true })).toBe('best');
    expect(resultState({ autoplay: false, hadPreviousBest: true, improved: false })).toBe('clear');
    expect(resultState({ autoplay: true, hadPreviousBest: true, improved: true })).toBe('clear');
  });
});

describe('表示時間と最短間隔', () => {
  it('hit は 180ms 表示して idle に戻る', () => {
    const c = mk();
    expect(frame(c, 1000, ['good', 1])).toBe('hit');
    expect(c.tick(1000 + REACTION.hit.ms - 1)).toBe('hit');
    expect(c.tick(1000 + REACTION.hit.ms)).toBe('idle');
  });
  it('hit は 500ms 未満では再発火しない', () => {
    const c = mk();
    frame(c, 1000, ['great', 1]);
    expect(frame(c, 1300, ['great', 2])).toBe('idle');
    expect(frame(c, 1499, ['great', 3])).toBe('idle');
    expect(frame(c, 1500, ['great', 4])).toBe('hit');
  });
  it('perfect は 240ms 表示・700ms 未満では再発火しない', () => {
    const c = mk();
    expect(frame(c, 0, ['perfect', 1])).toBe('perfect');
    expect(c.tick(239)).toBe('perfect');
    expect(c.tick(240)).toBe('idle');
    expect(frame(c, 699, ['perfect', 2])).toBe('idle');
    expect(frame(c, 700, ['perfect', 3])).toBe('perfect');
  });
  it('ゲートで止まった perfect を hit に格下げして出さない', () => {
    const c = mk();
    frame(c, 0, ['perfect', 1]);
    expect(frame(c, 400, ['perfect', 2])).toBe('idle');
  });
  it('miss は 350ms', () => {
    const c = mk();
    expect(frame(c, 0, ['miss', 0])).toBe('miss');
    expect(c.tick(349)).toBe('miss');
    expect(c.tick(350)).toBe('idle');
  });
  it('combo は 700ms', () => {
    const c = mk();
    expect(frame(c, 0, ['perfect', 25])).toBe('combo');
    expect(c.tick(699)).toBe('combo');
    expect(c.tick(700)).toBe('idle');
  });
});

describe('優先度の競合（待ち行列なし）', () => {
  it('combo 表示中の perfect/hit では上書きされず、終わっても再生されない', () => {
    const c = mk();
    frame(c, 0, ['perfect', 25]);
    expect(frame(c, 200, ['perfect', 26])).toBe('combo');
    expect(frame(c, 400, ['good', 27])).toBe('combo');
    expect(c.tick(700)).toBe('idle'); // 捨てた反応を後から出さない
    expect(c.tick(701)).toBe('idle');
  });
  it('combo 表示中の miss も優先度で捨てられる（高優先を壊さない）', () => {
    const c = mk();
    frame(c, 0, ['perfect', 50]);
    expect(frame(c, 100, ['miss', 0])).toBe('combo');
    expect(c.tick(700)).toBe('idle');
  });
  it('perfect 表示中に combo が来たら combo に置き換わる', () => {
    const c = mk();
    frame(c, 0, ['perfect', 24]);
    expect(frame(c, 100, ['perfect', 25])).toBe('combo');
  });
  it('hit/perfect 表示中の miss は miss に置き換わる', () => {
    const c = mk();
    frame(c, 0, ['perfect', 3]);
    expect(frame(c, 100, ['miss', 0])).toBe('miss');
  });
});

describe('同一フレームの集約', () => {
  it('同時押しで miss と perfect が同じフレーム → miss（隠さない）', () => {
    const c = mk();
    expect(frame(c, 0, ['perfect', 5], ['miss', 0])).toBe('miss');
  });
  it('節目のコンボと miss が同じフレーム → combo を出さず miss', () => {
    const c = mk();
    expect(frame(c, 0, ['perfect', 25], ['miss', 0])).toBe('miss');
  });
  it('節目のコンボと perfect が同じフレーム → combo', () => {
    const c = mk();
    expect(frame(c, 0, ['perfect', 25], ['great', 26])).toBe('combo');
  });
  it('perfect と great が同じフレーム → perfect', () => {
    const c = mk();
    expect(frame(c, 0, ['great', 1], ['perfect', 2])).toBe('perfect');
  });
  it('判定が無いフレームでは何も変わらない', () => {
    const c = mk();
    expect(c.tick(0)).toBe('idle');
    expect(c.tick(16)).toBe('idle');
  });
});

describe('連続ミスで点滅しない', () => {
  it('連続MISSは1発目だけ表示。表示が終わったあとの追いMISSでは出し直さない', () => {
    const c = mk();
    expect(frame(c, 0, ['miss', 0])).toBe('miss');
    expect(c.tick(350)).toBe('idle');
    expect(frame(c, 500, ['miss', 0])).toBe('idle');
    expect(frame(c, 900, ['miss', 0])).toBe('idle');
  });
  it('表示中の追いMISSは表示を延長するだけ（途中で idle に戻らない）', () => {
    const c = mk();
    frame(c, 0, ['miss', 0]);
    expect(frame(c, 300, ['miss', 0])).toBe('miss');
    expect(c.tick(600)).toBe('miss');
    expect(c.tick(650)).toBe('idle');
  });
  it('成功を挟んだ次のMISSは新しい連続として表示', () => {
    const c = mk();
    frame(c, 0, ['miss', 0]);
    frame(c, 1000, ['good', 1]);
    expect(frame(c, 2000, ['miss', 0])).toBe('miss');
  });
});

describe('cheer（ミスから復帰）', () => {
  function missRun(c: ReactionController, t0: number, n: number) {
    for (let i = 0; i < n; i++) frame(c, t0 + i * 400, ['miss', 0]);
  }
  it('連続MISS後に5回成功したときだけ 600ms', () => {
    const c = mk();
    missRun(c, 0, 3);
    for (let i = 1; i <= 4; i++) expect(frame(c, 2000 + i * 800, ['good', i])).not.toBe('cheer');
    expect(frame(c, 2000 + 5 * 800, ['good', 5])).toBe('cheer');
    expect(c.tick(2000 + 5 * 800 + 599)).toBe('cheer');
    expect(c.tick(2000 + 5 * 800 + 600)).toBe('idle');
  });
  it('MISS が1回だけなら励まさない（連続MISSのみ）', () => {
    const c = mk();
    frame(c, 0, ['miss', 0]);
    let seen = false;
    for (let i = 1; i <= 8; i++) if (frame(c, 1000 + i * 800, ['good', i]) === 'cheer') seen = true;
    expect(seen).toBe(false);
  });
  it('10秒未満の再発火はしない／10秒以上空けば出る', () => {
    const c = mk();
    missRun(c, 0, 2);
    for (let i = 1; i <= 5; i++) frame(c, 1000 + i * 800, ['good', i]); // cheer @5000
    missRun(c, 6000, 2);
    let early = false;
    for (let i = 1; i <= 5; i++) if (frame(c, 7000 + i * 800, ['good', i]) === 'cheer') early = true; // 〜11000: 6秒後
    expect(early).toBe(false);
    missRun(c, 20000, 2);
    let late = false;
    for (let i = 1; i <= 5; i++) if (frame(c, 21000 + i * 800, ['good', i]) === 'cheer') late = true;
    expect(late).toBe(true);
  });
  it('復帰途中でまたMISSすると数え直し', () => {
    const c = mk();
    missRun(c, 0, 2);
    for (let i = 1; i <= 3; i++) frame(c, 1000 + i * 800, ['good', i]);
    frame(c, 4000, ['miss', 0]);
    let cheered = false;
    for (let i = 1; i <= 4; i++) if (frame(c, 5000 + i * 800, ['good', i]) === 'cheer') cheered = true;
    expect(cheered).toBe(false);
  });
});

describe('一時停止・中断（タイマー残留なし）', () => {
  it('clearDisplay で表示中の反応と未処理の判定を破棄し、復帰後に古い反応が出ない', () => {
    const c = mk();
    frame(c, 0, ['perfect', 25]); // combo 表示中
    c.judge('miss', 0); // 未処理
    c.clearDisplay();
    expect(c.tick(10)).toBe('idle');
    expect(c.tick(5000)).toBe('idle');
  });
  it('ready は基底状態：カウントダウン中は ready、開始後は idle', () => {
    const c = mk();
    c.setBase('ready');
    expect(c.tick(0)).toBe('ready');
    expect(c.tick(3000)).toBe('ready');
    c.setBase('idle');
    expect(c.tick(3001)).toBe('idle');
  });
  it('reset で連続MISSの記録も消える', () => {
    const c = mk();
    frame(c, 0, ['miss', 0]);
    frame(c, 400, ['miss', 0]);
    c.reset();
    let cheered = false;
    for (let i = 1; i <= 6; i++) if (frame(c, 1000 + i * 800, ['good', i]) === 'cheer') cheered = true;
    expect(cheered).toBe(false);
  });
});
