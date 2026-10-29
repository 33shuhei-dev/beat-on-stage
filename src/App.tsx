import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAudio, getBuffer, prefetch } from './audioHub';
import { type Settings } from './config';
import { asset, loadChart, loadCharacters, loadImage, loadSongs } from './data';
import type { SessionResult } from './engine/game';
import { buildPractice } from './engine/practice';
import { barLinesMs, buildTimedNotes } from './engine/tempo';
import { bestKey, loadBest, loadSelection, loadSettings, markTutorialSeen, saveBest, saveSelection, saveSettings, tutorialSeen, type BestRecord, type Selection } from './storage';
import { DIFFICULTIES, DIFFICULTY_LABEL, type CharacterData, type ChartData, type Difficulty, type SongData } from './types';
import { PlayScreen, type PlaySpec } from './ui/PlayScreen';
import { SettingsPanel } from './ui/SettingsPanel';

type Screen = 'song' | 'character' | 'difficulty' | 'play' | 'practice' | 'result';

interface ResultView {
  r: SessionResult;
  prevBest: BestRecord | null;
  newBest: boolean;
}

const devMode = new URLSearchParams(location.search).has('dev');

export default function App() {
  const [songs, setSongs] = useState<SongData[] | null>(null);
  const [chars, setChars] = useState<CharacterData[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('song');
  const [sel, setSel] = useState<Selection>(loadSelection);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [chart, setChart] = useState<ChartData | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [charImg, setCharImg] = useState<HTMLImageElement | null>(null);
  const [playKey, setPlayKey] = useState(0);
  const [result, setResult] = useState<ResultView | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const [practiceDone, setPracticeDone] = useState(false);

  const setSettings = (s: Settings) => {
    setSettingsState(s);
    saveSettings(s);
  };

  useEffect(() => {
    Promise.all([loadSongs(), loadCharacters()])
      .then(([s, c]) => {
        setSongs(s);
        setChars(c);
        // 保存済みの選択を検証（存在しない・非公開・未実装なら既定へ）
        setSel((cur) => {
          const song = s.find((x) => x.id === cur.songId && x.available) ?? s.find((x) => x.available)!;
          const ch = c.find((x) => x.id === cur.characterId) ?? c[0];
          const diff = song.charts[cur.difficulty] ? cur.difficulty : (DIFFICULTIES.find((d) => song.charts[d]) ?? 'normal');
          return { songId: song.id, characterId: ch?.id ?? '', difficulty: diff };
        });
      })
      .catch((e) => setLoadError(String(e)));
  }, []);

  const song = songs?.find((s) => s.id === sel.songId) ?? null;
  const character = chars?.find((c) => c.id === sel.characterId) ?? null;

  useEffect(() => {
    if (sel.songId && songs) saveSelection(sel);
  }, [sel, songs]);

  useEffect(() => {
    if (!character) return;
    let alive = true;
    void loadImage(character.images.idle).then((img) => alive && setCharImg(img));
    return () => {
      alive = false;
    };
  }, [character]);

  // 難易度画面に来たら譜面と音源を準備
  const prepare = useCallback(async () => {
    if (!song) return;
    setPrepError(null);
    const path = song.charts[sel.difficulty];
    if (!path) return;
    try {
      const [c, b] = await Promise.all([loadChart(path), getBuffer(song.audio)]);
      setChart(c);
      setBuffer(b);
    } catch (e) {
      setPrepError(`読み込みに失敗しました：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [song, sel.difficulty]);

  useEffect(() => {
    if (screen === 'difficulty') void prepare();
  }, [screen, prepare]);

  const notes = useMemo(() => (chart && song?.beatMap ? buildTimedNotes(chart, song.beatMap) : null), [chart, song]);

  const playSpec: PlaySpec | null = useMemo(() => {
    if (!song || !buffer || !notes || !character) return null;
    return {
      title: song.title,
      subtitle: DIFFICULTY_LABEL[sel.difficulty],
      buffer,
      notes,
      barLines: song.beatMap ? barLinesMs(song.beatMap) : [],
      chorusStartMs: song.chorusStartSeconds !== null ? song.chorusStartSeconds * 1000 : null,
      character: charImg,
      characterName: character.name,
      charScale: character.display?.scale,
      charOffsetY: character.display?.offsetY,
      autoplay,
    };
  }, [song, buffer, notes, character, charImg, sel.difficulty, autoplay]);

  const practiceSpec: PlaySpec | null = useMemo(() => {
    if (screen !== 'practice' || !character) return null;
    const p = buildPractice(getAudio().ctx);
    return { title: '操作練習', subtitle: 'タップ・同時押し・長押し', buffer: p.buffer, notes: p.notes, barLines: p.barLines, chorusStartMs: null, character: charImg, characterName: character.name, autoplay: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, playKey]);

  const startPlay = () => {
    void getAudio().unlock(); // ユーザー操作の中で音声を有効化
    setPlayKey((k) => k + 1);
    setScreen('play');
  };

  const onStartPressed = () => {
    if (!tutorialSeen() && !autoplay) {
      setShowTutorial(true);
      return;
    }
    startPlay();
  };

  const onFinish = (r: SessionResult) => {
    if (!song || !chart) return;
    const k = bestKey(song.id, sel.difficulty, chart.chartVersion);
    const prev = loadBest(k);
    let newBest = false;
    if (!r.autoplay && (!prev || r.score > prev.score)) {
      saveBest(k, { score: r.score, maxCombo: r.stats.maxCombo, at: new Date().toISOString() });
      newBest = true;
    }
    setResult({ r, prevBest: prev, newBest });
    setScreen('result');
  };

  if (loadError) {
    return (
      <div className="app">
        <div className="panel"><h2>読み込みエラー</h2><p className="note">{loadError}</p><button className="btn primary" onClick={() => location.reload()}>再読み込み</button></div>
      </div>
    );
  }
  if (!songs || !chars) return <div className="app"><p className="loading">読み込み中…</p></div>;

  if (screen === 'play' && playSpec) {
    return (
      <PlayScreen
        key={playKey}
        spec={playSpec}
        settings={settings}
        onFinish={onFinish}
        onRestart={startPlay}
        onExit={() => setScreen('song')}
      />
    );
  }
  if (screen === 'practice' && practiceSpec) {
    return (
      <PlayScreen
        key={`p${playKey}`}
        spec={practiceSpec}
        settings={settings}
        onFinish={() => {
          setPracticeDone(true);
          setScreen('difficulty');
        }}
        onRestart={() => {
          void getAudio().unlock();
          setPlayKey((k) => k + 1);
        }}
        onExit={() => setScreen('difficulty')}
        exitLabel="練習をやめる"
      />
    );
  }

  return (
    <div className="app">
      <header className="logo" aria-label="BEAT ON STAGE">
        <div className="logo-main">BEAT <span>ON</span> STAGE</div>
        <div className="logo-sub">ミスヘブン総選挙 非公式応援リズムゲーム</div>
      </header>

      {screen === 'song' && (
        <section className="screen">
          <div className="step"><span className="step-no">1</span>曲をえらぶ</div>
          <div className="cards">
            {songs.map((s) => (
              <button
                key={s.id}
                className={`song-card ${s.available ? '' : 'disabled'} ${sel.songId === s.id ? 'selected' : ''}`}
                disabled={!s.available}
                aria-disabled={!s.available}
                onClick={() => {
                  getAudio(); // 最初の操作で音声コンテキストを生成
                  void prefetch(s.audio);
                  setSel({ ...sel, songId: s.id });
                  setScreen('character');
                }}
              >
                <Jacket title={s.title} />
                <div className="song-meta">
                  <div className="song-title">{s.title}</div>
                  <div className="song-info">{Math.round(s.durationSeconds)}秒{s.available ? '' : ''}</div>
                  {!s.available && <div className="badge">準備中</div>}
                </div>
              </button>
            ))}
          </div>
          <div className="footer-actions">
            <button className="btn ghost" onClick={() => setShowSettings(true)}>⚙ 設定</button>
          </div>
        </section>
      )}

      {screen === 'character' && song && (
        <section className="screen">
          <div className="step"><span className="step-no">2</span>キャラをえらぶ</div>
          <div className="cards chars">
            {chars.map((c) => (
              <CharacterCard key={c.id} c={c} selected={c.id === sel.characterId} onSelect={() => setSel({ ...sel, characterId: c.id })} />
            ))}
          </div>
          <p className="note small">キャラによって得点や判定は変わりません。</p>
          <div className="footer-actions">
            <button className="btn ghost" onClick={() => setScreen('song')}>← 曲選択</button>
            <button className="btn primary" disabled={!character} onClick={() => setScreen('difficulty')}>このキャラで決定</button>
          </div>
        </section>
      )}

      {screen === 'difficulty' && song && character && (
        <section className="screen">
          <div className="step"><span className="step-no">3</span>難易度</div>
          <div className="summary">
            <Jacket title={song.title} small />
            <div>
              <div className="song-title">{song.title}</div>
              <div className="song-info">キャラ：{character.name}</div>
            </div>
          </div>
          <div className="diffs" role="radiogroup" aria-label="難易度">
            {DIFFICULTIES.map((d) => {
              const ok = !!song.charts[d];
              const best = ok && chart && d === sel.difficulty ? loadBest(bestKey(song.id, d, chart.chartVersion)) : null;
              return (
                <button key={d} role="radio" aria-checked={sel.difficulty === d} className={`diff ${d} ${sel.difficulty === d ? 'selected' : ''}`} disabled={!ok} onClick={() => setSel({ ...sel, difficulty: d })}>
                  <span className="diff-name">{DIFFICULTY_LABEL[d]}</span>
                  <span className="diff-info">{ok ? (best ? `自己ベスト ${best.score.toLocaleString('ja-JP')}` : '未プレイ') : '準備中'}</span>
                </button>
              );
            })}
          </div>
          {chart?.status === 'draft' && <p className="note small">※ この譜面は試作版（{chart.chartVersion}）です。</p>}
          {prepError && (
            <div className="error-box">
              <p>{prepError}</p>
              <button className="btn" onClick={() => void prepare()}>再試行</button>
            </div>
          )}
          {practiceDone && <p className="note small">練習おつかれさま！</p>}
          {devMode && (
            <label className="row toggle dev">
              <span>オートプレイ（開発確認用・記録対象外）</span>
              <input type="checkbox" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} />
            </label>
          )}
          <div className="footer-actions">
            <button className="btn ghost" onClick={() => setScreen('character')}>← キャラ</button>
            <button className="btn ghost" onClick={() => setShowSettings(true)}>⚙ 設定</button>
            <button className="btn ghost" onClick={() => { void getAudio().unlock(); setPlayKey((k) => k + 1); setScreen('practice'); }}>操作練習</button>
          </div>
          <button className="btn primary big" disabled={!playSpec} onClick={onStartPressed}>
            {playSpec ? 'スタート' : prepError ? '読み込みに失敗' : '読み込み中…'}
          </button>
          <p className="note small center">スマホは親指2本で。PCは D F J K キー、Esc で一時停止。</p>
        </section>
      )}

      {screen === 'result' && result && song && character && chart && (
        <ResultScreen
          rv={result}
          song={song}
          character={character}
          difficulty={sel.difficulty}
          chartVersion={chart.chartVersion}
          onRetry={startPlay}
          onBack={() => setScreen('song')}
        />
      )}

      {showSettings && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />}
      {showTutorial && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="panel">
            <h2>はじめての方へ</h2>
            <ul className="howto">
              <li>上から落ちるノーツが光る線に重なったら、そのレーンをタップ。</li>
              <li>縞模様の長いノーツは、白い終わりの線まで押しっぱなし。</li>
              <li>横線でつながった2つは同時押し。親指を左右1本ずつ。</li>
            </ul>
            <p className="note">約15秒の操作練習をしますか？</p>
            <button className="btn primary" onClick={() => { markTutorialSeen(); setShowTutorial(false); void getAudio().unlock(); setPlayKey((k) => k + 1); setScreen('practice'); }}>練習する</button>
            <button className="btn" onClick={() => { markTutorialSeen(); setShowTutorial(false); startPlay(); }}>スキップして本番へ</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Jacket({ title, small }: { title: string; small?: boolean }) {
  return (
    <div className={`jacket ${small ? 'small' : ''}`} aria-hidden>
      <div className="jacket-lights" />
      <div className="jacket-title">{title}</div>
      <div className="jacket-foot">BEAT ON STAGE</div>
    </div>
  );
}

function CharacterCard({ c, selected, onSelect }: { c: CharacterData; selected: boolean; onSelect: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <button className={`char-card ${selected ? 'selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
      <div className="char-img">
        {c.images.idle && !broken ? <img src={asset(c.images.idle)} alt={c.name} onError={() => setBroken(true)} /> : <div className="char-fallback">{c.name.slice(0, 1)}</div>}
      </div>
      <div className="char-meta">
        <div className="char-name">{c.name}</div>
        <div className="char-type">{c.participationType}</div>
        {c.affiliation && <div className="char-aff">{c.affiliation}</div>}
        {c.bio && <div className="char-bio">{c.bio}</div>}
        {c.xUrl && (
          <a className="char-x" href={c.xUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            X を見る
          </a>
        )}
      </div>
    </button>
  );
}

function ResultScreen({ rv, song, character, difficulty, chartVersion, onRetry, onBack }: { rv: ResultView; song: SongData; character: CharacterData; difficulty: Difficulty; chartVersion: string; onRetry: () => void; onBack: () => void }) {
  const { r, prevBest, newBest } = rv;
  const s = r.stats;
  const diff = prevBest ? r.score - prevBest.score : null;
  const rank = r.score >= 950000 ? 'S' : r.score >= 850000 ? 'A' : r.score >= 700000 ? 'B' : 'C';
  return (
    <section className="screen result">
      <div className="result-card">
        <div className="result-head">
          <div>
            <div className="song-title">{song.title}</div>
            <div className="song-info">{DIFFICULTY_LABEL[difficulty]}{r.autoplay ? '・オートプレイ（記録対象外）' : ''}</div>
          </div>
          <div className="rank" aria-label={`ランク ${rank}`}>{rank}</div>
        </div>
        <div className="result-main">
          <div className="result-char">
            {character.images.idle ? <img src={asset(character.images.idle)} alt={character.name} /> : null}
            <div className="char-name">{character.name}</div>
          </div>
          <div className="result-score">
            <div className="label">SCORE</div>
            <div className="score">{r.score.toLocaleString('ja-JP')}</div>
            <div className="best-diff">
              {r.autoplay ? '自己ベスト対象外' : prevBest ? (
                <>自己ベスト比 <b className={diff! > 0 ? 'up' : diff! < 0 ? 'down' : ''}>{diff! > 0 ? '+' : ''}{diff!.toLocaleString('ja-JP')}</b>{newBest && <span className="newbest">NEW BEST</span>}</>
              ) : (
                <span className="newbest">初記録</span>
              )}
            </div>
            <div className="combo">最大コンボ <b>{s.maxCombo}</b> / {s.totalUnits}</div>
          </div>
        </div>
        <table className="breakdown">
          <tbody>
            <tr><th className="g-perfect">PERFECT</th><td>{s.perfect}</td></tr>
            <tr><th className="g-great">GREAT</th><td>{s.great}</td></tr>
            <tr><th className="g-good">GOOD</th><td>{s.good}</td></tr>
            <tr><th className="g-miss">MISS</th><td>{s.miss}</td></tr>
            <tr><th>FAST / SLOW</th><td>{s.fast} / {s.slow}</td></tr>
          </tbody>
        </table>
        <div className="result-foot">BEAT ON STAGE ・ ミスヘブン総選挙 非公式応援リズムゲーム ・ 譜面 {chartVersion}</div>
      </div>
      {character.xUrl && (
        <a className="btn ghost" href={character.xUrl} target="_blank" rel="noopener noreferrer">{character.name} の X を見る</a>
      )}
      <button className="btn primary big" onClick={onRetry}>もう一度</button>
      <button className="btn ghost" onClick={onBack}>選曲へ</button>
    </section>
  );
}
