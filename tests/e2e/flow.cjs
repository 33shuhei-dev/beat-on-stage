// E2E 確認：スマホ幅(390px, タッチ)とPC(キーボード)で 曲選択→キャラ→難易度→プレイ→結果→即リトライ を通す。
// 使い方: npm run build && npx vite preview --port 4173 & node tests/e2e/flow.cjs http://localhost:4173/ <出力dir>
// ボットはページ内で譜面時刻を見ながら、ノーツごとに PointerEvent / KeyboardEvent を発行する（入力→レーン→判定の経路を通す）。
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const [, , BASE = 'http://localhost:4173/', OUT = 'test-results'] = process.argv;
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
};

// 長い音源(>5秒)の再生ノード数を数える（リトライで音が重複しないことの確認）
const initScript = () => {
  window.__musicActive = 0;
  window.__musicStarted = 0;
  const origStart = AudioBufferSourceNode.prototype.start;
  const origStop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function (...a) {
    if (this.buffer && this.buffer.duration > 5) {
      window.__musicActive++;
      window.__musicStarted++;
      this.__music = true;
      this.addEventListener('ended', () => { if (!this.__done) { this.__done = true; window.__musicActive--; } });
    }
    return origStart.apply(this, a);
  };
  AudioBufferSourceNode.prototype.stop = function (...a) {
    if (this.__music && !this.__done) { this.__done = true; window.__musicActive--; }
    return origStop.apply(this, a);
  };
};

// ページ内ボット。mode: 'pointer' | 'key'
const botScript = (mode) => {
  const s = window.__bos;
  const canvas = document.querySelector('canvas');
  const codes = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
  const pressed = new Map(); // noteId -> {pid, releaseAt}
  let pid = 100;
  window.__botLog = { presses: 0, maxConcurrent: 0, states: {} };
  const laneX = (lane) => {
    const r = canvas.getBoundingClientRect();
    const L = s.layout;
    return r.left + L.laneX + (lane + 0.5) * L.laneW;
  };
  const down = (lane, id) => {
    if (mode === 'pointer') {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, clientX: laneX(lane), clientY: innerHeight - 60, pointerType: 'touch', isPrimary: false, bubbles: true, cancelable: true }));
    } else window.dispatchEvent(new KeyboardEvent('keydown', { code: codes[lane], bubbles: true }));
  };
  const up = (lane, id) => {
    if (mode === 'pointer') canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: id, clientX: laneX(lane), clientY: innerHeight - 60, pointerType: 'touch', bubbles: true }));
    else window.dispatchEvent(new KeyboardEvent('keyup', { code: codes[lane], bubbles: true }));
  };
  const tick = () => {
    if (s.state === 'disposed' || s.state === 'finished') return;
    requestAnimationFrame(tick);
    const rs = s.reactionState();
    window.__botLog.states[rs] = (window.__botLog.states[rs] || 0) + 1;
    if (s.state !== 'playing' && s.state !== 'countdown') return;
    const chartMs = s.songTime() * 1000 - s.o.settings.offsetMs;
    for (const [id, p] of pressed) {
      if (chartMs >= p.releaseAt) {
        up(p.lane, p.pid);
        pressed.delete(id);
      }
    }
    for (const st of s.judge.states) {
      const n = st.note;
      if (n.t > chartMs + 4) break;
      if (st.head !== undefined || pressed.has(n.id) || st.__bot) continue;
      if (chartMs - n.t > 100) continue;
      st.__bot = true;
      const id = pid++;
      down(n.lane, id);
      window.__botLog.presses++;
      pressed.set(n.id, { lane: n.lane, pid: id, releaseAt: n.end !== undefined ? n.end + 30 : n.t + 70 });
      window.__botLog.maxConcurrent = Math.max(window.__botLog.maxConcurrent, pressed.size);
    }
  };
  tick();
};

async function waitState(page, st, timeout = 15000) {
  await page.waitForFunction((x) => window.__bos && window.__bos.state === x, st, { timeout });
}

