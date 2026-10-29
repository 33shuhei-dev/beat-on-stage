import { DEFAULT_SPRITE_ANCHOR } from '../config';
import { loadImage } from '../data';
import { CHARACTER_STATES, type CharacterData, type CharacterState } from '../types';

/**
 * 1キャラ分のリアクション画像。全状態をプレイ前に読み込み、
 * 読めなかった状態は idle、idle も読めなければ null（描画側の代替表示へ）。
 */
export interface SpriteSet {
  characterId: string;
  anchorX: number;
  anchorY: number;
  /** 状態ごとの読み込み結果（開発プレビュー用） */
  status: Record<CharacterState, { ok: boolean; width: number; height: number; path: string | null }>;
  get(state: CharacterState): HTMLImageElement | null;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

const cache = new Map<string, Promise<SpriteSet>>();

export function loadSprites(c: CharacterData, timeoutMs = 8000): Promise<SpriteSet> {
  const key = `${c.id}:${c.assetVersion}`;
  let p = cache.get(key);
  if (!p) {
    p = build(c, timeoutMs);
    cache.set(key, p);
  }
  return p;
}

async function build(c: CharacterData, timeoutMs: number): Promise<SpriteSet> {
  const r = c.reactions;
  const paths: Partial<Record<CharacterState, string | null>> = {};
  for (const s of CHARACTER_STATES) paths[s] = r?.states[s] ?? (s === 'idle' ? c.images.idle ?? null : null);
  const imgs = await Promise.all(CHARACTER_STATES.map((s) => withTimeout(loadImage(paths[s] ?? null), timeoutMs, null)));
  const map = new Map<CharacterState, HTMLImageElement | null>();
  const status = {} as SpriteSet['status'];
  CHARACTER_STATES.forEach((s, i) => {
    const img = imgs[i];
    map.set(s, img);
    status[s] = { ok: !!img, width: img?.naturalWidth ?? 0, height: img?.naturalHeight ?? 0, path: paths[s] ?? null };
  });
  const ax = r?.anchor?.[0] ?? DEFAULT_SPRITE_ANCHOR.x;
  const ay = r?.anchor?.[1] ?? (r ? DEFAULT_SPRITE_ANCHOR.y : 1);
  return {
    characterId: c.id,
    anchorX: ax,
    anchorY: ay,
    status,
    get: (state) => map.get(state) ?? map.get('idle') ?? null,
  };
}

/** 画像要素用の候補パス：そのポーズ → idle（反応セット）→ 確定済みの元画像。重複は除く */
export function poseSources(c: CharacterData, state: CharacterState): string[] {
  const list = [c.reactions?.states[state], c.reactions?.states.idle, c.images.idle].filter((x): x is string => !!x);
  return [...new Set(list)];
}
