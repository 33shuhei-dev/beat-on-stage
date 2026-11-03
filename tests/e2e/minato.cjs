// みなと（応援者・専用曲「おすそわけしたいんです」92秒）の登録確認（390px・タッチ）。toamaru.cjs を元にした。
// 使い方: node tests/e2e/toamaru.cjs http://localhost:4173/ <出力dir>
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const [, , BASE = 'http://localhost:4173/', OUT = 'test-results'] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const res = [];
const check = (n, ok, i = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const mk = async () => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('bos:v1:tutorialSeen', 'true'); } catch {} });
    await ctx.addInitScript(() => { window.__au = new Set(); const pl = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function (...a) { window.__au.add(this); return pl.apply(this, a); }; window.__playing = () => [...window.__au].filter((a) => !a.paused && a.src).length; });
    return ctx;
  };
  const errs = [];
  // 1) 一般公開（devなし）では出ない
  let ctx = await mk(); let p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE); await p.locator('.char-card').first().waitFor();
  check('[みなと] 公開承認済み：一般公開（?dev=1なし）でも表示される', (await p.locator('.char-card', { hasText: 'みなと' }).count()) === 1);
  await ctx.close();
  // 2) dev で表示
  ctx = await mk(); p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e)));
  const bad = []; p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  await p.goto(BASE + '?dev=1'); await p.locator('.char-card', { hasText: 'みなと' }).waitFor();
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, 'minato-select.png') });
  const card = p.locator('.char-card', { hasText: 'みなと' });
  check('[みなと] ?dev=1 で表示・区分は「応援者」', /応援者/.test(await card.innerText()));
  await card.scrollIntoViewIfNeeded(); await p.waitForTimeout(500);
  const imgOk = await card.locator('img').first().evaluate((i) => i.complete && i.naturalWidth > 0);
  check('[みなと] キャラ画像が読めている', imgOk);
  // プロフィール
  await card.getByRole('button', { name: 'プロフィール' }).click();
  await p.locator('.profile-card').waitFor();
  const txt = await p.locator('.profile-card').innerText();
  const xl = p.locator('.profile-card a', { hasText: /^X を見る/ });
  check('[みなと] Xリンク（https://x.com/SKSGeRYJFI77013・別タブ・noopener）', (await xl.getAttribute('href')) === 'https://x.com/SKSGeRYJFI77013' && (await xl.getAttribute('target')) === '_blank' && /noopener/.test((await xl.getAttribute('rel')) || ''));
  check('[みなと] 未提供の所属・紹介文は出さない（紹介ページ欄なし・「準備中」表示）', (await p.locator('.profile-card a', { hasText: '紹介ページ' }).count()) === 0 && !/所属/.test(txt) && /準備中/.test(txt));
  check('[みなと] プロフィールに共通曲の「フルで聴く」はあり、専用曲は保管用のため試聴ボタンなし', (await p.getByRole('button', { name: /おすそわけしたいんです をフルで聴く/ }).count()) === 0 && (await p.getByRole('button', { name: /Vote Vote Vote をフルで聴く/ }).count()) === 1);
  await p.screenshot({ path: path.join(OUT, 'minato-profile.png') });
  await p.getByRole('button', { name: '← 戻る' }).click(); await p.waitForTimeout(300);
  // 曲選択
  await p.locator('.char-card', { hasText: 'みなと' }).locator('.char-main').click();
  await p.getByText('このキャラで決定').click(); await p.locator('.song-card').first().waitFor();
  await p.waitForTimeout(800);
  const titles = (await p.locator('.song-title').allInnerTexts()).map((t) => t.trim());
  check('[みなと] 曲は共通曲Voteと専用曲「おすそわけしたいんです」だけ', titles.length === 2 && titles.includes('Vote Vote Vote') && titles.includes('おすそわけしたいんです'), titles.join('|'));
  const sc = p.locator('.song-card', { hasText: 'おすそわけしたいんです' });
  const info = await sc.locator('.song-info').innerText();
  check('[みなと] 専用曲の表示：「みなと専用・92秒」・選べる', /みなと専用/.test(info) && /92秒/.test(info) && (await sc.isEnabled()), info);
  const jk = await sc.locator('.jacket img').evaluate((i) => ({ ok: i.complete && i.naturalWidth === 1254, w: i.naturalWidth })).catch(() => null);
  check('[みなと] 採用ジャケットが表示される（1254px画像）', !!jk && jk.ok, JSON.stringify(jk));
  await p.screenshot({ path: path.join(OUT, 'minato-songs.png') });
  check('[みなと] 共通曲Voteも選べる', await p.locator('.song-card', { hasText: 'Vote Vote Vote' }).isEnabled());
  // 難易度画面→ EASY/NORMAL/HARD 全部選べる
  await sc.click(); await p.getByRole('button', { name: 'スタート' }).waitFor({ timeout: 20000 });
  const ds = await p.locator('.diff').evaluateAll((els) => els.map((e) => e.disabled));
  check('[みなと] EASY/NORMAL/HARD がすべて選べる', ds.length === 3 && ds.every((x) => !x));
  // 他キャラからは見えない
  await p.getByRole('button', { name: /← / }).first().click().catch(() => {});
  await ctx.close();
  ctx = await mk(); p = await ctx.newPage();
  await p.goto(BASE + '?dev=1'); await p.locator('.char-card', { hasText: 'ゆずちゃん' }).locator('.char-main').click();
  await p.getByText('このキャラで決定').click(); await p.locator('.song-card').first().waitFor();
  const t2 = (await p.locator('.song-title').allInnerTexts()).map((t) => t.trim());
  check('[みなと] 他キャラ（ゆずちゃん）の曲一覧には出ない', !t2.includes('おすそわけしたいんです'), t2.join('|'));
  await ctx.close();
  check('[みなと] 画像・音源・データの読み込みエラー(4xx/5xx)なし', bad.length === 0, bad.join('|').slice(0, 200));
  check('[みなと] ページエラーなし', errs.length === 0, errs.join('|').slice(0, 200));
  await b.close();
  const nb = res.filter((x) => !x).length;
  console.log(`${res.length - nb}/${res.length} passed`);
  process.exit(nb ? 1 : 0);
})();
