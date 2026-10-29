// 調整可能な数値はすべてここに集約する。値はいずれも未検証の初期値（実機で要調整）。

export const JUDGE = {
  /** 判定幅（±ms）。ノーツ時刻との差の絶対値で判定 */
  perfectMs: 45,
  greatMs: 90,
  goodMs: 135,
  /** GOOD幅の外側でも、この早さ以内の押下はそのノーツのMISSとして扱う（空打ち扱いにしない範囲） */
  missEarlyMs: 180,
  /** 長押し終端：終端時刻のこのms前以降に離したら終端成功とみなす（終端で離す正確さは求めない） */
  holdReleaseGraceMs: 80,
} as const;

/** 配点重み（PERFECT / GREAT / GOOD / MISS）。満点は100万点に正規化 */
export const WEIGHTS = { perfect: 1.0, great: 0.7, good: 0.3, miss: 0 } as const;
export const MAX_SCORE = 1_000_000;

export const TIMING = {
  /** 開始時のカウントダウン（秒）。この間にノーツが降りてくる。原曲のイントロは削らない */
  countdownSec: 3,
  /** 一時停止からの再開時、この秒数だけ巻き戻してからカウントダウン */
  resumeRewindSec: 2,
  /** 最後のノーツ後、この秒数か曲の終わりのどちらか遅い方で結果へ */
  endPaddingSec: 1.5,
} as const;

/** ノーツ速度設定(1〜10) → 画面上端から判定線までの所要ms */
export function travelMsForSpeed(speed: number): number {
  const s = Math.min(10, Math.max(1, speed));
  return Math.round(3000 / (1 + 0.3 * s));
}

export const DEFAULT_SETTINGS = {
  noteSpeed: 5,
  /** + にするとノーツと判定が遅くなる（音が遅れて聞こえる環境・遅れ判定が多いとき） */
  offsetMs: 0,
  musicVolume: 0.9,
  hitVolume: 0.5,
  showFastSlow: true,
  reducedEffects: false,
  /** キャラのリアクション（ポーズ切替）。OFFなら常に通常ポーズ */
  characterReactions: true,
};
export type Settings = typeof DEFAULT_SETTINGS;

export const KEY_LANES: Record<string, number> = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
export const LANE_KEY_LABELS = ['D', 'F', 'J', 'K'];

/** 既定の選択（初めての人向けに EASY） */
export const DEFAULT_SELECTION = { songId: 'vote', characterId: 'char_0001', difficulty: 'easy' as const };

/**
 * キャラのリアクション表示（README_CLAUDE.md の初期提案値）。すべて調整可能。
 * minGapMs: 同じ反応を連続で出さない最短間隔（発火時刻どうしの間隔）。
 */
export const REACTION = {
  selectMs: 800,
  hit: { ms: 180, minGapMs: 500 },
  perfect: { ms: 240, minGapMs: 700 },
  combo: { ms: 700 },
  miss: { ms: 350 },
  cheer: {
    ms: 600,
    /** ミス連続がこの回数以上のあと復帰したときだけ励ます */
    minMissStreak: 2,
    /** その後の連続成功数 */
    afterSuccesses: 5,
    /** 再発火までの最短間隔 */
    cooldownMs: 10000,
  },
  /** コンボ節目：25, 50, 100, 150, 200 … */
  comboMilestones: { first: [25, 50], everyFrom: 100, every: 50 },
} as const;

/** 譜面上の反応ポーズ画像の既定アンカー（README: キャンバス中央・足元 y=480/512） */
export const DEFAULT_SPRITE_ANCHOR = { x: 0.5, y: 0.9375 } as const;
/** プレイ中の舞台上キャラの表示サイズ（舞台高さに対する、512pxキャンバス一辺の倍率）。全ポーズ共通で固定 */
export const STAGE_SPRITE_SCALE = 1.08;
