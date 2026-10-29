import { LANE_KEY_LABELS, STAGE_SPRITE_SCALE } from '../config';
import type { Grade, TimedNote } from '../types';

export interface Layout {
  w: number;
  h: number;
  dpr: number;
  laneX: number; // レーン群の左端
  laneW: number; // 1レーン幅
  stageH: number; // 上部ステージ（キャラ）領域の高さ
  laneTop: number; // ノーツ出現位置
  judgeY: number; // 判定線
}

export function computeLayout(w: number, h: number, dpr: number): Layout {
  const totalW = Math.min(w, 520);
  const laneW = totalW / 4;
  const laneX = (w - totalW) / 2;
  const stageH = Math.round(Math.min(h * 0.3, w * 0.8, 300));
  const judgeY = Math.round(h - Math.max(96, h * 0.15));
  return { w, h, dpr, laneX, laneW, stageH, laneTop: stageH * 0.97, judgeY };
}

export interface FxItem {
  kind: 'burst' | 'text';
  lane: number;
  grade: Grade;
  at: number; // performance.now()
  delta?: number;
}

export interface RenderState {
  songMs: number; // 譜面時刻（補正適用済み）
  travelMs: number;
  notes: TimedNote[];
  headDone: (id: number) => boolean;
  tailDone: (id: number) => boolean;
  held: (id: number) => boolean;
  doubles: Set<number>; // 同時押しの相方がいるノーツID
  barLines: number[];
  pressed: boolean[];
  fx: FxItem[];
  combo: number;
  comboBumpAt: number;
  hitGlowAt: number;
  missAt: number;
  chorus: boolean;
  reduced: boolean;
  showFastSlow: boolean;
  now: number;
  /** いま表示するポーズ画像（全ポーズ同一キャンバス・同一アンカー）。null なら代替シルエット */
  character: HTMLImageElement | null;
  /** 足元基準点（画像に対する比率）。反応画像は x=0.5, y=0.9375 */
  anchorX: number;
  anchorY: number;
  characterName: string;
  charScale: number;
  charOffsetY: number;
  showKeys: boolean;
}

const LANE_COLORS = ['#ff6fd8', '#b58cff', '#b58cff', '#ff6fd8'];
const GRADE_LABEL: Record<Grade, string> = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
const GRADE_COLOR: Record<Grade, string> = { perfect: '#fff27a', great: '#7fe8ff', good: '#9dffb0', miss: '#9a8aa8' };

export function drawFrame(g: CanvasRenderingContext2D, L: Layout, s: RenderState): void {
  const { w, h } = L;
  g.save();
  g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  drawStage(g, L, s);
  drawCharacter(g, L, s);
  drawLanes(g, L, s);
  drawNotes(g, L, s);
  drawFx(g, L, s);
  g.restore();
  void w;
  void h;
}

