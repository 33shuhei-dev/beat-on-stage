import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../config';
import { getAudio } from '../audioHub';
import { GameSession, type SessionResult, type SessionState } from '../engine/game';
import type { TimedNote } from '../types';

export interface PlaySpec {
  title: string;
  subtitle: string;
  buffer: AudioBuffer;
  notes: TimedNote[];
  barLines: number[];
  chorusStartMs: number | null;
  character: HTMLImageElement | null;
  characterName: string;
  charScale?: number;
  charOffsetY?: number;
  autoplay: boolean;
}

interface Props {
  spec: PlaySpec;
  settings: Settings;
  onFinish: (r: SessionResult) => void;
  onRestart: () => void;
  onExit: () => void;
  exitLabel?: string;
}

export function PlayScreen({ spec, settings, onFinish, onRestart, onExit, exitLabel = '選曲へ戻る' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const [state, setState] = useState<SessionState>('countdown');
  const [message, setMessage] = useState<string | undefined>();
  const [hud, setHud] = useState({ score: 0, combo: 0 });
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const s = new GameSession({
      canvas,
      audio: getAudio(),
      buffer: spec.buffer,
      notes: spec.notes,
      barLines: spec.barLines,
      chorusStartMs: spec.chorusStartMs,
      settings,
      character: spec.character,
      characterName: spec.characterName,
      charScale: spec.charScale,
      charOffsetY: spec.charOffsetY,
      autoplay: spec.autoplay,
      onState: (st, info) => {
        setState(st);
        setMessage(info?.message);
      },
      onHud: (score, combo) => setHud({ score, combo }),
      onFinish: (r) => finishRef.current(r),
    });
    sessionRef.current = s;
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('dev')) (window as unknown as { __bos?: unknown }).__bos = s;
    s.start();
    return () => {
      s.dispose();
      if (sessionRef.current === s) sessionRef.current = null;
    };
    // spec が変わる（リトライ）ときは親が key を変えて作り直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paused = state === 'paused';
  const error = state === 'error';

  return (
    <div className="play">
      <canvas ref={canvasRef} className="play-canvas" aria-label="プレイ画面。4レーン。キーボードは D F J K" />
      <div className="hud">
        <div className="hud-left">
          <div className="hud-title">{spec.title}</div>
          <div className="hud-sub">{spec.subtitle}{spec.autoplay ? '・AUTO' : ''}</div>
        </div>
        <div className="hud-right">
          <div className="hud-score" aria-label="スコア">{hud.score.toLocaleString('ja-JP').padStart(7, '0')}</div>
          <button className="hud-pause" aria-label="一時停止" onPointerDown={(e) => e.stopPropagation()} onClick={() => sessionRef.current?.pause()}>
            <span aria-hidden>❚❚</span>
          </button>
        </div>
      </div>
      {(paused || error) && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="panel">
            <h2>{error ? '再生できません' : '一時停止中'}</h2>
            {message && <p className="note">{message}</p>}
            {!error && <p className="note">再開すると少し前から、カウントダウンのあとに続きます。</p>}
            <button className="btn primary" onClick={() => void sessionRef.current?.resume()}>
              {error ? 'もう一度再生する' : '再開'}
            </button>
            <button className="btn" onClick={onRestart}>最初から</button>
            <button className="btn ghost" onClick={onExit}>{exitLabel}</button>
            <p className="note small">中断したプレイは結果・自己ベストに記録されません。</p>
          </div>
        </div>
      )}
    </div>
  );
}
