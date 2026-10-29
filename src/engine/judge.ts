import { JUDGE, MAX_SCORE, WEIGHTS } from '../config';
import type { Grade, TimedNote } from '../types';

export interface JudgeConfig {
  perfectMs: number;
  greatMs: number;
  goodMs: number;
  missEarlyMs: number;
  holdReleaseGraceMs: number;
}

export interface JudgeEvent {
  noteId: number;
  lane: number;
  part: 'head' | 'tail';
  grade: Grade;
  /** 入力 − ノーツ時刻（ms）。負=早い。自動MISS・終端は undefined */
  deltaMs?: number;
  /** この判定の直後のコンボ数 */
  combo: number;
}

interface NoteState {
  note: TimedNote;
  head?: Grade;
  tail?: Grade;
  /** 長押し中の入力キー */
  holder: string | null;
}

export interface JudgeStats {
  perfect: number;
  great: number;
  good: number;
  miss: number;
  fast: number;
  slow: number;
  combo: number;
  maxCombo: number;
  judgedUnits: number;
  totalUnits: number;
  weightSum: number;
}

export function gradeFor(absDelta: number, cfg: JudgeConfig): Grade | null {
  if (absDelta <= cfg.perfectMs) return 'perfect';
  if (absDelta <= cfg.greatMs) return 'great';
  if (absDelta <= cfg.goodMs) return 'good';
  return null;
}

/**
 * 判定・採点。時刻はすべて「譜面時刻(ms)」で受け取る（音声クロック由来、補正適用済み）。
 * 判定単位：タップ=1、長押し=開始+終端の2。満点は総判定単位で100万点に正規化。
 * 空打ちは何も起きない（加点も減点もしない）。1回の押下は最大1ノーツしか判定しない。
 */
export class Judge {
  readonly states: NoteState[];
  private byLane: NoteState[][] = [[], [], [], []];
  /** 各レーンで次に見るべきインデックス（判定済みの先頭を飛ばすため） */
  private cursor = [0, 0, 0, 0];
  readonly stats: JudgeStats;
  private cfg: JudgeConfig;

  constructor(notes: TimedNote[], cfg: JudgeConfig = JUDGE) {
    this.cfg = cfg;
    this.states = notes.map((note) => ({ note, holder: null }));
    for (const s of this.states) this.byLane[s.note.lane].push(s);
    const totalUnits = notes.reduce((a, n) => a + (n.end !== undefined ? 2 : 1), 0);
    this.stats = { perfect: 0, great: 0, good: 0, miss: 0, fast: 0, slow: 0, combo: 0, maxCombo: 0, judgedUnits: 0, totalUnits, weightSum: 0 };
  }

  private record(s: NoteState, part: 'head' | 'tail', grade: Grade, deltaMs?: number): JudgeEvent {
    if (part === 'head') s.head = grade;
    else s.tail = grade;
    const st = this.stats;
    st[grade]++;
    st.judgedUnits++;
    st.weightSum += WEIGHTS[grade];
    if (grade === 'miss') st.combo = 0;
    else {
      st.combo++;
      if (st.combo > st.maxCombo) st.maxCombo = st.combo;
    }
    if (deltaMs !== undefined && grade !== 'perfect' && grade !== 'miss') {
      if (deltaMs < 0) st.fast++;
      else st.slow++;
    }
    return { noteId: s.note.id, lane: s.note.lane, part, grade, deltaMs, combo: st.combo };
  }

  /** 押下。lane のノーツを最大1つ判定する。 */
  press(lane: number, timeMs: number, inputKey: string): JudgeEvent[] {
    const list = this.byLane[lane];
    if (!list) return [];
    let i = this.cursor[lane];
    while (i < list.length && list[i].head !== undefined) i++;
    this.cursor[lane] = i;
    // 先頭の未判定ノーツのみ対象（後ろのノーツを先取りしない）
    const s = list[i];
    if (!s) return [];
    const delta = timeMs - s.note.t;
    if (delta < -this.cfg.missEarlyMs) return []; // 早すぎ → 空打ち
    if (delta > this.cfg.goodMs) return []; // update() で自動MISSになる範囲
    const grade = gradeFor(Math.abs(delta), this.cfg);
    const events: JudgeEvent[] = [];
    if (grade === null) {
      // GOOD幅より早いが missEarly 以内 → そのノーツはMISS
      events.push(this.record(s, 'head', 'miss', delta));
      if (s.note.end !== undefined) events.push(this.record(s, 'tail', 'miss'));
      return events;
    }
    events.push(this.record(s, 'head', grade, delta));
    if (s.note.end !== undefined) s.holder = inputKey;
    return events;
  }

  /** 離した。inputKey が保持している長押しの終端を判定。 */
  release(inputKey: string, timeMs: number): JudgeEvent[] {
    const events: JudgeEvent[] = [];
    for (const s of this.activeHolds()) {
      if (s.holder !== inputKey) continue;
      s.holder = null;
      const end = s.note.end!;
      events.push(this.record(s, 'tail', timeMs >= end - this.cfg.holdReleaseGraceMs ? 'perfect' : 'miss'));
    }
    return events;
  }

  /** 全入力を解放（一時停止・中断時）。押しっぱなしの長押しは離した扱い。 */
  releaseAll(timeMs: number): JudgeEvent[] {
    const keys = new Set(this.activeHolds().map((s) => s.holder!));
    return [...keys].flatMap((k) => this.release(k, timeMs));
  }

  private activeHoldsCache: NoteState[] = [];
  activeHolds(): NoteState[] {
    this.activeHoldsCache.length = 0;
    for (const s of this.states) if (s.holder !== null) this.activeHoldsCache.push(s);
    return this.activeHoldsCache;
  }

  /** 時間経過による判定：取り逃しの自動MISSと、終端まで維持した長押しの成功。 */
  update(timeMs: number): JudgeEvent[] {
    const events: JudgeEvent[] = [];
    for (let lane = 0; lane < 4; lane++) {
      const list = this.byLane[lane];
      for (let i = this.cursor[lane]; i < list.length; i++) {
        const s = list[i];
        if (s.note.t - this.cfg.goodMs > timeMs) break;
        if (s.head === undefined && timeMs - s.note.t > this.cfg.goodMs) {
          events.push(this.record(s, 'head', 'miss'));
          if (s.note.end !== undefined) events.push(this.record(s, 'tail', 'miss'));
        }
      }
    }
    for (const s of this.activeHolds()) {
      if (timeMs >= s.note.end!) {
        s.holder = null;
        events.push(this.record(s, 'tail', 'perfect'));
      }
    }
    return events;
  }

  get complete(): boolean {
    return this.stats.judgedUnits >= this.stats.totalUnits;
  }

  /** 現在の得点（判定済み分の累計。全PERFECTで100万点ちょうど） */
  get score(): number {
    const { weightSum, totalUnits } = this.stats;
    if (totalUnits === 0) return 0;
    if (weightSum >= totalUnits) return MAX_SCORE;
    return Math.floor((MAX_SCORE * weightSum) / totalUnits + 1e-9);
  }

  isHeld(noteId: number): boolean {
    return this.states[noteId]?.holder !== null;
  }
}
