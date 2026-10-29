import { useEffect, useRef, useState } from 'react';
import { asset } from '../data';
import type { SongData } from '../types';

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

/** 「フルで聴く」ボタン。押したときだけ試聴パネルが開く */
export function ListenButton({ song, onOpen }: { song: SongData; onOpen: (id: string) => void }) {
  if (!song.fullAudio) return null;
  return (
    <button className="btn mini listen-btn" onClick={() => onOpen(song.id)} aria-label={`${song.title} をフルで聴く`}>
      ♪ フルで聴く
    </button>
  );
}

/**
 * フル試聴パネル（画面下）。HTMLAudioElement で、開いた曲の音源だけを操作時に取得する。
 * 再生/一時停止・シーク・現在/総時間・閉じる。閉じる/アンマウントで停止して位置を捨てる。
 * 画面が隠れたら一時停止（勝手に再開しない）。同時に開けるのは1曲だけ（親が1つの song だけ渡す）。
 */
export function FullListenSheet({ song, volume, onClose }: { song: SongData; volume: number; onClose: () => void }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(song.fullDurationSeconds ?? 0);
  const [attempt, setAttempt] = useState(0);
  const seeking = useRef(false);

  useEffect(() => {
    if (!song.fullAudio) return;
    setError(null);
    setLoading(true);
    setCur(0);
    const a = new Audio();
    ref.current = a;
    a.preload = 'auto';
    a.volume = volume;
    a.src = asset(song.fullAudio) + (attempt ? `?r=${attempt}` : '');
    const on = (t: string, f: () => void) => a.addEventListener(t, f);
    on('loadedmetadata', () => { if (Number.isFinite(a.duration)) setDur(a.duration); });
    on('canplay', () => setLoading(false));
    on('playing', () => { setPlaying(true); setLoading(false); });
    on('pause', () => setPlaying(false));
    on('waiting', () => setLoading(true));
    on('timeupdate', () => { if (!seeking.current) setCur(a.currentTime); });
    on('ended', () => { setPlaying(false); setCur(0); a.currentTime = 0; });
    on('error', () => { setError('音源を読み込めませんでした'); setLoading(false); setPlaying(false); });
    a.play().catch((e: unknown) => {
      // 自動再生が許可されなかった場合などは、一時停止状態で再生ボタンを出す
      if (!(e instanceof DOMException && e.name === 'AbortError')) setPlaying(false);
    });
    const hide = () => { if (document.hidden) a.pause(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', hide);
      a.pause();
      a.removeAttribute('src');
      a.load();
      if (ref.current === a) ref.current = null;
    };
  }, [song.id, song.fullAudio, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (ref.current) ref.current.volume = volume; }, [volume]);

  const toggle = () => {
    const a = ref.current;
    if (!a || error) return;
    if (a.paused) void a.play().catch(() => setPlaying(false));
    else a.pause();
  };
  const total = dur || song.fullDurationSeconds || 0;

  return (
    <div className="listen-sheet" role="region" aria-label={`${song.title} フル試聴`} data-testid="listen-sheet">
      <div className="listen-head">
        <div className="listen-title">♪ {song.title}（フル）</div>
        <button className="btn mini" onClick={onClose} aria-label="試聴を閉じる">閉じる</button>
      </div>
      {error ? (
        <div className="listen-error">
          <span>{error}</span>
          <button className="btn mini primary" onClick={() => setAttempt((n) => n + 1)}>再試行</button>
        </div>
      ) : (
        <div className="listen-ctrl">
          <button className="btn mini primary listen-play" onClick={toggle} aria-label={playing ? '一時停止' : '再生'}>{playing ? '⏸' : '▶'}</button>
          <input
            type="range" min={0} max={Math.max(1, Math.floor(total))} step={1} value={Math.min(Math.floor(cur), Math.floor(total) || 0)}
            aria-label="再生位置"
            onPointerDown={() => { seeking.current = true; }}
            onChange={(e) => setCur(Number(e.target.value))}
            onPointerUp={(e) => { seeking.current = false; if (ref.current) ref.current.currentTime = Number((e.target as HTMLInputElement).value); }}
            onKeyUp={(e) => { if (ref.current) ref.current.currentTime = Number((e.target as HTMLInputElement).value); }}
          />
          <span className="listen-time" aria-label="再生時間">{fmt(cur)} / {fmt(total)}</span>
          {loading && <span className="listen-load">読み込み中…</span>}
        </div>
      )}
    </div>
  );
}
