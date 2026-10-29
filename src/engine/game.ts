import { KEY_LANES, TIMING, travelMsForSpeed, type Settings } from '../config';
import type { CharacterState, TimedNote } from '../types';
import type { AudioEngine } from './audio';
import { Judge, type JudgeEvent, type JudgeStats } from './judge';
import { isComboMilestone, ReactionController } from './reaction';
import { computeLayout, drawFrame, type FxItem, type Layout, type RenderState } from './render';
import type { SpriteSet } from './sprites';

export type SessionState = 'countdown' | 'playing' | 'paused' | 'finished' | 'error' | 'disposed';

export interface SessionResult {
  score: number;
  stats: JudgeStats;
  autoplay: boolean;
}

export interface SessionOptions {
  canvas: HTMLCanvasElement;
  audio: AudioEngine;
  buffer: AudioBuffer;
  notes: TimedNote[];
  barLines: number[];
  chorusStartMs: number | null;
  settings: Settings;
  /** キャラのリアクション画像（全状態を事前読み込み済み。読めない状態は idle、さらに無ければ代替表示） */
  sprites: SpriteSet;
  characterName: string;
  charScale?: number;
  charOffsetY?: number;
  autoplay?: boolean;
  /** 練習など：結果を出さずに終える */
  onState: (s: SessionState, info?: { message?: string }) => void;
  onHud: (score: number, combo: number) => void;
  onFinish: (r: SessionResult) => void;
}

export class GameSession {
  state: SessionState = 'countdown';
  readonly judge: Judge;
  readonly reaction = new ReactionController();
  private shown: CharacterState = 'idle';
  private o: SessionOptions;
  private g: CanvasRenderingContext2D;
  private layout: Layout;
  private raf = 0;
  private pointers = new Map<number, { lane: number; key: string }>();
  private keysDown = new Map<string, number>();
  private pressedCount = [0, 0, 0, 0];
  private fx: FxItem[] = [];
  private comboBumpAt = -1e9;
  private hitGlowAt = -1e9;
  private missAt = -1e9;
  /** この曲位置(秒)で音が鳴り始める。それまでカウントダウン表示 */
  private audioStartPos = 0;
  private pausedPos = 0;
  private notRunningSince: number | null = null;
  private endMs: number;
  private doubles = new Set<number>();
  private ro: ResizeObserver;
  private lastHud = '';
  private usedKeyboard = false;
  private finishedOnce = false;

