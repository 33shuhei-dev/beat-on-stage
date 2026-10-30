// フル試聴の確認（390px・タッチ）。再生/一時停止/シーク/時間表示/閉じる/曲切替/画面移動・ゲーム開始での停止/同時1曲/初期表示で取得しない/失敗時の再試行。
// 使い方: node tests/e2e/listen.cjs http://localhost:4173/ <出力dir>
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const [, , BASE = 'http://localhost:4173/', OUT = 'test-results'] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('bos:v1:tutorialSeen', 'true'); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  const fullReq = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { if (/\/audio\/full\//.test(r.url())) fullReq.push(r.url()); });
  const sheets = () => page.locator('[data-testid=listen-sheet]').count();
  const state = () => page.evaluate(() => [...document.querySelectorAll('audio')].length);
  // 再生中の <audio>（new Audio() は DOM に無いので play をフックして数える）
  await page.addInitScript(() => {
    window.__au = new Set();
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) { window.__au.add(this); return play.apply(this, a); };
    window.__playing = () => [...window.__au].filter((a) => !a.paused && a.src).length;
  });
  await page.goto(BASE);
  await page.waitForTimeout(1500);
  check('[試聴] 初期表示でフル音源を取得しない', fullReq.length === 0, fullReq.join(','));
  await page.getByText('このキャラで決定').click();
  await page.locator('.song-card').first().waitFor();
  await page.waitForTimeout(800);
  check('[試聴] 選曲画面を開いただけでは取得・再生しない', fullReq.length === 0 && (await sheets()) === 0);
  const btns = page.getByRole('button', { name: /をフルで聴く/ });
  check('[試聴] ゆずちゃん：共通曲・専用曲それぞれに「フルで聴く」', (await btns.count()) === 2, String(await btns.count()));

  // 再生
  await btns.first().click();
  await page.locator('[data-testid=listen-sheet]').waitFor();
  await page.waitForFunction(() => window.__playing() === 1, null, { timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, 'listen-open.png') });
  check('[試聴] ボタンを押すと再生される（1曲）', (await page.evaluate(() => window.__playing())) === 1);
  check('[試聴] 取得したのは押した曲のフル音源だけ', fullReq.length >= 1 && fullReq.every((u) => /full\/vote\.mp3/.test(u)), fullReq.join(','));
  await page.waitForTimeout(1500);
  const t1 = await page.getByLabel('再生時間').innerText();
  check('[試聴] 現在時間/総時間が進む（総時間は3:47）', /0:0[1-9] \/ 3:4[67]/.test(t1), t1);
  // 一時停止・再開
  await page.getByRole('button', { name: '一時停止' }).click();
  await page.waitForFunction(() => window.__playing() === 0);
  const tp = await page.getByLabel('再生時間').innerText();
  await page.waitForTimeout(800);
  check('[試聴] 一時停止で止まり、時間が進まない', tp === (await page.getByLabel('再生時間').innerText()), tp);
  await page.getByRole('button', { name: '再生' }).click();
  await page.waitForFunction(() => window.__playing() === 1);
  check('[試聴] 再開できる', true);
  // シーク
  await page.getByLabel('再生位置').evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '120'); el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
  });
  await page.waitForTimeout(600);
  const ts = await page.getByLabel('再生時間').innerText();
  check('[試聴] シークで再生位置が動く（2:00付近）', /^2:0\d/.test(ts), ts);
  // 別曲：前の曲は止まり、再生は1曲のみ
  await btns.nth(1).click();
  await page.waitForFunction(() => window.__playing() === 1, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  check('[試聴] 別曲を開くと前の曲は止まり同時再生は1曲だけ', (await page.evaluate(() => window.__playing())) === 1 && (await sheets()) === 1);
  check('[試聴] 別曲は先頭から（0:0x）', /^0:0\d/.test(await page.getByLabel('再生時間').innerText()), await page.getByLabel('再生時間').innerText());
  // 閉じる
  await page.getByRole('button', { name: '試聴を閉じる' }).click();
  await page.waitForFunction(() => window.__playing() === 0);
  check('[試聴] 閉じると停止してパネルが消える', (await sheets()) === 0);
  // 再度開くと位置は先頭
  await btns.first().click();
  await page.waitForFunction(() => window.__playing() === 1, null, { timeout: 15000 });
  check('[試聴] 開き直すと先頭から', /^0:0\d/.test(await page.getByLabel('再生時間').innerText()));
  // 画面移動で停止
  await page.getByRole('button', { name: '← キャラ' }).click();
  await page.waitForTimeout(300);
  check('[試聴] 画面移動（キャラ選択へ）で停止', (await page.evaluate(() => window.__playing())) === 0 && (await sheets()) === 0);
  // プロフィールの試聴入口
  await page.locator('.char-card', { hasText: '公園維持清掃車' }).getByRole('button', { name: 'プロフィール' }).click();
  await page.locator('.profile-card').waitFor();
  const pb = page.getByRole('button', { name: /君が笑うほうへ をフルで聴く/ });
  check('[試聴] プロフィールに専用曲の試聴入口（公園維持清掃車）', (await pb.count()) === 1);
  await page.screenshot({ path: path.join(OUT, 'listen-profile.png') });
  await pb.click();
  await page.waitForFunction(() => window.__playing() === 1, null, { timeout: 15000 });
  check('[試聴] プロフィールから専用曲を再生できる', /\/ 3:5\d/.test(await page.getByLabel('再生時間').innerText()), await page.getByLabel('再生時間').innerText());
  await page.getByRole('button', { name: '← 戻る' }).click();
  await page.waitForTimeout(300);
  check('[試聴] プロフィールを出ると停止', (await page.evaluate(() => window.__playing())) === 0);
  // ゆずちゃん：プロフィールにも専用曲
  await page.locator('.char-card', { hasText: 'ゆずちゃん' }).getByRole('button', { name: 'プロフィール' }).click();
  check('[試聴] プロフィールに専用曲の試聴入口（ゆずちゃん＝何度でも呼ぶよ）', (await page.getByRole('button', { name: /何度でも呼ぶよ をフルで聴く/ }).count()) === 1);
  check('[試聴] プロフィールに共通曲(Vote)の試聴入口もある・他キャラの専用曲は出ない', (await page.getByRole('button', { name: /Vote Vote Vote をフルで聴く/ }).count()) === 1 && (await page.getByRole('button', { name: /君が笑うほうへ をフルで聴く/ }).count()) === 0);
  await page.getByRole('button', { name: '← 戻る' }).click();

  // キッコー万太郎：専用曲のフル版は公開しない（試聴ボタンなし）。共通曲は聴ける
  await page.locator('.char-card', { hasText: 'キッコー万太郎' }).getByRole('button', { name: 'プロフィール' }).click();
  await page.locator('.profile-card').waitFor();
  check('[試聴] キッコー万太郎：専用曲のフル試聴ボタンは出さない・共通曲は出る', (await page.getByRole('button', { name: /灯りは消さずにおくよ をフルで聴く/ }).count()) === 0 && (await page.getByRole('button', { name: /Vote Vote Vote をフルで聴く/ }).count()) === 1);
  await page.getByRole('button', { name: '← 戻る' }).click();

  // ゲーム開始で停止（試聴中にスタート）
  await page.getByText('このキャラで決定').click();
  await page.locator('.song-card', { hasText: 'Vote Vote Vote' }).click();
  await page.getByRole('button', { name: 'スタート' }).waitFor({ timeout: 20000 });
  check('[試聴] 難易度画面には試聴ボタンを出さない（ゲーム前後で開かせない）', (await page.getByRole('button', { name: /フルで聴く/ }).count()) === 0);
  await page.getByRole('button', { name: '← 曲' }).click().catch(() => {});
  await page.locator('.song-card').first().waitFor();
  await page.getByRole('button', { name: /Vote Vote Vote をフルで聴く/ }).click();
  await page.waitForFunction(() => window.__playing() === 1, null, { timeout: 15000 });
  await page.locator('.song-card', { hasText: 'Vote Vote Vote' }).click();
  await page.waitForTimeout(300);
  check('[試聴] 曲を選んで進むと停止', (await page.evaluate(() => window.__playing())) === 0 && (await sheets()) === 0);
  await page.getByRole('button', { name: 'スタート' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'スタート' }).click();
  await page.waitForTimeout(1500);
  check('[試聴] ゲーム中は試聴の音が鳴らない', (await page.evaluate(() => window.__playing())) === 0 && (await sheets()) === 0);
  await ctx.close();

  // 失敗→再試行
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p2 = await c2.newPage();
  await p2.addInitScript(() => { window.__au = new Set(); const pl = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function (...a) { window.__au.add(this); return pl.apply(this, a); }; window.__playing = () => [...window.__au].filter((a) => !a.paused && a.src).length; });
  await p2.route('**/audio/full/vote.mp3*', (r) => r.fulfill({ status: 404, body: 'x' }));
  await p2.goto(BASE);
  await p2.getByText('このキャラで決定').click();
  await p2.getByRole('button', { name: /Vote Vote Vote をフルで聴く/ }).click();
  await p2.getByText('音源を読み込めませんでした').waitFor({ timeout: 10000 });
  await p2.screenshot({ path: path.join(OUT, 'listen-error.png') });
  check('[試聴] 読み込み失敗でエラー表示と「再試行」ボタン', await p2.getByRole('button', { name: '再試行' }).isVisible());
  await p2.unroute('**/audio/full/vote.mp3*');
  await p2.getByRole('button', { name: '再試行' }).click();
  await p2.waitForFunction(() => window.__playing() === 1, null, { timeout: 15000 });
  check('[試聴] 再試行で再生できる', true);
  // 画面が隠れたら一時停止（勝手に再開しない）
  await p2.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p2.waitForFunction(() => window.__playing() === 0);
  await p2.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await p2.waitForTimeout(700);
  check('[試聴] バックグラウンドで一時停止し、戻っても勝手に再開しない', (await p2.evaluate(() => window.__playing())) === 0);
  await c2.close();

  check('コンソール/ページエラーなし', errors.length === 0, errors.join('|').slice(0, 200));
  await browser.close();
  const bad = results.filter((x) => !x).length;
  console.log(`${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
})();
