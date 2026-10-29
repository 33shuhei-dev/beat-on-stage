/**
 * 音声エンジン。譜面時刻の基準は常に AudioContext の出力時刻（getOutputTimestamp）で、
 * フレーム数やタイマー積算は使わない。
 *
 * 曲位置 songSec = bufferOffset + (出力中のコンテキスト時刻 − startCtxTime)
 *   - 開始時は bufferOffset=0, startCtxTime=now+カウントダウン → カウントダウン中は負の値
 *   - 再開時は巻き戻した位置を bufferOffset にして同じ式を使う
 */
type Ctx = AudioContext & { outputLatency?: number };

export class AudioEngine {
  readonly ctx: Ctx;
  readonly musicGain: GainNode;
  readonly sfxGain: GainNode;
  private hitBuffer: AudioBuffer;
  private source: AudioBufferSourceNode | null = null;
  private startCtxTime = 0;
  private bufferOffset = 0;
  private frozenAt: number | null = 0;
  private lastCtxNow = 0;

  constructor() {
    const AC: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' }) as Ctx;
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain.connect(this.ctx.destination);
    this.sfxGain.connect(this.ctx.destination);
    this.hitBuffer = makeHitBuffer(this.ctx);
  }

  /** ユーザー操作の中で呼ぶ（自動再生制限の解除） */
  async unlock(): Promise<boolean> {
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      // iOS向け：無音を1回鳴らしてオーディオ経路を開く
      const s = this.ctx.createBufferSource();
      s.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      s.connect(this.ctx.destination);
      s.start();
    } catch {
      /* 状態で判断する */
    }
    return this.ctx.state === 'running';
  }

  get running(): boolean {
    return this.ctx.state === 'running';
  }

  /** 現在出力されているコンテキスト時刻（秒）を、指定の performance.now() 値で求める */
  private ctxTimeAtPerf(perfMs: number): number {
    const ctx = this.ctx;
    let t: number;
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    if (ts && ts.contextTime && ts.performanceTime && ctx.state === 'running') {
      t = ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    } else {
      const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
      t = ctx.currentTime - lat + (perfMs - performance.now()) / 1000;
    }
    return t;
  }

  /** 曲位置（秒）。一時停止中は停止位置で固定。 */
  songTime(perfMs = performance.now()): number {
    if (this.frozenAt !== null) return this.frozenAt;
    let c = this.ctxTimeAtPerf(perfMs);
    // 描画用は単調増加を保証（入力時刻の算出は perfMs 指定で別に呼ぶ）
    if (perfMs >= performance.now() - 1) {
      if (c < this.lastCtxNow) c = this.lastCtxNow;
      this.lastCtxNow = c;
    }
    return this.bufferOffset + (c - this.startCtxTime);
  }

  /** 入力イベントの timeStamp から曲位置（秒）を求める */
  songTimeAtEvent(eventTimeStamp: number): number {
    if (this.frozenAt !== null) return this.frozenAt;
    const c = this.ctxTimeAtPerf(eventTimeStamp);
    return this.bufferOffset + (c - this.startCtxTime);
  }

  /**
   * buffer を offsetSec から再生。leadSec 後に offsetSec の音が鳴る。
   * 戻り値の Promise は不要（同期）。再生ノードは常に1つだけ。
   */
  play(buffer: AudioBuffer, offsetSec: number, leadSec: number, onEnded?: () => void): void {
    this.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.musicGain);
    // 曲位置 = offsetSec + (ctx − startAt)。offsetSec が負なら曲頭の音は startAt − offsetSec に鳴る
    const startAt = this.ctx.currentTime + leadSec;
    src.start(startAt + Math.max(0, -offsetSec), Math.max(0, offsetSec));
    this.bufferOffset = offsetSec;
    this.startCtxTime = startAt;
    this.frozenAt = null;
    this.lastCtxNow = 0;
    src.onended = () => {
      if (this.source === src) {
        this.source = null;
        onEnded?.();
      }
    };
    this.source = src;
  }

  /** 再生停止して曲位置を固定 */
  freeze(): number {
    const t = this.songTime();
    this.stop();
    this.frozenAt = t;
    return t;
  }

  stop(): void {
    const s = this.source;
    this.source = null;
    if (s) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
  }

  playHit(): void {
    if (this.ctx.state !== 'running' || this.sfxGain.gain.value <= 0.001) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.hitBuffer;
    s.connect(this.sfxGain);
    s.start();
  }

  setVolumes(music: number, sfx: number): void {
    this.musicGain.gain.value = music;
    this.sfxGain.gain.value = sfx;
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    // Safari 旧版のコールバック形式にも対応
    return await new Promise<AudioBuffer>((resolve, reject) => {
      const p = this.ctx.decodeAudioData(data, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
  }

  close(): void {
    this.stop();
    void this.ctx.close();
  }
}

/**
 * 打音をコードで生成。「ピッ」という細い電子音ではなく、
 * 低いアタック（胴鳴り）＋手拍子のようなノイズ＋短い高域の芯を重ねた、厚みのある「タンッ」に寄せる。
 */
function makeHitBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 0.16);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let seed = 12345;
  let lp = 0;
  let hpPrev = 0;
  let hpOut = 0;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const white = (seed / 0x7fffffff) * 2 - 1;
    // ノイズを帯域制限（ハイパス→ローパス）して 1〜5kHz 付近の「パシッ」に
    hpOut = 0.86 * (hpOut + white - hpPrev);
    hpPrev = white;
    lp += 0.45 * (hpOut - lp);
    const snap = lp * Math.exp(-t * 38) * 0.9;
    // 胴鳴り：240Hz→110Hz へ下がるサイン
    const f = 110 + 130 * Math.exp(-t * 40);
    phase += (2 * Math.PI * f) / sr;
    const body = Math.sin(phase) * Math.exp(-t * 28) * 0.85;
    // 立ち上がりの芯（最初の数ms）
    const tick = Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-t * 400) * 0.35;
    const attack = Math.min(1, t / 0.0008);
    d[i] = (body + snap + tick) * attack;
  }
  // 正規化（ピーク0.9）
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < len; i++) d[i] *= 0.9 / peak;
  return buf;
}

/** 練習・タイミング調整用のクリック音トラックを生成（beatTimes は秒） */
export function makeClickTrack(ctx: BaseAudioContext, beatTimes: number[], accentEvery: number, lengthSec: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.ceil(sr * lengthSec), sr);
  const d = buf.getChannelData(0);
  beatTimes.forEach((bt, i) => {
    const f = i % accentEvery === 0 ? 1760 : 1175;
    const start = Math.floor(bt * sr);
    const n = Math.floor(sr * 0.06);
    for (let k = 0; k < n && start + k < d.length; k++) {
      const t = k / sr;
      d[start + k] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 60) * 0.7;
    }
  });
  return buf;
}
