import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAudio, getBuffer, prefetch } from './audioHub';
import { REACTION, type Settings } from './config';
import { asset, loadChart, loadCharacters, loadSongs } from './data';
import type { SessionResult } from './engine/game';
import { buildPractice } from './engine/practice';
import { resultState } from './engine/reaction';
import { loadSprites, poseSources, type SpriteSet } from './engine/sprites';
import { barLinesMs, buildTimedNotes } from './engine/tempo';
import { bestKey, isDevMode, loadBest, loadSelection, loadSettings, markTutorialSeen, saveBest, saveSelection, saveSettings, setDevMode, tutorialSeen, type BestRecord, type Selection } from './storage';
import { DIFFICULTIES, DIFFICULTY_LABEL, type CharacterData, type CharacterState, type ChartData, type Difficulty, type SongData } from './types';
import { PlayScreen, type PlaySpec } from './ui/PlayScreen';
import { ReactionLab } from './ui/ReactionLab';
import { SettingsPanel } from './ui/SettingsPanel';

type Screen = 'character' | 'profile' | 'song' | 'difficulty' | 'play' | 'practice' | 'result';

/** 曲をそのキャラが遊べるか（専用曲は指定キャラだけ。未指定は登録キャラ全員の共通曲） */
const playableBy = (song: SongData, characterId: string) => song.available && (!song.exclusiveCharacterId || song.exclusiveCharacterId === characterId);

interface ResultView {
  r: SessionResult;
  prevBest: BestRecord | null;
  newBest: boolean;
  /** 結果画面のキャラのポーズ（clear / best） */
  pose: CharacterState;
}