  constructor(o: SessionOptions) {
    this.o = o;
    this.judge = new Judge(o.notes);
    this.reaction.setBase('ready'); // カウントダウン中は ready
    const g = o.canvas.getContext('2d');
    if (!g) throw new Error('Canvas 2D not available');
    this.g = g;
    this.layout = this.measure();
    this.ro = new ResizeObserver(() => (this.layout = this.measure()));
    this.ro.observe(o.canvas);
    const lastNote = o.notes.reduce((m, n) => Math.max(m, n.end ?? n.t), 0);
    this.endMs = Math.max(lastNote + TIMING.endPaddingSec * 1000, o.buffer.duration * 1000 - 50);
    const byT = new Map<number, number[]>();
    for (const n of o.notes) {
      const k = Math.round(n.t);
      byT.set(k, [...(byT.get(k) ?? []), n.id]);
    }
    for (const ids of byT.values()) if (ids.length > 1) ids.forEach((id) => this.doubles.add(id));

    o.canvas.addEventListener('pointerdown', this.onPointerDown);
    o.canvas.addEventListener('pointerup', this.onPointerUp);
    o.canvas.addEventListener('pointercancel', this.onPointerUp);
    o.canvas.addEventListener('lostpointercapture', this.onPointerUp);
    o.canvas.addEventListener('contextmenu', prevent);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onBlur);
    o.audio.ctx.addEventListener('statechange', this.onCtxState);
  }

  private measure(): Layout {
    const c = this.o.canvas;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    return computeLayout(w, h, dpr);
  }

  /** ユーザー操作内で呼ぶこと */
  start(): void {
    this.applyVolumes();
    this.audioStartPos = 0;
    this.o.audio.play(this.o.buffer, 0, TIMING.countdownSec, this.onAudioEnded);
    this.setState('countdown');
    this.loop();
  }

  applyVolumes(): void {
    this.o.audio.setVolumes(this.o.settings.musicVolume, this.o.settings.hitVolume);
  }

  pause(): void {
    if (this.state !== 'countdown' && this.state !== 'playing') return;
    // カウントダウン中なら、まだ曲頭前。位置は音の開始位置に戻す
    const pos = this.o.audio.freeze();
    this.pausedPos = this.state === 'countdown' ? Math.min(pos, this.audioStartPos) : pos;
    this.handle(this.judge.releaseAll(this.chartMsAtSong(pos)));
    this.pointers.clear();
    this.keysDown.clear();
    this.pressedCount = [0, 0, 0, 0];
    this.setState('paused');
  }

  /** ユーザー操作内で呼ぶこと（自動では復帰しない） */
  async resume(): Promise<void> {
    if (this.state !== 'paused' && this.state !== 'error') return;
    const ok = await this.o.audio.unlock();
    if (!ok) {
      this.setState('error', { message: '音声を再生できませんでした。端末の消音設定や他アプリの再生を確認して、もう一度お試しください。' });
      return;
    }
    const startPos = Math.max(0, this.pausedPos - TIMING.resumeRewindSec);
    // 曲頭前で止めた場合は最初のカウントダウンと同じ扱い
    this.audioStartPos = this.pausedPos <= 0 ? 0 : startPos;
    this.applyVolumes();
    this.o.audio.play(this.o.buffer, this.audioStartPos, TIMING.countdownSec, this.onAudioEnded);
    this.notRunningSince = null;
    this.setState('countdown');
  }

  dispose(): void {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    cancelAnimationFrame(this.raf);
    this.o.audio.stop();
    this.reaction.reset();
    const c = this.o.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerUp);
    c.removeEventListener('lostpointercapture', this.onPointerUp);
    c.removeEventListener('contextmenu', prevent);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onBlur);
    this.o.audio.ctx.removeEventListener('statechange', this.onCtxState);
    this.ro.disconnect();
  }

  private setState(s: SessionState, info?: { message?: string }) {
    if (this.state === 'disposed') return;
    this.state = s;
    // リアクション：カウントダウン中=ready、プレイ中=idle。停止・終了・エラーでは表示中の反応を破棄（遅れて古いポーズに戻らない）
    if (s === 'countdown') this.reaction.setBase('ready');
    else this.reaction.setBase('idle');
    if (s !== 'playing') this.reaction.clearDisplay();
    this.o.onState(s, info);
  }

  /** いま舞台に出しているポーズ（テスト・確認用） */
  reactionState(): CharacterState {
    return this.shown;
  }

  private chartMsAtSong(songSec: number): number {
    return songSec * 1000 - this.o.settings.offsetMs;
  }

  /** 現在の曲位置（秒） */
  songTime(): number {
    return this.o.audio.songTime();
  }

  private eventChartMs(ts: number): number {
    const now = performance.now();
    const t = ts > 0 && Math.abs(now - ts) < 1000 ? ts : now;
    return this.chartMsAtSong(this.o.audio.songTimeAtEvent(t));
  }

  private acceptingInput(): boolean {
    return (this.state === 'playing' || this.state === 'countdown') && !this.o.autoplay;
  }

  private laneAt(clientX: number): number {
    const r = this.o.canvas.getBoundingClientRect();
    const x = clientX - r.left - this.layout.laneX;
    return Math.max(0, Math.min(3, Math.floor(x / this.layout.laneW)));
  }

  private onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    if (!this.acceptingInput()) return;
    const lane = this.laneAt(e.clientX);
    const key = `p${e.pointerId}`;
    try {
      this.o.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.pointers.set(e.pointerId, { lane, key });
    this.pressedCount[lane]++;
    this.press(lane, key, e.timeStamp);
  };

  private onPointerUp = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    this.pressedCount[p.lane] = Math.max(0, this.pressedCount[p.lane] - 1);
    if (this.state === 'playing' || this.state === 'countdown') this.handle(this.judge.release(p.key, this.eventChartMs(e.timeStamp)));
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.state === 'playing' || this.state === 'countdown') {
        e.preventDefault();
        this.pause();
      }
      return;
    }
    const lane = KEY_LANES[e.code];
    if (lane === undefined) return;
    e.preventDefault();
    if (e.repeat || this.keysDown.has(e.code) || !this.acceptingInput()) return;
    this.usedKeyboard = true;
    this.keysDown.set(e.code, lane);
    this.pressedCount[lane]++;
    this.press(lane, `k${e.code}`, e.timeStamp);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const lane = this.keysDown.get(e.code);
    if (lane === undefined) return;
    this.keysDown.delete(e.code);
    this.pressedCount[lane] = Math.max(0, this.pressedCount[lane] - 1);
    if (this.state === 'playing' || this.state === 'countdown') this.handle(this.judge.release(`k${e.code}`, this.eventChartMs(e.timeStamp)));
  };

  private onBlur = () => this.pause();
  private onVisibility = () => {
    if (document.visibilityState === 'hidden') this.pause();
  };
  private onCtxState = () => {
    // 端末割込み（着信など）で音声が止まったら一時停止
    const st = this.o.audio.ctx.state as string;
    if (st !== 'running' && (this.state === 'playing' || this.state === 'countdown')) this.pause();
  };
  private onAudioEnded = () => {
    if (this.state === 'playing') this.finish();
  };

  private press(lane: number, key: string, ts: number) {
    const ev = this.judge.press(lane, this.eventChartMs(ts), key);
    this.handle(ev);
  }

  private handle(events: JudgeEvent[]) {
    const now = performance.now();
    const reactions = this.o.settings.characterReactions;
    for (const e of events) {
      if (reactions) this.reaction.judge(e.grade, e.combo);
      if (e.grade !== 'miss') {
        if (e.part === 'head') this.o.audio.playHit();
        this.hitGlowAt = now;
        this.fx.push({ kind: 'burst', lane: e.lane, grade: e.grade, at: now });
        if (isComboMilestone(e.combo)) this.comboBumpAt = now;
      } else this.missAt = now;
      this.fx.push({ kind: 'text', lane: e.lane, grade: e.grade, at: now, delta: e.deltaMs });
    }
    if (this.fx.length > 40) this.fx.splice(0, this.fx.length - 40);
    if (events.length) this.emitHud();
  }

  private emitHud() {
    const k = `${this.judge.score}:${this.judge.stats.combo}`;
    if (k === this.lastHud) return;
    this.lastHud = k;
    this.o.onHud(this.judge.score, this.judge.stats.combo);
  }

  private finish() {
    if (this.finishedOnce) return;
    this.finishedOnce = true;
    this.handle(this.judge.update(Number.MAX_SAFE_INTEGER));
    this.o.audio.stop();
    this.setState('finished');
    cancelAnimationFrame(this.raf);
    this.o.onFinish({ score: this.judge.score, stats: { ...this.judge.stats }, autoplay: !!this.o.autoplay });
  }

  private autoplayStep(chartMs: number) {
    for (const s of this.judge.states) {
      const n = s.note;
      if (n.t > chartMs) break;
      if (s.head === undefined) this.handle(this.judge.press(n.lane, n.t, `auto${n.id}`));
    }
  }

  private loop = () => {
    if (this.state === 'disposed' || this.state === 'finished') return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const songSec = this.o.audio.songTime();
    const chartMs = this.chartMsAtSong(songSec);

    if (this.state === 'countdown' || this.state === 'playing') {
      // 再生失敗の検出：音声コンテキストが動いていないのに進めない
      if (!this.o.audio.running) {
        this.notRunningSince ??= now;
        if (now - this.notRunningSince > 800) {
          this.o.audio.freeze();
          this.pausedPos = Math.min(songSec, this.audioStartPos);
          this.setState('error', { message: '音声が再生されていません。下のボタンで再開してください（消音モードや他アプリの音声も確認してください）。' });
        }
      } else this.notRunningSince = null;
      if (this.state === 'countdown' && songSec >= this.audioStartPos) this.setState('playing');
      if (this.o.autoplay) this.autoplayStep(chartMs);
      this.handle(this.judge.update(chartMs));
      if (this.state === 'playing' && chartMs >= this.endMs) {
        this.finish();
        return;
      }
    }
    this.draw(chartMs, songSec, now);
  };

  private draw(chartMs: number, songSec: number, now: number) {
    const L = this.layout;
    const pressed = this.pressedCount.map((c) => c > 0);
    const st = this.judge.states;
    this.shown = this.o.settings.characterReactions ? this.reaction.tick(now) : 'idle';
    const sp = this.o.sprites;
    const rs: RenderState = {
      songMs: chartMs,
      travelMs: travelMsForSpeed(this.o.settings.noteSpeed),
      notes: this.o.notes,
      headDone: (id) => st[id].head !== undefined,
      tailDone: (id) => st[id].tail !== undefined,
      held: (id) => st[id].holder !== null,
      doubles: this.doubles,
      barLines: this.o.barLines,
      pressed,
      fx: this.fx,
      combo: this.judge.stats.combo,
      comboBumpAt: this.comboBumpAt,
      hitGlowAt: this.hitGlowAt,
      missAt: this.missAt,
      chorus: !this.o.settings.reducedEffects && this.o.chorusStartMs !== null && chartMs >= this.o.chorusStartMs,
      reduced: this.o.settings.reducedEffects,
      showFastSlow: this.o.settings.showFastSlow,
      now,
      character: sp.get(this.shown),
      anchorX: sp.anchorX,
      anchorY: sp.anchorY,
      characterName: this.o.characterName,
      charScale: this.o.charScale ?? 1,
      charOffsetY: this.o.charOffsetY ?? 0,
      showKeys: this.usedKeyboard || matchMedia('(pointer: fine)').matches,
    };
    drawFrame(this.g, L, rs);
    // カウントダウン表示
    if (this.state === 'countdown') {
      const remain = this.audioStartPos - songSec;
      if (remain > 0) {
        const g = this.g;
        g.save();
        g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
        g.textAlign = 'center';
        g.font = '800 64px system-ui, sans-serif';
        g.fillStyle = 'rgba(255,240,255,0.9)';
        g.strokeStyle = 'rgba(20,5,40,0.9)';
        g.lineWidth = 6;
        const label = String(Math.ceil(remain));
        const y = L.laneTop + (L.judgeY - L.laneTop) * 0.4;
        g.strokeText(label, L.laneX + L.laneW * 2, y);
        g.fillText(label, L.laneX + L.laneW * 2, y);
        g.restore();
      }
    }
  }

  /** テスト用の内部状態 */
  debugInfo() {
    return { state: this.state, songTime: this.o.audio.songTime(), stats: { ...this.judge.stats }, score: this.judge.score, endMs: this.endMs };
  }
}

function prevent(e: Event) {
  e.preventDefault();
}
