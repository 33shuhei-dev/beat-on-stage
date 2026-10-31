// 結果画面の移動ボタン：もう一度／難易度を上げる／難易度選択／選曲へ／TOPへ（390px・タッチ・オートプレイで1曲通す）
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const [, , BASE = 'http://localhost:4173/', OUT = 'test-results'] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const res = [];
const check = (n, ok, i = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('bos:v1:tutorialSeen', 'true'); } catch {} });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const playToResult = async () => {
    await p.getByRole('button', { name: 'スタート' }).click();
    await p.locator('.result-card').waitFor({ timeout: 100000 });
    await p.waitForTimeout(400);
  };
  const toDiff = async () => {
    await p.locator('.song-card', { hasText: 'Vote Vote Vote' }).click();
    await p.getByRole('button', { name: 'スタート' }).waitFor({ timeout: 20000 });
    await p.waitForFunction(() => !document.querySelector('button.big')?.disabled, null, { timeout: 20000 });
  };
  await p.goto(BASE + '?dev=1');
  await p.getByText('このキャラで決定').click();
  await toDiff();
  await p.locator('.row.dev input').check();
  await playToResult();
  await p.screenshot({ path: path.join(OUT, 'result-nav-easy.png') });
  const has = async (n) => (await p.getByRole('button', { name: n }).count()) === 1;
  check('[結果] もう一度・難易度を上げる・難易度選択・選曲へ・TOPへ が出る', (await has('もう一度')) && (await has(/難易度を上げる（NORMAL）/)) && (await has('難易度選択')) && (await has('選曲へ')) && (await has('TOPへ')));
  const w = await p.evaluate(() => document.documentElement.scrollWidth);
  check('[結果] 横スクロールなし(390px)', w <= 390, String(w));
  // 難易度を上げる → NORMAL が選ばれた難易度画面
  await p.getByRole('button', { name: /難易度を上げる/ }).click();
  await p.getByRole('button', { name: 'スタート' }).waitFor();
  check('[結果→難易度を上げる] NORMAL が選択された難易度画面へ', /selected/.test((await p.locator('.diff.normal').getAttribute('class')) || ''));
  await p.waitForFunction(() => !document.querySelector('button.big')?.disabled, null, { timeout: 20000 });
  await p.getByRole('button', { name: 'スタート' }).click();
  await p.waitForFunction(() => window.__bos && window.__bos.state === 'countdown', null, { timeout: 10000 });
  const cnt = await p.evaluate(() => window.__bos.judge.states.length);
  check('[結果→難易度を上げる] そのままNORMALの譜面（210ノーツ）で開始できる', cnt === 210, String(cnt));
  await p.getByRole('button', { name: /やめる|中断|選曲|終了/ }).first().click().catch(() => {});
  await ctx.close();

  // 他の3ボタン：別コンテキスト3つで並行して結果画面まで通し、それぞれ1つずつ押す
  const viaResult = async (label, btn, verify) => {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await c.addInitScript(() => { try { localStorage.setItem('bos:v1:tutorialSeen', 'true'); } catch {} });
    const q = await c.newPage();
    q.on('pageerror', (e) => errs.push(String(e)));
    await q.goto(BASE + '?dev=1');
    await q.getByText('このキャラで決定').click();
    await q.locator('.song-card', { hasText: 'Vote Vote Vote' }).click();
    await q.getByRole('button', { name: 'スタート' }).waitFor({ timeout: 20000 });
    await q.waitForFunction(() => !document.querySelector('button.big')?.disabled, null, { timeout: 20000 });
    await q.locator('.row.dev input').check();
    await q.getByRole('button', { name: 'スタート' }).click();
    await q.locator('.result-card').waitFor({ timeout: 100000 });
    await q.getByRole('button', { name: btn }).click();
    await q.waitForTimeout(500);
    check(label, await verify(q));
    await c.close();
  };
  await Promise.all([
    viaResult('[結果→難易度選択] 難易度画面へ（EASYのまま）', '難易度選択', async (q) => (await q.getByRole('button', { name: 'スタート' }).isVisible()) && /selected/.test((await q.locator('.diff.easy').getAttribute('class')) || '')),
    viaResult('[結果→選曲へ] 選曲画面へ', '選曲へ', async (q) => (await q.getByText('曲をえらぶ').isVisible()) && (await q.locator('.song-card').count()) >= 1),
    (async () => {
      const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      await c.addInitScript(() => { try { localStorage.setItem('bos:v1:tutorialSeen', 'true'); } catch {} });
      const q = await c.newPage();
      q.on('pageerror', (e) => errs.push(String(e)));
      await q.goto(BASE + '?dev=1');
      await q.getByText('このキャラで決定').click();
      await q.locator('.song-card', { hasText: 'Vote Vote Vote' }).click();
      await q.getByRole('button', { name: 'スタート' }).waitFor({ timeout: 20000 });
      await q.waitForFunction(() => !document.querySelector('button.big')?.disabled, null, { timeout: 20000 });
      await q.locator('.row.dev input').check();
      await q.getByRole('button', { name: 'スタート' }).click();
      await q.locator('.result-card').waitFor({ timeout: 100000 });
      const a = q.locator('a.profile-promo');
      const href = await a.getAttribute('href'); const tg = await a.getAttribute('target');
      await q.screenshot({ path: path.join(OUT, 'result-promo.png') });
      check('[結果→プロフィール] 外部の紹介ページ(ゆず係)を別タブで開くリンク', href === 'https://yuzu-gakari.vercel.app' && tg === '_blank', `${href} ${tg}`);
      await c.close();
    })(),
    viaResult('[結果→TOPへ] キャラ選択（TOP）へ', 'TOPへ', async (q) => (await q.getByText('キャラをえらぶ').isVisible()) && (await q.getByText('このキャラで決定').isVisible())),
  ]);
  check('コンソールエラーなし', errs.length === 0, errs.join('|').slice(0, 200));
  await b.close();
  const bad = res.filter((x) => !x).length;
  console.log(`${res.length - bad}/${res.length} passed`);
  process.exit(bad ? 1 : 0);
})();
