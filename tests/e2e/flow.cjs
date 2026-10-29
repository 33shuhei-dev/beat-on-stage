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
  window.__botLog = { presses: 0, maxConcurrent: 0 };
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

  await page.goto(BASE + '?dev=1');
  await page.getByText('Vote Vote Vote').first().waitFor();
  await shot('1-song');
  await noHScroll('曲選択');
  const yobuyoDisabled = await page.locator('.song-card', { hasText: '何度でも呼ぶよ' }).isDisabled();
  check(`[${name}] 2曲目は準備中で押せない`, yobuyoDisabled);
  await page.locator('.song-card', { hasText: 'Vote Vote Vote' }).click();
  await page.getByText('このキャラで決定').waitFor();
  await page.waitForTimeout(300);
  await shot('2-character');
  await noHScroll('キャラ選択');
  await page.getByText('このキャラで決定').click();
  await page.getByRole('button', { name: 'スタート' }).waitFor({ timeout: 20000 });
  const easyDisabled = await page.locator('.diff.easy').isDisabled();
  const hardDisabled = await page.locator('.diff.hard').isDisabled();
  check(`[${name}] EASY/HARD は準備中で押せない`, easyDisabled && hardDisabled);
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
  await shot('7-paused');
  await page.getByRole('button', { name: '再開' }).click();
  await waitState(page, 'countdown');
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

async function failures() {
  // 画像読込失敗・音源読込失敗でも操作不能にならない
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.route('**/idle.png', (r) => r.abort());
  await page.route('**/vote.mp3', (r) => r.fulfill({ status: 404, body: 'x' }));
  await page.goto(BASE);
  await page.locator('.song-card').first().click();
  await page.getByText('このキャラで決定').click();
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
}

(async () => {
  await run('mobile390', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }, 'pointer');
  await run('pc', { viewport: { width: 1280, height: 800 } }, 'key');
  await failures();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})();
