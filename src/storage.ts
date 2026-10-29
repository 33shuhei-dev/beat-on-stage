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
