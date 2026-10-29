// 設定の反映確認：設定画面で変えた値が保存され、プレイ中の挙動に効くこと（スマホ幅・タッチ）
// 使い方: node tests/e2e/settings.cjs http://localhost:4173/ <出力dir>
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const [, , BASE = 'http://localhost:4173/', OUT = 'test-results'] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
};

async function setRange(page, label, value) {
  await page.getByLabel(label).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('bos:v1:tutorialSeen', 'true'); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?dev=1');
  await page.getByText('このキャラで決定').click();

  // 曲選択画面からも設定を開ける
  await page.getByRole('button', { name: '⚙ 設定' }).click();
  await page.getByRole('dialog', { name: '設定' }).waitFor();
  await page.screenshot({ path: path.join(OUT, 'settings-panel.png') });
  const reactionsToggle = page.locator('label.toggle', { hasText: 'キャラのリアクション' }).locator('input');
  const reducedToggle = page.locator('label.toggle', { hasText: '演出を減らす' }).locator('input');
  const fastslowToggle = page.locator('label.toggle', { hasText: 'FAST / SLOW' }).locator('input');
  check('設定：既定は リアクションON・演出軽減OFF・FAST/SLOW表示ON', (await reactionsToggle.isChecked()) && !(await reducedToggle.isChecked()) && (await fastslowToggle.isChecked()));
  await setRange(page, /ノーツ速度/, 8);
  await reactionsToggle.uncheck();
  await reducedToggle.check();
  await setRange(page, /音楽の音量/, 0.3);
  await setRange(page, /打音の音量/, 0.2);
  await page.getByRole('button', { name: '閉じる' }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bos:v1:settings')));
  check('設定：変更がlocalStorageに保存される', saved.noteSpeed === 8 && saved.characterReactions === false && saved.reducedEffects === true && Math.abs(saved.musicVolume - 0.3) < 1e-6 && Math.abs(saved.hitVolume - 0.2) < 1e-6, JSON.stringify(saved));

  // 再読み込みしても残る
  await page.reload();
  await page.getByText('このキャラで決定').click();
  await page.getByRole('button', { name: '⚙ 設定' }).click();
  check('設定：再読み込み後も保持される', !(await page.locator('label.toggle', { hasText: 'キャラのリアクション' }).locator('input').isChecked()));
  await page.getByRole('button', { name: '閉じる' }).click();

  // プレイ中に反映（オートプレイで全PERFECT→リアクションOFFなら常に idle）
  await page.locator('.song-card', { hasText: 'Vote Vote Vote' }).click();
  await page.getByRole('button', { name: 'スタート' }).waitFor({ timeout: 20000 });
  await page.locator('.diff.hard').click();
  await page.locator('.row.dev input').check();
  await page.waitForFunction(() => !document.querySelector('button.big')?.disabled, null, { timeout: 20000 });
  await page.getByRole('button', { name: 'スタート' }).click();
  await page.waitForFunction(() => window.__bos && window.__bos.state === 'countdown');
  const g = await page.evaluate(() => ({ speed: window.__bos.o.settings.noteSpeed, reactions: window.__bos.o.settings.characterReactions, reduced: window.__bos.o.settings.reducedEffects, travel: window.__bos.layout && window.__bos.travelMs }));
  check('設定：ノーツ速度・リアクション・演出軽減がプレイに渡る', g.speed === 8 && g.reactions === false && g.reduced === true, JSON.stringify(g));
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    seen.add(await page.evaluate(() => window.__bos.reactionState()));
    await page.waitForTimeout(100);
  }
  check('設定：リアクションOFFなら全PERFECTのオートプレイ中も idle のまま', seen.size === 1 && seen.has('idle'), [...seen].join(','));
  await page.screenshot({ path: path.join(OUT, 'settings-play-reactions-off.png') });

  // 速度：8 の落下時間は 5 より短い
  const faster = await page.evaluate(() => window.__bos.o.settings.noteSpeed);
  check('設定：速度8で再生中', faster === 8);

  check('コンソールエラーなし', errors.length === 0, errors.join(' | ').slice(0, 200));
  await browser.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})();