export default function App() {
  const [songs, setSongs] = useState<SongData[] | null>(null);
  const [chars, setChars] = useState<CharacterData[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('character');
  const [sel, setSel] = useState<Selection>(loadSelection);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [chart, setChart] = useState<ChartData | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [sprites, setSprites] = useState<SpriteSet | null>(null);
  const [devMode, setDev] = useState<boolean>(isDevMode);
  const [selectPose, setSelectPose] = useState<string | null>(null);
  const logoTaps = useRef({ n: 0, t: 0 });
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
        c.forEach((ch) => void loadSprites(ch)); // リアクション画像は全状態をプレイ前に読み込む
        // 保存済みの選択を検証（存在しない・非公開・未実装なら既定へ）
        setSel((cur) => {
          const ch = c.find((x) => x.id === cur.characterId) ?? c[0];
          const song = s.find((x) => x.id === cur.songId && playableBy(x, ch?.id ?? '')) ?? s.find((x) => playableBy(x, ch?.id ?? ''))!;
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
    setSprites(null);
    void loadSprites(character).then((sp) => alive && setSprites(sp));
    return () => {
      alive = false;
    };
  }, [character]);

  // キャラ選択画面：入ったとき・選択を変えたときに select ポーズを 800ms（タイマーは画面遷移・再選択で必ず解除）
  useEffect(() => {
    if (screen !== 'character' || !settings.characterReactions || !sel.characterId) {
      setSelectPose(null);
      return;
    }
    setSelectPose(sel.characterId);
    const t = setTimeout(() => setSelectPose(null), REACTION.selectMs);
    return () => clearTimeout(t);
  }, [screen, sel.characterId, settings.characterReactions]);

  const onLogoTap = () => {
    // 開発用メニュー：ロゴを3秒以内に5回タップで切り替え（?dev=1 でも有効）
    const now = Date.now();
    const r = logoTaps.current;
    r.n = now - r.t < 3000 ? r.n + 1 : 1;
    r.t = now;
    if (r.n >= 5) {
      r.n = 0;
      const next = !devMode;
      setDevMode(next);
      setDev(next);
    }
  };

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
    if (!song || !buffer || !notes || !character || !sprites) return null;
    return {
      title: song.title,
      subtitle: DIFFICULTY_LABEL[sel.difficulty],
      buffer,
      notes,
      barLines: song.beatMap ? barLinesMs(song.beatMap) : [],
      chorusStartMs: song.chorusStartSeconds !== null ? song.chorusStartSeconds * 1000 : null,
      sprites,
      characterName: character.name,
      charScale: character.display?.scale,
      charOffsetY: character.display?.offsetY,
      autoplay,
    };
  }, [song, buffer, notes, character, sprites, sel.difficulty, autoplay]);

  const practiceSpec: PlaySpec | null = useMemo(() => {
    if (screen !== 'practice' || !character || !sprites) return null;
    const p = buildPractice(getAudio().ctx);
    return { title: '操作練習', subtitle: 'タップ・同時押し・長押し', buffer: p.buffer, notes: p.notes, barLines: p.barLines, chorusStartMs: null, sprites, characterName: character.name, autoplay: false };
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
    // 初回記録・オートプレイ・同点以下は clear、以前の記録を更新したときだけ best
    const pose = resultState({ autoplay: r.autoplay, hadPreviousBest: prev !== null, improved: newBest });
    setResult({ r, prevBest: prev, newBest, pose });
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
      <Logo onTap={onLogoTap} />

      {screen === 'character' && (
        <section className="screen">
          <div className="step"><span className="step-no">1</span>キャラをえらぶ</div>
          <div className="cards chars">
            {chars.map((c) => (
              <CharacterCard
                key={c.id}
                c={c}
                selected={c.id === sel.characterId}
                posing={selectPose === c.id}
                onSelect={() => {
                  getAudio(); // 最初の操作で音声コンテキストを生成
                  const ok = songs.find((x) => x.id === sel.songId && playableBy(x, c.id)) ?? songs.find((x) => playableBy(x, c.id));
                  setSel({ ...sel, characterId: c.id, songId: ok?.id ?? sel.songId });
                }}
                onProfile={() => {
                  setSel({ ...sel, characterId: c.id });
                  setScreen('profile');
                }}
              />
            ))}
          </div>
          {devMode && character && <ReactionLab character={character} settings={settings} />}
          <p className="note small">キャラによって得点や判定は変わりません。</p>
          <div className="footer-actions">
            <button className="btn ghost" onClick={() => setShowSettings(true)}>⚙ 設定</button>
            <button className="btn primary" disabled={!character} onClick={() => setScreen('song')}>このキャラで決定</button>
          </div>
        </section>
      )}

      {screen === 'profile' && character && <ProfileScreen c={character} onBack={() => setScreen('character')} />}

      {screen === 'song' && character && (
        <section className="screen">
          <div className="step"><span className="step-no">2</span>曲をえらぶ</div>
          <p className="note small">キャラ：{character.name}</p>
          <div className="cards">
            {songs.map((s) => {
              const ok = playableBy(s, character.id);
              const owner = s.exclusiveCharacterId ? chars.find((x) => x.id === s.exclusiveCharacterId)?.name : null;
              return (
                <button
                  key={s.id}
                  className={`song-card ${ok ? '' : 'disabled'} ${sel.songId === s.id ? 'selected' : ''}`}
                  disabled={!ok}
                  aria-disabled={!ok}
                  onClick={() => {
                    getAudio();
                    void prefetch(s.audio);
                    setSel({ ...sel, songId: s.id });
                    setScreen('difficulty');
                  }}
                >
                  <Jacket title={s.title} src={s.jacket} />
                  <div className="song-meta">
                    <div className="song-title">{s.title}</div>
                    <div className="song-info">{owner ? `${owner}専用` : '共通曲'}・{Math.round(s.durationSeconds)}秒</div>
                    {!s.available && <div className="badge">準備中</div>}
                    {s.available && !ok && <div className="badge">{owner}専用</div>}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="footer-actions">
            <button className="btn ghost" onClick={() => setScreen('character')}>← キャラ</button>
            <button className="btn ghost" onClick={() => setShowSettings(true)}>⚙ 設定</button>
          </div>
        </section>
      )}

      {screen === 'difficulty' && song && character && (
        <section className="screen">
          <div className="step"><span className="step-no">3</span>難易度をえらぶ</div>
          <div className="summary">
            <Jacket title={song.title} src={song.jacket} small />
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
            <button className="btn ghost" onClick={() => setScreen('song')}>← 曲</button>
            <button className="btn ghost" onClick={() => setShowSettings(true)}>⚙ 設定</button>
            <button className="btn ghost" disabled={!sprites} onClick={() => { void getAudio().unlock(); setPlayKey((k) => k + 1); setScreen('practice'); }}>操作練習</button>
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
          reactions={settings.characterReactions}
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

const SUBTITLE = 'ミスヘブン総選挙 非公式応援リズムゲーム';

function Logo({ onTap }: { onTap: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <header className="logo" onClick={onTap}>
      {broken ? (
        <div className="logo-main">BEAT <span>ON</span> STAGE</div>
      ) : (
        <img className="logo-img" src={asset('assets/brand/logo.png')} alt="BEAT ON STAGE" width={1774} height={887} onError={() => setBroken(true)} />
      )}
      <div className="logo-sub">{SUBTITLE}</div>
    </header>
  );
}

/** 採用済みジャケット画像を縦横比そのまま表示。読めないときは文字の仮ジャケット */
function Jacket({ title, src, small }: { title: string; src?: string | null; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <div className={`jacket img ${small ? 'small' : ''}`}>
        <img src={asset(src)} alt={`${title} ジャケット`} width={1254} height={1254} loading="eager" onError={() => setBroken(true)} />
      </div>
    );
  }
  return (
    <div className={`jacket ${small ? 'small' : ''}`} aria-hidden>
      <div className="jacket-lights" />
      <div className="jacket-title">{title}</div>
      <div className="jacket-foot">BEAT ON STAGE</div>
    </div>
  );
}

function CharacterCard({ c, selected, posing, onSelect, onProfile }: { c: CharacterData; selected: boolean; posing: boolean; onSelect: () => void; onProfile: () => void }) {
  const [broken, setBroken] = useState(false);
  const [poseBroken, setPoseBroken] = useState(false);
  const selectSrc = c.reactions?.states.select ?? null;
  const showPose = posing && !!selectSrc && !poseBroken;
  const src = showPose ? selectSrc : c.images.idle;
  return (
    <div className={`char-card ${selected ? 'selected' : ''}`}>
      <button className="char-main" onClick={onSelect} aria-pressed={selected}>
        <div className="char-img">
          {src && !broken ? (
            <img
              className={showPose ? 'rx' : ''}
              data-reaction={showPose ? 'select' : 'idle'}
              src={asset(src)}
              alt={c.name}
              onError={() => (showPose ? setPoseBroken(true) : setBroken(true))}
            />
          ) : (
            <div className="char-fallback">{c.name.slice(0, 1)}</div>
          )}
        </div>
        <div className="char-meta">
          <div className="char-name">{c.name}</div>
          <div className="char-type">{c.participationType}</div>
        </div>
      </button>
      <button className="btn mini char-profile" onClick={onProfile}>プロフィール</button>
    </div>
  );
}

/** プロフィール（サイト内表示）。未提供の項目は出さない。外部リンクは押したときだけ別タブで開く */
function ProfileScreen({ c, onBack }: { c: CharacterData; onBack: () => void }) {
  const [broken, setBroken] = useState(false);
  const rows: [string, string][] = [['区分', c.participationType]];
  if (c.affiliation) rows.push(['所属', c.affiliation]);
  return (
    <section className="screen profile">
      <div className="step"><span className="step-no">★</span>プロフィール</div>
      <div className="profile-card">
        <div className="profile-img">
          {c.images.idle && !broken ? <img src={asset(c.images.idle)} alt={c.name} onError={() => setBroken(true)} /> : <div className="char-fallback">{c.name.slice(0, 1)}</div>}
        </div>
        <h2 className="profile-name">{c.name}</h2>
        <dl className="profile-rows">
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        {c.bio && <p className="profile-bio">{c.bio}</p>}
        <p className="note small">紹介文などは準備中です。</p>
        {c.xUrl && <a className="btn" href={c.xUrl} target="_blank" rel="noopener noreferrer">X を見る（別タブで開きます）</a>}
        {c.links?.map((l) => (
          <a key={l.url} className="btn primary" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
        ))}
        {(c.links?.length || c.xUrl) && <p className="note small">外部サイトは別タブで開きます。</p>}
      </div>
      <div className="footer-actions"><button className="btn ghost" onClick={onBack}>← 戻る</button></div>
    </section>
  );
}

/** 結果画面のキャラ。読めないポーズは idle → 元画像の順に代用し、全部だめなら何も出さない（操作は止めない） */
function PoseImg({ character, state }: { character: CharacterData; state: CharacterState }) {
  const list = poseSources(character, state);
  const [idx, setIdx] = useState(0);
  const src = list[idx];
  if (!src) return null;
  const isReaction = !!character.reactions && src !== character.images.idle;
  return <img className={isReaction ? 'rx' : ''} data-reaction={idx === 0 ? state : 'idle'} src={asset(src)} alt={character.name} onError={() => setIdx((i) => i + 1)} />;
}

function ResultScreen({ rv, song, character, difficulty, reactions, chartVersion, onRetry, onBack }: { rv: ResultView; song: SongData; character: CharacterData; difficulty: Difficulty; reactions: boolean; chartVersion: string; onRetry: () => void; onBack: () => void }) {
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
            <PoseImg key={reactions ? rv.pose : 'idle'} character={character} state={reactions ? rv.pose : 'idle'} />
            <div className="char-name">{character.name}</div>
          </div>
          <div className="result-score">
            <div className="label">SCORE</div>
            <div className="score">{r.score.toLocaleString('ja-JP')}</div>
            <div className="best-diff">
              {r.autoplay ? <span className="nw">自己ベスト対象外</span> : prevBest ? (
                <><span className="nw">自己ベスト比</span> <b className={`nw ${diff! > 0 ? 'up' : diff! < 0 ? 'down' : ''}`}>{diff! > 0 ? '+' : ''}{diff!.toLocaleString('ja-JP')}</b>{newBest && <span className="newbest">NEW BEST</span>}</>
              ) : (
                <span className="newbest">初記録</span>
              )}
            </div>
            <div className="combo"><span className="nw">最大コンボ</span> <span className="nw"><b>{s.maxCombo}</b> / {s.totalUnits}</span></div>
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
        <div className="result-foot"><span className="nw">BEAT ON STAGE</span> <span className="nw">{SUBTITLE}</span> <span className="nw">譜面 {chartVersion}</span></div>
      </div>
      {character.xUrl && (
        <a className="btn ghost" href={character.xUrl} target="_blank" rel="noopener noreferrer">{character.name} の X を見る</a>
      )}
      <button className="btn primary big" onClick={onRetry}>もう一度</button>
      <button className="btn ghost" onClick={onBack}>選曲へ</button>
    </section>
  );
}