async function run(name, contextOpts, mode) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(contextOpts);
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${name}-${n}.png`) });
  const W = contextOpts.viewport.width;
  const noHScroll = async (label) => {
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(`[${name}] 横スクロールなし: ${label}`, sw <= W, `scrollWidth=${sw}`);
  };

  const external = [];
  page.on('request', (r) => /yuzu-gakari/.test(r.url()) && external.push(r.url()));
  await page.goto(BASE + '?dev=1');
  await page.getByText('キャラをえらぶ').first().waitFor();
  await page.waitForTimeout(300);
  check(`[${name}] 最初の画面はキャラ選択（キャラ→曲→難易度）`, await page.locator('.char-card').first().isVisible());
  check(`[${name}] キャラ選択に入ると select ポーズ（800ms）`, (await page.locator('.char-card >> nth=0 >> .char-img img').getAttribute('data-reaction')) === 'select');
  await shot('1-character');
  await page.waitForTimeout(1000);
  check(`[${name}] 800ms 後は通常ポーズへ戻る`, (await page.locator('.char-card >> nth=0 >> .char-img img').getAttribute('data-reaction')) === 'idle');
  await noHScroll('キャラ選択');

  // プロフィール：サイト内表示。外部リンクは押したときだけ別タブ
  await page.locator('.char-card').first().getByRole('button', { name: 'プロフィール' }).click();
  await page.getByText('ゆず係を見る').waitFor();
  await shot('1b-profile');
  await noHScroll('プロフィール');
  const link = page.getByRole('link', { name: 'ゆず係を見る' });
  check(`[${name}] ゆず係リンクの宛先・別タブ・noopener`, (await link.getAttribute('href')) === 'https://yuzu-gakari.vercel.app' && (await link.getAttribute('target')) === '_blank' && /noopener/.test((await link.getAttribute('rel')) || ''));
  check(`[${name}] 押すまで外部への通信なし／サイト内表示のまま`, external.length === 0 && page.url().startsWith(BASE));
  const profileText = await page.locator('.profile-card').innerText();
  check(`[${name}] 未提供の情報（所属・紹介文・X）は出さず「準備中」と表示`, !/所属/.test(profileText) && !/@|x\.com|twitter/i.test(profileText) && /準備中/.test(profileText), profileText.replace(/\n/g, ' ').slice(0, 80));
  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), link.click()]);
  // 実行環境は外部サイトに届かないので、開いた先のURLは問わず「別タブが開いた」ことだけ見る（宛先はhrefで確認済み）
  check(`[${name}] 押したときだけ別タブで開く`, !!popup, popup ? '別タブが開いた' : 'no popup');
  if (popup) await popup.close().catch(() => {});
  check(`[${name}] 元のタブはサイト内のまま`, page.url().startsWith(BASE) && (await page.getByText('プロフィール').first().isVisible()));
  await page.getByRole('button', { name: '← 戻る' }).click();
  await page.getByText('このキャラで決定').waitFor();

  await page.getByText('このキャラで決定').click();
  await page.locator('.song-card').first().waitFor();
  const vEn = await page.locator('.song-card', { hasText: 'Vote Vote Vote' }).isEnabled();
  const yEn = await page.locator('.song-card', { hasText: '何度でも呼ぶよ' }).isEnabled();
  check(`[${name}] ゆずちゃんは 共通曲・専用曲の両方を選べる`, vEn && yEn);
  const infos = await page.locator('.song-info').allInnerTexts();
  check(`[${name}] 曲カードに「共通曲」「ゆずちゃん専用」を表示`, infos.some((t) => t.includes('共通曲')) && infos.some((t) => t.includes('ゆずちゃん専用')), infos.join('|'));
  await shot('2-song');
  await noHScroll('曲選択');
  await page.locator('.song-card', { hasText: 'Vote Vote Vote' }).click();
  await page.getByRole('button', { name: 'スタート' }).waitFor({ timeout: 20000 });
  const ds = await page.locator('.diff').evaluateAll((els) => els.map((e) => e.disabled));
  check(`[${name}] EASY / NORMAL / HARD がすべて選べる`, ds.length === 3 && ds.every((x) => !x), JSON.stringify(ds));
  check(`[${name}] 既定の難易度は EASY`, /selected/.test((await page.locator('.diff.easy').getAttribute('class')) || ''));
  await page.locator('.diff.normal').click();
  await shot('3-difficulty');
  await noHScroll('難易度');

  // 1回目：初回練習の案内 → スキップ
  await page.getByRole('button', { name: 'スタート' }).click();
  await page.getByText('はじめての方へ').waitFor();
  await shot('4-tutorial');
  await page.getByText('スキップして本番へ').click();
  await waitState(page, 'countdown');
  const ctxState = await page.evaluate(() => window.__bos.o.audio.ctx.state);
  check(`[${name}] ユーザー操作後に AudioContext が running`, ctxState === 'running', ctxState);
  await page.evaluate(botScript, mode);
  await page.waitForTimeout(1500);
  await shot('5-countdown');
  await waitState(page, 'playing', 8000);
  await page.waitForFunction(() => window.__bos.songTime() > 12, null, { timeout: 20000 });
  await shot('6-play-verse');

  // 一時停止（タブ離脱相当の blur）→ 勝手に復帰しない → 再開
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await waitState(page, 'paused');
  const t1 = await page.evaluate(() => window.__bos.songTime());
  const act1 = await page.evaluate(() => window.__musicActive);
  await page.waitForTimeout(1200);
  const t2 = await page.evaluate(() => window.__bos.songTime());
  check(`[${name}] 一時停止中は時間が止まり音も止まる`, t1 === t2 && act1 === 0, `t=${t1.toFixed(3)}→${t2.toFixed(3)} active=${act1}`);
  const stillPaused = await page.evaluate(() => window.__bos.state);
  check(`[${name}] 自動で復帰しない`, stillPaused === 'paused');
  const rsPaused = await page.evaluate(() => window.__bos.reactionState());
  check(`[${name}] 一時停止中は反応を破棄して通常ポーズ（タイマー残留なし）`, rsPaused === 'idle', rsPaused);
  await shot('7-paused');
  await page.getByRole('button', { name: '再開' }).click();
  await waitState(page, 'countdown');
  await page.waitForTimeout(150);
  const rsResume = await page.evaluate(() => window.__bos.reactionState());
  check(`[${name}] 再開後のカウントダウンは ready ポーズ`, rsResume === 'ready', rsResume);
  await waitState(page, 'playing', 8000);
  const t3 = await page.evaluate(() => window.__bos.songTime());
  check(`[${name}] 再開は少し巻き戻して続きから`, t3 > t1 - 3 && t3 < t1 + 1, `paused@${t1.toFixed(2)} resumed@${t3.toFixed(2)}`);

  await page.waitForFunction(() => window.__bos.songTime() > 44, null, { timeout: 60000 });
  await shot('8-play-chorus');
  const drift = await page.evaluate(() => {
    const s = window.__bos;
    const c = s.o.audio.ctx;
    return { song: s.songTime(), ctx: c.currentTime, lat: c.outputLatency || 0, base: c.baseLatency };
  });
  console.log('clock', JSON.stringify(drift));

  await page.locator('.result-card').waitFor({ timeout: 60000 });
  await page.waitForTimeout(400);
  await shot('9-result');
  await noHScroll('結果');
  const r1 = await page.evaluate(() => ({ score: document.querySelector('.result-score .score').textContent, stats: window.__bos.judge.stats, bot: window.__botLog, active: window.__musicActive }));
  console.log('run1', JSON.stringify(r1));
  check(`[${name}] 結果画面が1回表示`, (await page.locator('.result-card').count()) === 1);
  const st = r1.bot.states;
  check(`[${name}] プレイ中に ready/idle/perfect/combo が出た`, ['ready', 'idle', 'perfect', 'combo'].every((k) => st[k] > 0), JSON.stringify(st));
  check(`[${name}] 全PERFECTなので miss/hit/cheer は出ない（ボットの押し遅れでGREATが混ざった回は hit を許容）`, !st.miss && !st.cheer && (r1.stats.perfect === r1.stats.totalUnits ? !st.hit : true), JSON.stringify(st));
  check(`[${name}] 初回記録の結果は clear ポーズ（best にしない）`, (await page.locator('.result-char img').getAttribute('data-reaction')) === 'clear');
  const resImg = await page.evaluate(() => { const i = document.querySelector('.result-char img'); return { ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth }; });
  check(`[${name}] 結果のキャラ画像が読めている`, resImg.ok, JSON.stringify(resImg));
  check(`[${name}] 全判定単位が判定済み`, r1.stats.judgedUnits === r1.stats.totalUnits, `${r1.stats.judgedUnits}/${r1.stats.totalUnits}`);
  check(`[${name}] ボット入力でMISSなし（入力経路・同期・同時押し・長押し＋別レーン）`, r1.stats.miss === 0, `P${r1.stats.perfect} G${r1.stats.great} g${r1.stats.good} M${r1.stats.miss}`);
  check(`[${name}] 同時に押されたのは最大2点`, r1.bot.maxConcurrent <= 2, `max=${r1.bot.maxConcurrent}`);
  check(`[${name}] 終了後に音声ノードが残らない`, r1.active === 0);
  const bestAfter1 = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.includes('best')));
  check(`[${name}] 自己ベストが保存される`, bestAfter1.length === 1, JSON.stringify(bestAfter1));

  // 即リトライ → 途中で「選曲へ戻る」→ 再度スタート、音源の重複がないこと
  await page.getByRole('button', { name: 'もう一度' }).click();
  await waitState(page, 'countdown');
  await page.waitForTimeout(3800);
  const act2 = await page.evaluate(() => window.__musicActive);
  check(`[${name}] 即リトライで音声は1本だけ`, act2 === 1, `active=${act2}`);
  await page.evaluate(() => window.__bos.pause());
  await page.getByRole('button', { name: '最初から' }).click();
  await waitState(page, 'countdown');
  await page.waitForTimeout(3500);
  const act3 = await page.evaluate(() => window.__musicActive);
  check(`[${name}] 「最初から」でも音声は1本だけ`, act3 === 1, `active=${act3}`);
  await page.evaluate(() => window.__bos.pause());
  await page.getByRole('button', { name: '選曲へ戻る' }).click();
  await page.locator('.song-card').first().waitFor();
  const act4 = await page.evaluate(() => window.__musicActive);
  check(`[${name}] 選曲へ戻ると音が止まる`, act4 === 0, `active=${act4}`);
  const bestAfterAbort = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.includes('best')));
  check(`[${name}] 中断プレイは自己ベストを変えない`, JSON.stringify(bestAfterAbort) === JSON.stringify(bestAfter1));

  check(`[${name}] コンソールエラーなし`, errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close();
}


// 全6譜面（2曲×EASY/NORMAL/HARD）をボットで通す：開始→プレイ→結果→（1本目だけ）リトライ
const SONGS = [['Vote Vote Vote', 'vote'], ['何度でも呼ぶよ', 'yobuyo'], ['君が笑うほうへ', 'kimi_ga_warau_hou_e'], ['灯りは消さずにおくよ', 'akari_kikko_mantaro'], ['まだ見ぬ光の真ん中へ', 'mada_minu_hikari']];
const DIFFS = [['easy', 'EASY'], ['normal', 'NORMAL'], ['hard', 'HARD']];
async function oneChart(browser, songLabel, songId, diff, diffLabel, retry) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(initScript);
  await ctx.addInitScript(() => { try { localStorage.setItem('bos:v1:tutorialSeen', 'true'); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const N = `[${songId}/${diff}]`;
  await page.goto(BASE + '?dev=1');
  const owner = { kimi_ga_warau_hou_e: '公園維持清掃車', akari_kikko_mantaro: 'キッコー万太郎', mada_minu_hikari: 'とあまる' }[songId];
  if (owner) await page.locator('.char-card', { hasText: owner }).locator('.char-main').click();
  await page.getByText('このキャラで決定').click();
  await page.locator('.song-card', { hasText: songLabel }).click();
  await page.getByRole('button', { name: 'スタート' }).waitFor({ timeout: 20000 });
  await page.locator(`.diff.${diff}`).click();
  await page.getByText(/自己ベスト|未プレイ/).first().waitFor();
  await page.getByRole('button', { name: 'スタート' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button.big')?.disabled, null, { timeout: 20000 });
  await page.getByRole('button', { name: 'スタート' }).click();
  await waitState(page, 'countdown');
  await page.evaluate(botScript, 'pointer');
  await waitState(page, 'playing', 8000);
  const meta = await page.evaluate(() => ({ notes: window.__bos.judge.states.length, last: Math.max(...window.__bos.judge.states.map((s) => s.note.end ?? s.note.t)) }));
  await page.waitForFunction(() => window.__bos.songTime() > 30, null, { timeout: 60000 });
  await page.screenshot({ path: path.join(OUT, `play-${songId}-${diff}.png`) });
  await page.locator('.result-card').waitFor({ timeout: 90000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `result-${songId}-${diff}.png`) });
  const r = await page.evaluate(() => ({ stats: window.__bos.judge.stats, bot: window.__botLog, active: window.__musicActive, head: document.querySelector('.result-card').innerText.slice(0, 60) }));
  console.log(N, JSON.stringify({ notes: meta.notes, units: r.stats.totalUnits, P: r.stats.perfect, G: r.stats.great, g: r.stats.good, M: r.stats.miss, maxConcurrent: r.bot.maxConcurrent }));
  check(`${N} 結果に曲名・難易度が出る`, r.head.includes(songLabel) && r.head.includes(diffLabel), r.head.replace(/\n/g, ' '));
  check(`${N} 全判定単位が判定済み`, r.stats.judgedUnits === r.stats.totalUnits, `${r.stats.judgedUnits}/${r.stats.totalUnits}`);
  check(`${N} ボット入力でMISSなし・全PERFECT`, r.stats.miss === 0 && r.stats.perfect === r.stats.totalUnits, `P${r.stats.perfect} G${r.stats.great} g${r.stats.good} M${r.stats.miss}`);
  check(`${N} 同時に押されたのは最大2点`, r.bot.maxConcurrent <= 2, `max=${r.bot.maxConcurrent}`);
  check(`${N} 最後のノーツ・長押しはフェード開始前`, meta.last < (songId === 'vote' ? 72000 : songId === 'mada_minu_hikari' ? 82000 : 77000), `last=${(meta.last / 1000).toFixed(2)}s`);
  const best = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('best')));
  check(`${N} 自己ベストは 曲×難易度×譜面版 のキー`, best.length === 1 && best[0] === `bos:v1:best:${songId}:${diff}:0.1.0-draft`, JSON.stringify(best));
  check(`${N} 終了後に音声ノードが残らない`, r.active === 0);
  if (retry) {
    await page.getByRole('button', { name: 'もう一度' }).click();
    await waitState(page, 'countdown');
    await page.waitForTimeout(3800);
    check(`${N} 即リトライで音声は1本だけ`, (await page.evaluate(() => window.__musicActive)) === 1);
    await page.evaluate(() => window.__bos.pause());
    await page.getByRole('button', { name: '選曲へ戻る' }).click();
    await page.locator('.song-card').first().waitFor();
    check(`${N} 選曲へ戻ると音が止まる`, (await page.evaluate(() => window.__musicActive)) === 0);
  }
  check(`${N} コンソールエラーなし`, errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
}
async function allCharts() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null; // 例: ONLY=vote/normal,kimi_ga_warau_hou_e/hard
  for (const [label, id] of SONGS) for (const [d, dl] of DIFFS) if (!only || only.includes(`${id}/${d}`)) await oneChart(browser, label, id, d, dl, d === 'easy');
  await browser.close();
}

// 専用曲：キャラごとの曲の見え方（他キャラの専用曲は出さない／共通曲は全員／自分の専用曲は遊べる）
async function exclusive() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  const titles = async () => (await page.locator('.song-title').allInnerTexts()).map((t) => t.trim());
  const pick = async (name) => {
    await page.locator('.char-card', { hasText: name }).locator('.char-main').click();
    await page.getByText('このキャラで決定').click();
    await page.locator('.song-card').first().waitFor();
  };
  await page.goto(BASE);
  await page.locator('.char-card').nth(1).waitFor();
  const names = (await page.locator('.char-name').allInnerTexts()).map((t) => t.trim());
  check('[キャラ] ゆずちゃん・公園維持清掃車・キッコー万太郎が選べる', names.includes('ゆずちゃん') && names.includes('公園維持清掃車') && names.includes('キッコー万太郎'), names.join('|'));
  check('[公開承認] 未承認のとあまるは一般公開（?dev=1なし）では表示されない', !names.includes('とあまる'), names.join('|'));
  check('[キャラ] キッコー万太郎の区分は「応援者」', /応援者/.test(await page.locator('.char-card', { hasText: 'キッコー万太郎' }).innerText()));
  check('[キャラ] 公園維持清掃車の区分は「応援者」', /応援者/.test(await page.locator('.char-card', { hasText: '公園維持清掃車' }).innerText()));
  await pick('公園維持清掃車');
  await page.screenshot({ path: path.join(OUT, 'exclusive-koen.png') });
  const t1 = await titles();
  check('[専用曲] 公園維持清掃車：共通曲Voteと自分の専用曲が出る', t1.includes('Vote Vote Vote') && t1.includes('君が笑うほうへ'), t1.join('|'));
  check('[専用曲] 公園維持清掃車：他キャラ専用の曲は出さない', !t1.includes('何度でも呼ぶよ') && !t1.includes('灯りは消さずにおくよ'));
  check('[専用曲] 公園維持清掃車：専用曲も共通曲も選べる', (await page.locator('.song-card', { hasText: '君が笑うほうへ' }).isEnabled()) && (await page.locator('.song-card', { hasText: 'Vote Vote Vote' }).isEnabled()));
  check('[専用曲] 公園維持清掃車：専用曲の表示', /公園維持清掃車専用/.test(await page.locator('.song-card', { hasText: '君が笑うほうへ' }).innerText()));
  await page.getByRole('button', { name: '← キャラ' }).click();
  await pick('キッコー万太郎');
  await page.screenshot({ path: path.join(OUT, 'exclusive-kikko.png') });
  const t3 = await titles();
  check('[専用曲] キッコー万太郎：共通曲Voteと専用曲「灯りは消さずにおくよ」が出る', t3.includes('Vote Vote Vote') && t3.includes('灯りは消さずにおくよ') && t3.length === 2, t3.join('|'));
  check('[専用曲] キッコー万太郎：専用曲も共通曲も選べる', (await page.locator('.song-card', { hasText: '灯りは消さずにおくよ' }).isEnabled()) && (await page.locator('.song-card', { hasText: 'Vote Vote Vote' }).isEnabled()));
  await page.getByRole('button', { name: '← キャラ' }).click();
  await pick('ゆずちゃん');
  const t2 = await titles();
  check('[専用曲] ゆずちゃん：共通曲Voteと専用曲が出る', t2.includes('Vote Vote Vote') && t2.includes('何度でも呼ぶよ'), t2.join('|'));
  check('[専用曲] ゆずちゃん：他キャラの専用曲は出さない', !t2.includes('君が笑うほうへ') && !t2.includes('灯りは消さずにおくよ'));
  check('[専用曲] ゆずちゃん：専用曲が選べる', await page.locator('.song-card', { hasText: '何度でも呼ぶよ' }).isEnabled());
  check('[専用曲] ページエラーなし', errs.length === 0, errs.join('|').slice(0, 200));
  // 準備中の曲（差し込み）：共通曲は選べ、準備中は選べず、他キャラへは出ない
  await page.route('**/data/songs.json', async (r) => {
    const res = await r.fetch();
    const list = await res.json();
    await r.fulfill({ response: res, json: list.map((x) => (x.id === 'kimi_ga_warau_hou_e' ? { ...x, available: false } : x)) });
  });
  await page.reload();
  await pick('公園維持清掃車');
  const kk = page.locator('.song-card', { hasText: '君が笑うほうへ' });
  check('[準備中] 専用曲が準備中でも表示され「準備中」と出る・選べない', (await kk.isDisabled()) && /準備中/.test(await kk.innerText()));
  check('[準備中] 準備中でも共通曲Voteを選べる', await page.locator('.song-card', { hasText: 'Vote Vote Vote' }).isEnabled());
  await browser.close();
}

async function failures() {
  // 画像読込失敗・音源読込失敗でも操作不能にならない
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.route('**/idle.png', (r) => r.abort());
  await page.route('**/vote.mp3', (r) => r.fulfill({ status: 404, body: 'x' }));
  await page.goto(BASE);
  await page.getByText('このキャラで決定').click();
  await page.locator('.song-card').first().click();
  await page.getByText(/読み込みに失敗/).first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(OUT, 'fail-audio.png') });
  check('[失敗系] 音源の読込失敗を表示し、黙って進めない', await page.getByRole('button', { name: '再試行' }).isVisible());
  // 音源だけ復旧 → 画像なしでもプレイ可能
  await page.unroute('**/vote.mp3');
  await page.getByRole('button', { name: '再試行' }).click();
  await page.getByRole('button', { name: 'スタート' }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'スタート' }).click();
  await page.getByText('スキップして本番へ').click();
  await page.waitForTimeout(4500);
  await page.screenshot({ path: path.join(OUT, 'fail-image-play.png') });
  const ok = await page.locator('canvas').isVisible();
  check('[失敗系] キャラ画像が読めなくてもプレイ画面が動く', ok);
  await browser.close();

  // 反応画像（idle 以外）が全部読めなくても、idle で代用して普通に遊べる
  const b2 = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const c2 = await b2.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p2 = await c2.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(String(e)));
  await p2.route(/reactions\/v1\/(select|ready|hit|perfect|combo|miss|cheer|clear|best)\.png/, (r) => r.abort());
  await p2.goto(BASE + '?dev=1');
  await p2.getByText('このキャラで決定').click();
  await p2.locator('.song-card').first().click();
  await p2.getByRole('button', { name: 'スタート' }).waitFor({ timeout: 20000 });
  await p2.locator('.row.dev input').check();
  await p2.getByRole('button', { name: 'スタート' }).click();
  await p2.getByText('スキップして本番へ').click().catch(() => {});
  await p2.waitForFunction(() => window.__bos && window.__bos.state === 'playing', null, { timeout: 15000 });
  const fb = await p2.evaluate(() => { const sp = window.__bos.o.sprites; return { comboIsIdle: sp.get('combo') === sp.get('idle') && !!sp.get('idle'), comboOk: sp.status.combo.ok, idleOk: sp.status.idle.ok }; });
  check('[失敗系] 反応画像が読めなくても idle で代用してプレイできる', fb.comboIsIdle && !fb.comboOk && fb.idleOk, JSON.stringify(fb));
  await p2.waitForTimeout(2500);
  check('[失敗系] 反応画像失敗でページエラーなし', errs2.length === 0, errs2.join('|').slice(0, 200));
  await b2.close();
}

(async () => {
  if (!process.env.ONLY) await run('mobile390', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }, 'pointer');
  if (!process.env.ONLY) await run('pc', { viewport: { width: 1280, height: 800 } }, 'key');
  if (!process.env.ONLY) await exclusive();
  await allCharts();
  if (!process.env.ONLY) await failures();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})();
