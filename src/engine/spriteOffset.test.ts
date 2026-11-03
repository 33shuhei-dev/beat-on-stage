import { describe, expect, it } from 'vitest';
import { setSpriteOffsetPx, spriteOffsetY } from './spriteOffset';
import { stageSpriteRect } from './render';

describe('足元微調整（素材ピクセル→画面）', () => {
  it('登録のない画像は 0', () => {
    expect(spriteOffsetY({ naturalHeight: 1254 }, 500)).toBe(0);
  });
  it('正は下・負は上、表示高さ/キャンバス高さ倍される', () => {
    const img = { naturalWidth: 1254, naturalHeight: 1254 };
    setSpriteOffsetPx(img, -6);
    expect(spriteOffsetY(img, 627)).toBeCloseTo(-3, 6);
    setSpriteOffsetPx(img, 2);
    expect(spriteOffsetY(img, 1254)).toBeCloseTo(2, 6);
  });
  it('stageSpriteRect の足元に加算される（他の画像には影響しない）', () => {
    const L = { w: 390, stageH: 250 } as Parameters<typeof stageSpriteRect>[0];
    const a = { naturalWidth: 100, naturalHeight: 100 };
    const b = { naturalWidth: 100, naturalHeight: 100 };
    setSpriteOffsetPx(b, 10);
    const ra = stageSpriteRect(L, a, 0.5, 0.9, 1, 0);
    const rb = stageSpriteRect(L, b, 0.5, 0.9, 1, 0);
    expect(rb.footY - ra.footY).toBeCloseTo((10 * ra.h) / 100, 6);
  });
});
