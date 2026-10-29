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
};
export type Settings = typeof DEFAULT_SETTINGS;

export const KEY_LANES: Record<string, number> = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
export const LANE_KEY_LABELS = ['D', 'F', 'J', 'K'];

/** 第1段階の既定（仕様では EASY が既定だが、第1段階は NORMAL のみのため一時変更） */
export const DEFAULT_SELECTION = { songId: 'vote', characterId: 'char_0001', difficulty: 'normal' as const };

export const COMBO_MILESTONE = 25;
