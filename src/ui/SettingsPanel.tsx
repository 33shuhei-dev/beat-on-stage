import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, travelMsForSpeed, type Settings } from '../config';
import { getAudio } from '../audioHub';
import { buildCalibration } from '../engine/practice';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
}

export function SettingsPanel({ settings, onChange, onClose }: Props) {
  const [calib, setCalib] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });

  if (calib) return <Calibration settings={settings} onApply={(o) => set('offsetMs', o)} onClose={() => setCalib(false)} />;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="設定">
      <div className="panel settings">
        <h2>設定</h2>
        <label className="row">
          <span>ノーツ速度 <b>{settings.noteSpeed}</b><small>（上から判定線まで約{(travelMsForSpeed(settings.noteSpeed) / 1000).toFixed(2)}秒）</small></span>
          <input type="range" min={1} max={10} step={0.5} value={settings.noteSpeed} onChange={(e) => set('noteSpeed', Number(e.target.value))} />
        </label>
        <div className="row">
          <span>タイミング補正 <b>{settings.offsetMs > 0 ? '+' : ''}{settings.offsetMs}ms</b></span>
          <div className="stepper">
            <button className="btn mini" onClick={() => set('offsetMs', Math.max(-300, settings.offsetMs - 5))} aria-label="5ms早く">−5</button>
            <input type="range" min={-300} max={300} step={5} value={settings.offsetMs} onChange={(e) => set('offsetMs', Number(e.target.value))} aria-label="タイミング補正" />
            <button className="btn mini" onClick={() => set('offsetMs', Math.min(300, settings.offsetMs + 5))} aria-label="5ms遅く">+5</button>
          </div>
          <small className="help">＋にすると、ノーツが判定線に来る瞬間と判定が遅くなります（音が遅れて聞こえる・SLOWが多いとき）。−はその逆（FASTが多いとき）。Bluetoothイヤホンは大きく遅れることがあります。</small>
          <button className="btn" onClick={() => setCalib(true)}>タイミング調整テスト</button>
        </div>
        <label className="row">
          <span>音楽の音量 <b>{Math.round(settings.musicVolume * 100)}</b></span>
          <input type="range" min={0} max={1} step={0.05} value={settings.musicVolume} onChange={(e) => set('musicVolume', Number(e.target.value))} />
        </label>
        <label className="row">
          <span>打音の音量 <b>{Math.round(settings.hitVolume * 100)}</b></span>
          <input type="range" min={0} max={1} step={0.05} value={settings.hitVolume} onChange={(e) => set('hitVolume', Number(e.target.value))} />
        </label>
        <label className="row toggle">
          <span>FAST / SLOW 表示</span>
          <input type="checkbox" checked={settings.showFastSlow} onChange={(e) => set('showFastSlow', e.target.checked)} />
        </label>
        <label className="row toggle">
          <span>演出を減らす<small>（ライトの揺れ・弾み・サビの背景変化を止める）</small></span>
          <input type="checkbox" checked={settings.reducedEffects} onChange={(e) => set('reducedEffects', e.target.checked)} />
        </label>
        <div className="actions">
          <button className="btn ghost" onClick={() => onChange({ ...DEFAULT_SETTINGS })}>初期値に戻す</button>
          <button className="btn primary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

/** クリック音に合わせてタップ → ずれの中央値を補正値として提案。光る輪は現在の補正を反映して動く */
function Calibration({ settings, onApply, onClose }: { settings: Settings; onApply: (o: number) => void; onClose: () => void }) {
  const [running, setRunning] = useState(false);
  const [deltas, setDeltas] = useState<number[]>([]);
  const ringRef = useRef<HTMLDivElement>(null);
  const beatsRef = useRef<number[]>([]);
  const rafRef = useRef(0);
  const offsetRef = useRef(settings.offsetMs);
  offsetRef.current = settings.offsetMs;

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    getAudio().stop();
    setRunning(false);
  };
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const startTest = async () => {
    const audio = getAudio();
    const ok = await audio.unlock();
    if (!ok) return;
    const { beats, buffer } = buildCalibration(audio.ctx);
    beatsRef.current = beats;
    setDeltas([]);
    audio.setVolumes(Math.max(0.6, settings.musicVolume), 0);
    audio.play(buffer, 0, 0.2, () => setRunning(false));
    setRunning(true);
    const tick = () => {
      const t = audio.songTime() * 1000 - offsetRef.current;
      const near = beats.reduce((m, b) => (Math.abs(b * 1000 - t) < Math.abs(m - t) ? b * 1000 : m), Infinity);
      const d = t - near;
      const k = d >= 0 && d < 160 ? 1 - d / 160 : 0;
      if (ringRef.current) {
        ringRef.current.style.transform = `scale(${1 + k * 0.35})`;
        ringRef.current.style.opacity = String(0.35 + k * 0.65);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const tap = (ts: number) => {
    if (!running) return;
    const audio = getAudio();
    const now = performance.now();
    const t = audio.songTimeAtEvent(ts > 0 && Math.abs(now - ts) < 1000 ? ts : now) * 1000;
    const near = beatsRef.current.reduce((m, b) => (Math.abs(b * 1000 - t) < Math.abs(m - t) ? b * 1000 : m), Infinity);
    const d = t - near;
    if (Math.abs(d) < 250) setDeltas((xs) => [...xs, d].slice(-16));
  };

  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const suggest = median === null ? null : Math.round(median / 5) * 5;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="タイミング調整テスト">
      <div className="panel settings">
        <h2>タイミング調整テスト</h2>
        <p className="note">「テスト開始」のあと、聞こえるクリック音に合わせて下の枠をタップ（PCはスペースキー）。8回以上で提案値が安定します。輪の光り方は今の補正値で動きます。</p>
        <div
          className="calib-pad"
          role="button"
          tabIndex={0}
          onPointerDown={(e) => {
            e.preventDefault();
            tap(e.timeStamp);
          }}
          onKeyDown={(e) => {
            if (e.code === 'Space' && !e.repeat) {
              e.preventDefault();
              tap(e.timeStamp);
            }
          }}
        >
          <div className="calib-ring" ref={ringRef} />
          <span>{running ? 'タップ！' : '待機中'}</span>
        </div>
        <p className="note">
          記録 {deltas.length}回
          {median !== null && <> ／ ずれの中央値 <b>{median > 0 ? '+' : ''}{Math.round(median)}ms</b>（{median > 0 ? '遅め' : '早め'}）</>}
        </p>
        <p className="note small">現在の補正：{settings.offsetMs > 0 ? '+' : ''}{settings.offsetMs}ms</p>
        <div className="actions">
          {!running ? (
            <button className="btn primary" onClick={() => void startTest()}>テスト開始</button>
          ) : (
            <button className="btn" onClick={stop}>止める</button>
          )}
          <button className="btn" disabled={suggest === null || deltas.length < 4} onClick={() => suggest !== null && onApply(Math.max(-300, Math.min(300, suggest)))}>
            提案値 {suggest !== null ? `${suggest > 0 ? '+' : ''}${suggest}ms` : ''} を使う
          </button>
          <button className="btn ghost" onClick={() => { stop(); onClose(); }}>戻る</button>
        </div>
      </div>
    </div>
  );
}
