/**
 * 画像ごとの足元微調整（素材キャンバスのピクセル単位。正は下・負は上）。
 * 素材パックの renderOffsetYSourcePx（足元の揺れを抑える値）を、描画時に「表示高さ/キャンバス高さ」倍して Y に足す。
 * 原画PNGは加工しない。登録のない画像は 0。
 */
const offsets = new WeakMap<object, number>();

export function setSpriteOffsetPx(img: object, px: number) {
  offsets.set(img, px);
}

/** 表示後の高さ dh に対する Y 補正（画面ピクセル）。naturalHeight が分かる画像にだけ効く */
export function spriteOffsetY(img: { naturalHeight: number }, dh: number): number {
  const px = offsets.get(img) ?? 0;
  return img.naturalHeight > 0 ? (px * dh) / img.naturalHeight : 0;
}
