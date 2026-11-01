// JUN（応援者・専用曲「その色があるだけで」93秒）の登録確認（390px・タッチ）。toamaru.cjs を元にした。
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
  check('[JUN] 公開承認済み：一般公開（?dev=1なし）でも表示される', (await p.locator('.char-card', { hasText: 'JUN' }).count()) === 1);
  await ctx.close();
  // 2) dev で表示
  ctx = await mk(); p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e)));
  const bad = []; p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  await p.goto(BASE + '?dev=1'); await p.locator('.char-card', { hasText: 'JUN' }).waitFor();
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, 'jun-select.png') });
  const card = p.locator('.char-card', { hasText: 'JUN' });
  check('[JUN] ?dev=1 で表示・区分は「応援者」', /応援者/.test(await card.innerText()));
  const imgOk = await card.locator('img').first().evaluate((i) => i.complete && i.naturalWidth > 0);
  check('[JUN] キャラ画像が読めている', imgOk);
  // プロフィール
  await card.getByRole('button', { name: 'プロフィール' }).click();
  await p.locator('.profile-card').waitFor();
  const txt = await p.locator('.profile-card').innerText();
  const xl = p.locator('.profile-card a', { hasText: /^X を見る/ });
  check('[JUN] Xリンク（https://x.com/MATHU030417・別タブ・noopener）', (await xl.getAttribute('href')) === 'https://x.com/MATHU030417' && (await xl.getAttribute('target')) === '_blank' && /noopener/.test((await xl.getAttribute('rel')) || ''));
  check('[JUN] 未提供の紹介ページ・所属・紹介文は出さない（紹介ページ/所属なし・「準備中」表示）', (await p.locator('.profile-card a', { hasText: '紹介ページ' }).count()) === 0 && !/所属/.test(txt) && /準備中/.test(txt));
  check('[JUN] プロフィールに専用曲・共通曲の「フルで聴く」', (await p.getByRole('button', { name: /その色があるだけで をフルで聴く/ }).count()) === 1 && (await p.getByRole('button', { name: /Vote Vote Vote をフルで聴く/ }).count()) === 1);
  await p.screenshot({ path: path.join(OUT, 'jun-profile.png') });
  await p.getByRole('button', { name: '← 戻る' }).click(); await p.waitForTimeout(300);
  // 曲選択
  await p.locator('.char-card', { hasText: 'JUN' }).locator('.char-main').click();
  await p.getByText('このキャラで決定').click(); await p.locator('.song-card').first().waitFor();
  await p.waitForTimeout(800);
  const titles = (await p.locator('.song-title').allInnerTexts()).map((t) => t.trim());
  check('[JUN] 曲は共通曲Voteと専用曲「その色があるだけで」だけ', titles.length === 2 && titles.includes('Vote Vote Vote') && titles.includes('その色があるだけで'), titles.join('|'));
  const sc = p.locator('.song-card', { hasText: 'その色があるだけで' });
  const info = await sc.locator('.song-info').innerText();
  check('[JUN] 専用曲の表示：「JUN専用・93秒」・選べる', /JUN専用/.test(info) && /93秒/.test(info) && (await sc.isEnabled()), info);
  const jk = await sc.locator('.jacket img').evaluate((i) => ({ ok: i.complete && i.naturalWidth === 1254, w: i.naturalWidth })).catch(() => null);
  // ジャケット（jun.png）は納品ZIPの欠損で未受領のため、届くまでは文字の仮ジャケットで表示される。届いたら下を有効にする
  // check('[JUN] 採用ジャケットが表示される（1254px画像）', !!jk && jk.ok, JSON.stringify(jk));
  await p.screenshot({ path: path.join(OUT, 'jun-songs.png') });
  check('[JUN] 共通曲Voteも選べる', await p.locator('.song-card', { hasText: 'Vote Vote Vote' }).isEnabled());
  // 難易度画面→ EASY/NORMAL/HARD 全部選べる
  await sc.click(); await p.getByRole('button', { name: 'スタート' }).waitFor({ timeout: 20000 });
  const ds = await p.locator('.diff').evaluateAll((els) => els.map((e) => e.disabled));
  check('[JUN] EASY/NORMAL/HARD がすべて選べる', ds.length === 3 && ds.every((x) => !x));
  // 他キャラからは見えない
  await p.getByRole('button', { name: /← / }).first().click().catch(() => {});
  await ctx.close();
  ctx = await mk(); p = await ctx.newPage();
  await p.goto(BASE + '?dev=1'); await p.locator('.char-card', { hasText: 'ゆずちゃん' }).locator('.char-main').click();
  await p.getByText('このキャラで決定').click(); await p.locator('.song-card').first().waitFor();
  const t2 = (await p.locator('.song-title').allInnerTexts()).map((t) => t.trim());
  check('[JUN] 他キャラ（ゆずちゃん）の曲一覧には出ない', !t2.includes('その色があるだけで'), t2.join('|'));
  await ctx.close();
  check('[JUN] 画像・音源・データの読み込みエラー(4xx/5xx)なし（未受領のジャケットを除く）', bad.filter((x) => !/jackets\/sono_iro/.test(x)).length === 0, bad.join('|').slice(0, 200));
  check('[JUN] ページエラーなし', errs.length === 0, errs.join('|').slice(0, 200));
  await b.close();
  const nb = res.filter((x) => !x).length;
  console.log(`${res.length - nb}/${res.length} passed`);
  process.exit(nb ? 1 : 0);
})();