function drawStage(g: CanvasRenderingContext2D, L: Layout, s: RenderState) {
  const { w, h, stageH } = L;
  const bg = g.createLinearGradient(0, 0, 0, h);
  if (s.chorus) {
    bg.addColorStop(0, '#2a0838');
    bg.addColorStop(0.35, '#1a0630');
    bg.addColorStop(1, '#07030d');
  } else {
    bg.addColorStop(0, '#16062a');
    bg.addColorStop(0.35, '#0f0420');
    bg.addColorStop(1, '#05020a');
  }
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  // スポットライト（ゆっくり揺れる。演出軽減時は固定）
  const t = s.reduced ? 0 : s.now / 1000;
  const beams = s.chorus ? 5 : 3;
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < beams; i++) {
    const baseX = ((i + 0.5) / beams) * w;
    const sway = Math.sin(t * 0.6 + i * 1.7) * w * 0.08;
    const topX = baseX + sway * 0.3;
    const botX = baseX + sway;
    const grad = g.createLinearGradient(topX, 0, botX, stageH * 1.25);
    const hue = s.chorus ? (i % 2 ? 'rgba(255,110,220,' : 'rgba(150,120,255,') : 'rgba(170,110,255,';
    grad.addColorStop(0, hue + (s.chorus ? '0.30)' : '0.20)'));
    grad.addColorStop(1, hue + '0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(topX - 6, 0);
    g.lineTo(topX + 6, 0);
    g.lineTo(botX + w * 0.12, stageH * 1.25);
    g.lineTo(botX - w * 0.12, stageH * 1.25);
    g.closePath();
    g.fill();
  }
  g.restore();

  // ステージ床（キャラの足元）
  const floorY = stageH * 0.92;
  const fg = g.createLinearGradient(0, floorY, 0, stageH * 1.15);
  fg.addColorStop(0, 'rgba(160,90,255,0.45)');
  fg.addColorStop(1, 'rgba(160,90,255,0)');
  g.fillStyle = fg;
  g.beginPath();
  g.ellipse(w / 2, floorY, Math.min(w, 520) * 0.48, stageH * 0.09, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(230,190,255,0.5)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.ellipse(w / 2, floorY, Math.min(w, 520) * 0.48, stageH * 0.09, 0, 0, Math.PI * 2);
  g.stroke();
}

/** 舞台上のキャラ画像の位置・大きさ。全ポーズ共通（足元アンカーを同じ点に合わせ、倍率は固定） */
export function stageSpriteRect(
  L: Layout,
  img: { naturalWidth: number; naturalHeight: number },
  anchorX: number,
  anchorY: number,
  scale: number,
  offsetY: number,
) {
  const dh = L.stageH * STAGE_SPRITE_SCALE * scale;
  const dw = dh * (img.naturalWidth / img.naturalHeight);
  const cx = L.w / 2;
  const footY = L.stageH * 0.95 + offsetY;
  return { x: cx - dw * anchorX, y: footY - dh * anchorY, w: dw, h: dh, cx, footY };
}

function drawCharacter(g: CanvasRenderingContext2D, L: Layout, s: RenderState) {
  const { w, stageH } = L;
  // 舞台上のキャラ枠は固定。画像ごとの自動拡大縮小はしない（全ポーズ同じ倍率・同じ足元位置）
  const cx = w / 2;
  const footY = stageH * 0.95 + s.charOffsetY;
  // コンボ節目の小さな弾み（演出軽減では止める）
  let bump = 0;
  if (!s.reduced) {
    const dt = s.now - s.comboBumpAt;
    if (dt >= 0 && dt < 260) bump = Math.sin((dt / 260) * Math.PI) * 6;
  }
  const img = s.character;
  if (img && img.complete && img.naturalWidth > 0) {
    const r = stageSpriteRect(L, img, s.anchorX, s.anchorY, s.charScale, s.charOffsetY);
    const glowDt = s.now - s.hitGlowAt;
    g.save();
    if (!s.reduced && glowDt >= 0 && glowDt < 180) {
      g.shadowColor = 'rgba(255,170,255,0.9)';
      g.shadowBlur = 18 * (1 - glowDt / 180);
    }
    g.drawImage(img, r.x, r.y - bump, r.w, r.h);
    g.restore();
  } else {
    // 画像なし：シルエットで代用（操作は止めない）
    const bh = stageH * 0.9;
    g.fillStyle = 'rgba(200,160,255,0.35)';
    g.beginPath();
    g.arc(cx, footY - bh * 0.72 - bump, bh * 0.16, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(cx, footY - bh * 0.28 - bump, bh * 0.2, bh * 0.3, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 名前プレート
  g.font = '700 13px system-ui, sans-serif';
  const tw = g.measureText(s.characterName).width;
  const px = Math.min(w - tw - 24, cx + Math.min(w, 520) * 0.22);
  const py = stageH * 0.83;
  g.fillStyle = 'rgba(20,6,40,0.75)';
  roundRect(g, px - 10, py - 15, tw + 20, 22, 11);
  g.fill();
  g.strokeStyle = 'rgba(220,170,255,0.7)';
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = '#fff';
  g.fillText(s.characterName, px, py + 1);
}

function drawLanes(g: CanvasRenderingContext2D, L: Layout, s: RenderState) {
  const { laneX, laneW, laneTop, judgeY, h } = L;
  const top = laneTop;
  // レーン背景
  const lg = g.createLinearGradient(0, top, 0, h);
  lg.addColorStop(0, 'rgba(10,4,20,0)');
  lg.addColorStop(0.15, 'rgba(10,4,20,0.72)');
  lg.addColorStop(1, 'rgba(10,4,20,0.9)');
  g.fillStyle = lg;
  g.fillRect(laneX, top, laneW * 4, h - top);
  // 押下ハイライト
  for (let i = 0; i < 4; i++) {
    if (!s.pressed[i]) continue;
    const pg = g.createLinearGradient(0, judgeY - 220, 0, judgeY + 40);
    pg.addColorStop(0, 'rgba(255,140,230,0)');
    pg.addColorStop(1, 'rgba(255,140,230,0.32)');
    g.fillStyle = pg;
    g.fillRect(laneX + i * laneW, judgeY - 220, laneW, 260);
  }
  // 小節線（テンポマップ由来）
  g.strokeStyle = 'rgba(200,160,255,0.16)';
  g.lineWidth = 1;
  for (const bt of s.barLines) {
    const y = noteY(L, s, bt);
    if (y < top || y > judgeY) continue;
    g.beginPath();
    g.moveTo(laneX, y);
    g.lineTo(laneX + laneW * 4, y);
    g.stroke();
  }
  // レーン境界
  for (let i = 0; i <= 4; i++) {
    const x = Math.round(laneX + i * laneW) + 0.5;
    const edge = i === 0 || i === 4;
    const bg = g.createLinearGradient(0, top, 0, judgeY);
    bg.addColorStop(0, 'rgba(220,180,255,0)');
    bg.addColorStop(0.2, edge ? 'rgba(230,190,255,0.75)' : 'rgba(220,180,255,0.35)');
    g.strokeStyle = bg;
    g.lineWidth = edge ? 2 : 1;
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x, h);
    g.stroke();
  }
  // 判定線
  g.save();
  g.shadowColor = 'rgba(255,150,240,0.9)';
  g.shadowBlur = 10;
  g.fillStyle = '#ffe9fb';
  g.fillRect(laneX, judgeY - 2, laneW * 4, 4);
  g.restore();
  // 受け枠＋キー表示
  for (let i = 0; i < 4; i++) {
    const x = laneX + i * laneW;
    g.strokeStyle = s.pressed[i] ? '#fff' : 'rgba(255,220,250,0.45)';
    g.lineWidth = 2;
    roundRect(g, x + laneW * 0.08, judgeY - 11, laneW * 0.84, 22, 8);
    g.stroke();
    if (s.showKeys) {
      g.fillStyle = 'rgba(255,230,255,0.55)';
      g.font = '700 14px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(LANE_KEY_LABELS[i], x + laneW / 2, judgeY + 40);
      g.textAlign = 'left';
    }
  }
  // コンボ：ノーツ領域にもキャラにも重ならない、舞台左下（キャラの左・名前プレートの反対側）に置く
  if (s.combo >= 5) {
    const dt = s.now - s.comboBumpAt;
    const sc = !s.reduced && dt >= 0 && dt < 200 ? 1 + 0.12 * Math.sin((dt / 200) * Math.PI) : 1;
    g.save();
    g.translate(laneX + 14, L.stageH * 0.74);
    g.scale(sc, sc);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(255,235,255,0.85)';
    g.font = '800 34px system-ui, sans-serif';
    g.fillText(String(s.combo), 0, 0);
    g.fillStyle = 'rgba(255,220,250,0.6)';
    g.font = '700 11px system-ui, sans-serif';
    g.fillText('COMBO', 2, 15);
    g.restore();
  }
}

function noteY(L: Layout, s: RenderState, tMs: number): number {
  return L.judgeY - ((tMs - s.songMs) / s.travelMs) * (L.judgeY - L.laneTop);
}

function drawNotes(g: CanvasRenderingContext2D, L: Layout, s: RenderState) {
  const { laneX, laneW, laneTop, judgeY, h } = L;
  const noteH = Math.max(14, Math.min(20, laneW * 0.18));
  const horizonMs = s.songMs + s.travelMs * 1.05;
  const pastMs = s.songMs - 200;
  // 同時押しの連結線（先に描く）
  const pairY = new Map<number, number[]>();
  for (const n of s.notes) {
    if (n.t > horizonMs) break;
    if (s.headDone(n.id) || !s.doubles.has(n.id)) continue;
    const key = Math.round(n.t);
    const xs = pairY.get(key) ?? [];
    xs.push(n.lane);
    pairY.set(key, xs);
  }
  for (const [t, lanes] of pairY) {
    if (lanes.length < 2) continue;
    const y = noteY(L, s, t);
    if (y < laneTop - 10 || y > h) continue;
    const a = Math.min(...lanes);
    const b = Math.max(...lanes);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(laneX + (a + 0.5) * laneW, y - 1.5, (b - a) * laneW, 3);
  }
  for (const n of s.notes) {
    if (n.t > horizonMs) break;
    const isHold = n.end !== undefined;
    if (isHold) {
      if (s.tailDone(n.id) && !s.held(n.id)) continue;
      if ((n.end as number) < pastMs) continue;
    } else if (s.headDone(n.id) || n.t < pastMs) continue;
    const x = laneX + n.lane * laneW + laneW * 0.08;
    const nw = laneW * 0.84;
    const col = LANE_COLORS[n.lane];
    const headMissed = s.headDone(n.id) && !s.held(n.id);
    let yHead = noteY(L, s, n.t);
    if (isHold) {
      const holding = s.held(n.id);
      if (holding) yHead = Math.min(yHead, judgeY);
      const yEnd = Math.max(laneTop - 20, noteY(L, s, n.end as number));
      // 本体：縞模様（色だけに頼らない）
      g.save();
      g.globalAlpha = headMissed ? 0.3 : holding ? 1 : 0.85;
      const bw = nw * 0.62;
      const bx = x + (nw - bw) / 2;
      const top = Math.min(yEnd, yHead);
      const bh = Math.max(0, yHead - yEnd);
      g.fillStyle = holding ? 'rgba(255,190,245,0.75)' : 'rgba(200,150,255,0.5)';
      g.fillRect(bx, top, bw, bh);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 2;
      for (let yy = yHead - 12; yy > top; yy -= 18) {
        g.beginPath();
        g.moveTo(bx + 2, yy);
        g.lineTo(bx + bw - 2, yy - 6);
        g.stroke();
      }
      // 終端キャップ
      g.fillStyle = '#ffffff';
      roundRect(g, x + nw * 0.1, yEnd - 4, nw * 0.8, 8, 4);
      g.fill();
      g.restore();
      if (yHead > laneTop - 20 && yHead < h + 20 && !headMissed) drawTap(g, x, yHead, nw, noteH, col, true);
    } else {
      if (yHead < laneTop - 20 || yHead > h + 20) continue;
      drawTap(g, x, yHead, nw, noteH, col, false);
    }
  }
}

function drawTap(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string, hold: boolean) {
  g.save();
  g.fillStyle = col;
  g.shadowColor = col;
  g.shadowBlur = 8;
  roundRect(g, x, y - h / 2, w, h, h / 2);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,0.9)';
  roundRect(g, x + 4, y - h / 2 + 3, w - 8, Math.max(3, h * 0.28), 3);
  g.fill();
  if (hold) {
    // 長押し始点の印：中央の菱形
    g.fillStyle = '#2a0b3d';
    g.beginPath();
    g.moveTo(x + w / 2, y - h * 0.32);
    g.lineTo(x + w / 2 + h * 0.4, y);
    g.lineTo(x + w / 2, y + h * 0.32);
    g.lineTo(x + w / 2 - h * 0.4, y);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function drawFx(g: CanvasRenderingContext2D, L: Layout, s: RenderState) {
  const { laneX, laneW, judgeY, laneTop } = L;
  let lastText: FxItem | null = null;
  for (const f of s.fx) {
    const dt = s.now - f.at;
    if (f.kind === 'burst') {
      if (dt > 260 || f.grade === 'miss') continue;
      const p = dt / 260;
      const cx = laneX + (f.lane + 0.5) * laneW;
      g.save();
      g.globalAlpha = 1 - p;
      g.strokeStyle = GRADE_COLOR[f.grade];
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(cx, judgeY, laneW * (0.3 + p * (s.reduced ? 0.2 : 0.45)), 14 + p * 20, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    } else if (f.kind === 'text' && dt < 420) lastText = f;
  }
  if (lastText) {
    const dt = s.now - lastText.at;
    const y = laneTop + (judgeY - laneTop) * 0.62 - (s.reduced ? 0 : Math.min(dt, 120) * 0.08);
    g.save();
    g.globalAlpha = dt < 300 ? 1 : 1 - (dt - 300) / 120;
    g.textAlign = 'center';
    g.font = '800 26px system-ui, sans-serif';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(15,4,30,0.9)';
    const cx = laneX + laneW * 2;
    const label = GRADE_LABEL[lastText.grade];
    g.strokeText(label, cx, y);
    g.fillStyle = GRADE_COLOR[lastText.grade];
    g.fillText(label, cx, y);
    if (s.showFastSlow && lastText.delta !== undefined && lastText.grade !== 'perfect' && lastText.grade !== 'miss') {
      const fast = lastText.delta < 0;
      g.font = '700 13px system-ui, sans-serif';
      const sub = fast ? 'FAST' : 'SLOW';
      g.strokeText(sub, cx, y + 20);
      g.fillStyle = fast ? '#7fd0ff' : '#ffab70';
      g.fillText(sub, cx, y + 20);
    }
    g.restore();
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h / 2, w / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
