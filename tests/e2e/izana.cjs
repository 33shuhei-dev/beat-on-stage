// 誘 リョウ（出場者・専用曲「風まで連れて」101秒）の登録確認（390px・タッチ）。rizu.cjs を元にした。
// 使い方: node tests/e2e/izana.cjs http://localhost:4173/ <出力dir>
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
  check('[誘 リョウ] 公開承認済み：一般公開（?dev=1なし）でも表示される', (await p.locator('.char-card', { hasText: '誘 リョウ' }).count()) === 1);
  await ctx.close();
  // 2) dev で表示
  ctx = await mk(); p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e)));
  const bad = []; p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  await p.goto(BASE + '?dev=1'); await p.locator('.char-card', { hasText: '誘 リョウ' }).waitFor();
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, 'izana-select.png') });
  const card = p.locator('.char-card', { hasText: '誘 リョウ' });
  check('[誘 リョウ] ?dev=1 で表示・区分は「出場者」', /出場者/.test(await card.innerText()));
  await card.scrollIntoViewIfNeeded(); await p.waitForTimeout(500);
  const imgOk = await card.locator('img').first().evaluate((i) => i.complete && i.naturalWidth > 0);
  check('[誘 リョウ] キャラ画像が読めている', imgOk);
  // 10状態すべて読める・全て1024×1024
  const st = await p.evaluate(async () => {
    const cs = await (await fetch('data/characters.json')).json();
    const c = cs.find((x) => x.id === 'izana_ryo');
    const out = {};
    await Promise.all(Object.entries(c.reactions.states).map(([k, u]) => new Promise((ok) => { const i = new Image(); i.onload = () => { out[k] = [i.naturalWidth, i.naturalHeight]; ok(); }; i.onerror = () => { out[k] = null; ok(); }; i.src = u; })));
    return { out, canvas: c.reactions.canvas, anchor: c.reactions.anchor, keys: Object.keys(c.reactions.states) };
  });
  check('[誘 リョウ] 10状態（idle/select/ready/hit/perfect/combo/miss/cheer/clear/best）がすべて読めて1024×1024', st.keys.length === 10 && Object.values(st.out).every((v) => v && v[0] === 1024 && v[1] === 1024), JSON.stringify(st.out));
  check('[誘 リョウ] キャンバス1024・足元anchor=968/1024', st.canvas.width === 1024 && st.canvas.height === 1024 && Math.abs(st.anchor[1] - 968 / 1024) < 1e-6 && st.anchor[0] === 0.5);
  // プロフィール
  await card.getByRole('button', { name: 'プロフィール' }).click();
  await p.locator('.profile-card').waitFor();
  const txt = await p.locator('.profile-card').innerText();
  const link = p.locator('.profile-card a', { hasText: '紹介ページ' });
  check('[誘 リョウ] 紹介ページのリンク（https://www.cityheaven.net/hyogo/A2801/A280102/kobe_gold/girlid-64202997/・別タブ・noopener）', (await link.getAttribute('href')) === 'https://www.cityheaven.net/hyogo/A2801/A280102/kobe_gold/girlid-64202997/' && (await link.getAttribute('target')) === '_blank' && /noopener/.test((await link.getAttribute('rel')) || ''));
  check('[誘 リョウ] 未提供のX・所属・紹介文は出さない（Xボタンなし・「準備中」表示）', (await p.locator('.profile-card a', { hasText: /^X を見る/ }).count()) === 0 && !/所属/.test(txt) && /準備中/.test(txt));
  check('[誘 リョウ] プロフィールに共通曲の「フルで聴く」はあり、専用曲は保管用のため試聴ボタンなし', (await p.getByRole('button', { name: /風まで連れて をフルで聴く/ }).count()) === 0 && (await p.getByRole('button', { name: /Vote Vote Vote をフルで聴く/ }).count()) === 1);
  await p.screenshot({ path: path.join(OUT, 'izana-profile.png') });
  await p.getByRole('button', { name: '← 戻る' }).click(); await p.waitForTimeout(300);
  // 曲選択
  await p.locator('.char-card', { hasText: '誘 リョウ' }).locator('.char-main').click();
  await p.getByText('このキャラで決定').click(); await p.locator('.song-card').first().waitFor();
  await p.waitForTimeout(800);
  const titles = (await p.locator('.song-title').allInnerTexts()).map((t) => t.trim());
  check('[誘 リョウ] 曲は共通曲Voteと専用曲「風まで連れて」だけ', titles.length === 2 && titles.includes('Vote Vote Vote') && titles.includes('風まで連れて'), titles.join('|'));
  const sc = p.locator('.song-card', { hasText: '風まで連れて' });
  const info = await sc.locator('.song-info').innerText();
  check('[誘 リョウ] 専用曲の表示：「誘 リョウ専用・101秒」・選べる', /誘 リョウ専用/.test(info) && /101秒/.test(info) && (await sc.isEnabled()), info);
  const jk = await sc.locator('.jacket img').evaluate((i) => ({ ok: i.complete && i.naturalWidth === 1254, w: i.naturalWidth })).catch(() => null);
  check('[誘 リョウ] 採用ジャケットが表示される（1254px画像）', !!jk && jk.ok, JSON.stringify(jk));
  await p.screenshot({ path: path.join(OUT, 'izana-songs.png') });
  check('[誘 リョウ] 共通曲Voteも選べる', await p.locator('.song-card', { hasText: 'Vote Vote Vote' }).isEnabled());
  // 難易度画面→ EASY/NORMAL/HARD 全部選べる
  await sc.click(); await p.getByRole('button', { name: 'スタート' }).waitFor({ timeout: 20000 });
  const ds = await p.locator('.diff').evaluateAll((els) => els.map((e) => e.disabled));
  check('[誘 リョウ] EASY/NORMAL/HARD がすべて選べる', ds.length === 3 && ds.every((x) => !x));
  // 他キャラからは見えない
  await p.getByRole('button', { name: /← / }).first().click().catch(() => {});
  await ctx.close();
  ctx = await mk(); p = await ctx.newPage();
  await p.goto(BASE + '?dev=1'); await p.locator('.char-card', { hasText: 'ゆずちゃん' }).locator('.char-main').click();
  await p.getByText('このキャラで決定').click(); await p.locator('.song-card').first().waitFor();
  const t2 = (await p.locator('.song-title').allInnerTexts()).map((t) => t.trim());
  check('[誘 リョウ] 他キャラ（ゆずちゃん）の曲一覧には出ない', !t2.includes('風まで連れて'), t2.join('|'));
  await ctx.close();
  check('[誘 リョウ] 画像・音源・データの読み込みエラー(4xx/5xx)なし', bad.length === 0, bad.join('|').slice(0, 200));
  check('[誘 リョウ] ページエラーなし', errs.length === 0, errs.join('|').slice(0, 200));
  await b.close();
  const nb = res.filter((x) => !x).length;
  console.log(`${res.length - nb}/${res.length} passed`);
  process.exit(nb ? 1 : 0);
})();
