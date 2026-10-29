import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../config';
import { computeLayout, drawFrame, stageSpriteRect, type RenderState } from '../engine/render';
import { loadSprites, type SpriteSet } from '../engine/sprites';
import { CHARACTER_STATES, type CharacterData, type CharacterState } from '../types';

/**
 * 開発専用：10状態のポーズを強制表示して確認する。
 * 実際のプレイ画面と同じ描画関数を使うので、舞台上の大きさ・足元位置・ノーツ領域との重なりがそのまま見える。
 */
export function ReactionLab({ character, settings }: { character: CharacterData; settings: Settings }) {
  const [sprites, setSprites] = useState<SpriteSet | null>(null);
  const [state, setState] = useState<CharacterState>('idle');
  const [auto, setAuto] = useState(false);
  const [guide, setGuide] = useState(true);
  const [onion, setOnion] = useState(false);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    void loadSprites(character).then((s) => alive && setSprites(s));
    return () => {
      alive = false;
    };
  }, [character]);

  // 自動で順に切り替え（位置のブレを目で確認）。アンマウント・停止で必ずタイマー解除
  useEffect(() => {
    if (!auto) return;
    let i = CHARACTER_STATES.indexOf(state);
    const t = setInterval(() => {
      i = (i + 1) % CHARACTER_STATES.length;
      setState(CHARACTER_STATES[i]);
    }, 700);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !sprites) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.getBoundingClientRect().width) || 360;
    const h = 380;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    const L = computeLayout(w, h, dpr);
    const rs: RenderState = {
      songMs: 0,
      travelMs: 1200,
      notes: [],
      headDone: () => false,
      tailDone: () => false,
      held: () => false,
      doubles: new Set(),
      barLines: [],
      pressed: [false, false, false, false],
      fx: [],
      combo: 0,
      comboBumpAt: -1e9,
      hitGlowAt: -1e9,
      missAt: -1e9,
      chorus: false,
      reduced: true,
      showFastSlow: false,
      now: 0,
      character: sprites.get(state),
      anchorX: sprites.anchorX,
      anchorY: sprites.anchorY,
      characterName: character.name,
      charScale: character.display?.scale ?? 1,
      charOffsetY: character.display?.offsetY ?? 0,
      showKeys: false,
    };
    drawFrame(g, L, rs);
    g.save();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (onion) {
      g.globalAlpha = 0.22;
      for (const st of CHARACTER_STATES) {
        const img = sprites.get(st);
        if (!img) continue;
        const r = stageSpriteRect(L, img, sprites.anchorX, sprites.anchorY, rs.charScale, rs.charOffsetY);
        g.drawImage(img, r.x, r.y, r.w, r.h);
      }
      g.globalAlpha = 1;
    }
    if (guide) {
      const img = sprites.get(state);
      if (img) {
        const r = stageSpriteRect(L, img, sprites.anchorX, sprites.anchorY, rs.charScale, rs.charOffsetY);
        g.strokeStyle = 'rgba(120,255,200,0.9)';
        g.lineWidth = 1;
        g.setLineDash([4, 3]);
        g.beginPath();
        g.moveTo(0, r.footY);
        g.lineTo(w, r.footY); // 足元基準線
        g.moveTo(r.cx, 0);
        g.lineTo(r.cx, L.stageH); // 中心線
        g.stroke();
        g.strokeStyle = 'rgba(255,200,80,0.7)';
        g.strokeRect(r.x, r.y, r.w, r.h); // 画像キャンバス枠
      }
    }
    g.restore();
  }, [sprites, state, guide, onion, character, settings.reducedEffects]);

  const st = sprites?.status;
  const okCount = st ? CHARACTER_STATES.filter((s) => st[s].ok).length : 0;
  return (
    <div className="lab" data-testid="reaction-lab">
      <div className="lab-head">
        <b>リアクション確認（開発用）</b>
        <span data-testid="lab-count">{sprites ? `${okCount}/${CHARACTER_STATES.length} 読込OK` : '読込中…'}</span>
      </div>
      <canvas ref={ref} className="lab-canvas" aria-label="リアクションのプレビュー" />
      <div className="lab-grid" role="group" aria-label="状態を強制表示">
        {CHARACTER_STATES.map((s) => (
          <button key={s} className={`btn mini ${state === s ? 'primary' : ''}`} data-state={s} onClick={() => { setAuto(false); setState(s); }}>
            {s}
            {st && <small className={st[s].ok ? 'ok' : 'ng'}>{st[s].ok ? `${st[s].width}×${st[s].height}` : '失敗'}</small>}
          </button>
        ))}
      </div>
      <div className="lab-opts">
        <label><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> 自動で順に切替</label>
        <label><input type="checkbox" checked={guide} onChange={(e) => setGuide(e.target.checked)} /> 基準線</label>
        <label><input type="checkbox" checked={onion} onChange={(e) => setOnion(e.target.checked)} /> 全ポーズ重ね</label>
      </div>
    </div>
  );
}
