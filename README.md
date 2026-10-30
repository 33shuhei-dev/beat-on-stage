# BEAT ON STAGE（v0.7.0）

ミスヘブン総選挙 非公式応援リズムゲーム。スマホ縦持ち4レーン（PCは D/F/J/K）。React + TypeScript + Vite、ビルド結果は静的ファイルのみ。

```bash
npm install
npm run dev   # 開発サーバ
npm test      # ユニットテスト
npm run build # dist/ に静的ファイル
```

現状・未確認事項・次の作業は [HANDOFF.md](./HANDOFF.md)、企画資料は `docs/`。

公開URL：https://33shuhei-dev.github.io/beat-on-stage/ （GitHub Pages・`gh-pages` ブランチ / root）
リポジトリ：https://github.com/33shuhei-dev/beat-on-stage
更新手順：`main` を更新 → `scripts/deploy-pages.sh origin`（ビルドして `gh-pages` へ push）。`vercel.json` もあり、Vercel に Import しても同じ `dist/` を配信できる。
