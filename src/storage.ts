import { DEFAULT_SELECTION, DEFAULT_SETTINGS, type Settings } from './config';
import type { Difficulty } from './types';

// 端末内保存。プライベートブラウズ等で使えなくてもゲームは動く（失敗は握りつぶす）
const P = 'bos:v1:';

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(P + key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(P + key, JSON.stringify(v));
  } catch {
    /* 保存できない環境 */
  }
}

export function loadSettings(): Settings {
  const s = read<Partial<Settings>>('settings') ?? {};
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(out) as (keyof Settings)[]) {
    if (typeof s[k] === typeof out[k]) (out as Record<string, unknown>)[k] = s[k];
  }
  out.noteSpeed = clamp(out.noteSpeed, 1, 10);
  out.offsetMs = clamp(Math.round(out.offsetMs), -300, 300);
  out.musicVolume = clamp(out.musicVolume, 0, 1);
  out.hitVolume = clamp(out.hitVolume, 0, 1);
  return out;
}
export const saveSettings = (s: Settings) => write('settings', s);

export interface Selection {
  songId: string;
  characterId: string;
  difficulty: Difficulty;
}
export function loadSelection(): Selection {
  const s = read<Partial<Selection>>('selection') ?? {};
  return { ...DEFAULT_SELECTION, ...s };
}
export const saveSelection = (s: Selection) => write('selection', s);

export interface BestRecord {
  score: number;
  maxCombo: number;
  at: string;
}
/** 自己ベストは 曲ID × 難易度 × 譜面版 ごと。キャラでは分けない */
export const bestKey = (songId: string, diff: Difficulty, chartVersion: string) => `best:${songId}:${diff}:${chartVersion}`;
export const loadBest = (k: string) => read<BestRecord>(k);
export const saveBest = (k: string, r: BestRecord) => write(k, r);

export const tutorialSeen = () => read<boolean>('tutorialSeen') === true;
export const markTutorialSeen = () => write('tutorialSeen', true);

/** 開発用メニュー：?dev=1 か、ロゴ5連打で端末内に保存したフラグ */
export function isDevMode(): boolean {
  try {
    if (new URLSearchParams(location.search).has('dev')) return true;
  } catch {
    /* ignore */
  }
  return read<boolean>('dev') === true;
}
export const setDevMode = (on: boolean) => write('dev', on);

function clamp(v: number, lo: number, hi: number) {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

/** 表示用：譜面版を問わず、その曲×難易度の自己ベストのうち最高点（無ければ null） */
export function loadBestAny(songId: string, diff: Difficulty): BestRecord | null {
  let best: BestRecord | null = null;
  try {
    const prefix = `${P}best:${songId}:${diff}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const r = read<BestRecord>(k.slice(P.length));
      if (r && typeof r.score === 'number' && (!best || r.score > best.score)) best = r;
    }
  } catch {
    /* 保存を読めない環境 */
  }
  return best;
}

/** キャラごとの応援プレイ回数（最後まで遊んだ回数。オートプレイ・中断は数えない） */
export function loadPlays(characterId: string): number {
  const n = read<number>(`plays:${characterId}`);
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
export function addPlay(characterId: string): number {
  const n = loadPlays(characterId) + 1;
  write(`plays:${characterId}`, n);
  return n;
}

export type Rank = 'S' | 'A' | 'B' | 'C';
/** ランク（仮置きのしきい値：95万/85万/70万） */
export const rankOf = (score: number): Rank => (score >= 950000 ? 'S' : score >= 850000 ? 'A' : score >= 700000 ? 'B' : 'C');
