export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD' };

export interface SongData {
  id: string;
  title: string;
  durationSeconds: number;
  fadeOut: { startSeconds: number; endSeconds: number };
  audio: string;
  /** ジャケット画像（正方形・採用済み素材をそのまま使用） */
  jacket?: string | null;
  available: boolean;
  bpm: number | null;
  tempoAnalysis: { status: string; listeningVerified: boolean; summary: string; bpmStart: number; bpmEnd: number } | null;
  firstBeatSeconds: number | null;
  chorusStartSeconds: number | null;
  beatMap: number[] | null;
  charts: Record<Difficulty, string | null>;
}

export type CharacterState = 'idle' | 'select' | 'ready' | 'hit' | 'perfect' | 'combo' | 'miss' | 'cheer' | 'clear' | 'best';
export const CHARACTER_STATES: CharacterState[] = ['idle', 'select', 'ready', 'hit', 'perfect', 'combo', 'miss', 'cheer', 'clear', 'best'];

/** リアクション素材セット（全ポーズ同一キャンバス・同一アンカー） */
export interface ReactionSet {
  version: string;
  canvas: { width: number; height: number };
  /** 足元基準点。[x, y] はキャンバスに対する比率 */
  anchor: [number, number];
  base: CharacterState;
  fallback: CharacterState;
  states: Partial<Record<CharacterState, string>>;
}

export interface CharacterData {
  id: string;
  name: string;
  participationType: string;
  affiliation: string | null;
  bio: string | null;
  xUrl: string | null;
  enabledInPrototype: boolean;
  publicReleaseApproved: boolean;
  assetVersion: string;
  /** 選択カード用などの確定画像（元画像のまま保持） */
  images: Partial<Record<CharacterState, string | null>>;
  reactions?: ReactionSet | null;
  fallbackState: CharacterState;
  display?: { scale?: number; offsetY?: number };
}

export interface ChartSourceNote {
  bar: number;
  slot: number;
  lane: number;
  endBar?: number;
  endSlot?: number;
}

export interface ChartData {
  songId: string;
  difficulty: Difficulty;
  chartVersion: string;
  status: string;
  statusNote: string;
  grid: number;
  offsetMs: number;
  notes: ChartSourceNote[];
}

/** 実行時のノーツ（時刻はms・曲頭基準） */
export interface TimedNote {
  id: number;
  lane: number;
  t: number;
  /** 長押しの終端ms。タップは undefined */
  end?: number;
}

export type Grade = 'perfect' | 'great' | 'good' | 'miss';
