import type { CharacterData, ChartData, SongData } from './types';

export const asset = (p: string) => import.meta.env.BASE_URL + p.replace(/^\//, '');

async function getJson<T>(p: string): Promise<T> {
  const r = await fetch(asset(p), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const loadSongs = () => getJson<SongData[]>('data/songs.json');
export const loadCharacters = async () => (await getJson<CharacterData[]>('data/characters.json')).filter((c) => c.enabledInPrototype);
export const loadChart = (path: string) => getJson<ChartData>(path);

export async function loadAudioData(path: string): Promise<ArrayBuffer> {
  const r = await fetch(asset(path));
  if (!r.ok) throw new Error(`音源の読み込みに失敗しました（HTTP ${r.status}）`);
  return await r.arrayBuffer();
}

const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
/** 画像読込。失敗しても null を返すだけで、ゲームは止めない */
export function loadImage(path: string | null): Promise<HTMLImageElement | null> {
  if (!path) return Promise.resolve(null);
  let p = imgCache.get(path);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = asset(path);
    });
    imgCache.set(path, p);
  }
  return p;
}
