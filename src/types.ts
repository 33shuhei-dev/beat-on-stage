export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD' };

export interface SongData {
  id: string;
  title: string;
  durationSeconds: number;
  fadeOut: { startSeconds: number; endSeconds: number };
  audio: string;
  available: boolean;
  bpm: number | null;
  tempoAnalysis: { status: string; listeningVerified: boolean; summary: string; bpmStart: number; bpmEnd: number } | null;
  firstBeatSeconds: number | null;
  chorusStartSeconds: number | null;
  beatMap: number[] | null;
  charts: Record<Difficulty, string | null>;
}

export type CharacterState = 'idle' | 'hit' | 'combo' | 'miss' | 'cheer' | 'clear';

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
  images: Record<CharacterState, string | null>;
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
