import { REACTION } from '../config';
import type { CharacterState, Grade } from '../types';

/**
 * キャラのリアクション制御（README_CLAUDE.md）。
 *
 * - 優先順位：best/clear > ready > select > miss > combo > cheer > perfect > hit > idle
 * - 待ち行列は持たない。優先度の低い反応は、高い反応の表示中に来たら捨てる（あとで再生しない）。
 * - タイマーを使わず「現在時刻との比較」だけで状態を決めるので、遅れて古い画像へ戻る事故が起きない。
 * - 同一フレームの判定は1回の flush でまとめる。MISSが含まれるフレームは必ずMISS扱い（成功・コンボ演出は出さない）。
 */
export const PRIORITY: Record<CharacterState, number> = {
  best: 100,
  clear: 100,
  ready: 90,
  select: 80,
  miss: 70,
  combo: 60,
  cheer: 50,
  perfect: 40,
  hit: 30,
  idle: 0,
};

/** コンボ節目か（25, 50, 100, 150, 200 …） */
export function isComboMilestone(combo: number): boolean {
  const m = REACTION.comboMilestones;
  if (combo <= 0) return false;
  if ((m.first as readonly number[]).includes(combo)) return true;
  return combo >= m.everyFrom && (combo - m.everyFrom) % m.every === 0;
}

/** 結果画面のポーズ：初回記録・オートプレイ・同点以下は clear、以前の記録を更新したときだけ best */
export function resultState(o: { autoplay: boolean; hadPreviousBest: boolean; improved: boolean }): CharacterState {
  if (o.autoplay) return 'clear';
  return o.hadPreviousBest && o.improved ? 'best' : 'clear';
}

type Base = 'idle' | 'ready';

interface Active {
  state: CharacterState;
  until: number;
}

interface Batch {
  misses: number;
  successes: number;
  perfects: number;
  milestone: boolean;
}

const emptyBatch = (): Batch => ({ misses: 0, successes: 0, perfects: 0, milestone: false });

export class ReactionController {
  private base: Base = 'idle';
  private cur: Active | null = null;
  private lastFire: Partial<Record<CharacterState, number>> = {};
  private batch: Batch = emptyBatch();
  /** いまの連続MISS数（成功を挟むとリセット） */
  private missStreak = 0;
  /** 直近のMISSからの成功数 */
  private recover = 0;
  private cheerArmed = false;
  private lastCheer = -Infinity;

  setBase(base: Base): void {
    this.base = base;
  }

  /** 判定を1件受け取る（描画フレームごとの tick でまとめて処理される） */
  judge(grade: Grade, comboAfter: number): void {
    const b = this.batch;
    if (grade === 'miss') {
      b.misses++;
      return;
    }
    b.successes++;
    if (grade === 'perfect') b.perfects++;
    if (isComboMilestone(comboAfter)) b.milestone = true;
  }

  /** 毎フレーム呼ぶ。いま表示すべき状態を返す。 */
  tick(now: number): CharacterState {
    this.flush(now);
    if (this.cur && now < this.cur.until) return this.cur.state;
    this.cur = null;
    return this.base;
  }

  /** 一時停止・中断・画面遷移で呼ぶ：表示中の反応と未処理の判定を破棄（連続MISSの記録は残す） */
  clearDisplay(): void {
    this.cur = null;
    this.batch = emptyBatch();
    this.lastFire = {};
  }

  /** 完全リセット */
  reset(): void {
    this.clearDisplay();
    this.base = 'idle';
    this.missStreak = 0;
    this.recover = 0;
    this.cheerArmed = false;
    this.lastCheer = -Infinity;
  }

  /** 直接要求（テスト・開発プレビュー用）。待ち行列なし：優先度で負けたら捨てる。 */
  request(state: CharacterState, now: number, ms: number, minGapMs = 0): boolean {
    const active = this.cur && now < this.cur.until ? this.cur : null;
    if (active && PRIORITY[active.state] >= PRIORITY[state]) return false;
    const last = this.lastFire[state];
    if (last !== undefined && now - last < minGapMs) return false;
    this.cur = { state, until: now + ms };
    this.lastFire[state] = now;
    return true;
  }

  private flush(now: number): void {
    const b = this.batch;
    if (b.misses === 0 && b.successes === 0) return;
    this.batch = emptyBatch();

    if (b.misses > 0) {
      // MISSを含むフレーム：必ずMISS扱い。成功やコンボ演出で隠さない。
      const newStreak = this.recover > 0 || this.missStreak === 0;
      if (newStreak) {
        this.missStreak = 0;
        this.cheerArmed = false;
      }
      this.missStreak += b.misses;
      this.recover = 0;
      if (this.missStreak >= REACTION.cheer.minMissStreak) this.cheerArmed = true;

      const active = this.cur && now < this.cur.until ? this.cur : null;
      if (active && active.state === 'miss') {
        // 表示中のMISSは延長するだけ（点滅させない）
        active.until = Math.max(active.until, now + REACTION.miss.ms);
      } else if (newStreak) {
        // 連続MISSの1発目だけ表示。表示が終わったあとの追いMISSでは出し直さない
        this.request('miss', now, REACTION.miss.ms);
      }
      return;
    }

    // 成功のみのフレーム
    this.recover += b.successes;
    const wantsCheer =
      this.cheerArmed && this.recover >= REACTION.cheer.afterSuccesses && now - this.lastCheer >= REACTION.cheer.cooldownMs;

    // 1フレームで出すのは最も優先度が高い1つだけ。ゲート（最短間隔）で止まっても格下げして出さない。
    if (b.milestone) {
      this.request('combo', now, REACTION.combo.ms);
      // 節目と同時なら節目を優先。励ましは捨てる（あとから遅れて出さない）。クールダウンは消費しない
      if (wantsCheer) this.cheerArmed = false;
      return;
    }
    if (wantsCheer) {
      if (this.request('cheer', now, REACTION.cheer.ms)) this.consumeCheer(now);
      return;
    }
    if (b.perfects > 0) this.request('perfect', now, REACTION.perfect.ms, REACTION.perfect.minGapMs);
    else this.request('hit', now, REACTION.hit.ms, REACTION.hit.minGapMs);
  }

  private consumeCheer(now: number): void {
    this.lastCheer = now;
    this.cheerArmed = false;
  }
}
