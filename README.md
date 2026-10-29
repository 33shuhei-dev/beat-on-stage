# BEAT ON STAGE（v0.4.0）

ミスヘブン総選挙 非公式応援リズムゲーム。スマホ縦持ち4レーン（PCは D/F/J/K）。React + TypeScript + Vite、ビルド結果は静的ファイルのみ。

```bash
npm install
npm run dev   # 開発サーバ
npm test      # ユニットテスト
npm run build # dist/ に静的ファイル
```

現状・未確認事項・次の作業は [HANDOFF.md](./HANDOFF.md)、企画資料は `docs/`。

公開：`npm run build` の `dist/` を静的ホスティングに置くだけ（`vercel.json` / `scripts/deploy-pages.sh` あり）。
