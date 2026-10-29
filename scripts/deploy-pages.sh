#!/usr/bin/env bash
# 本番ビルドを gh-pages ブランチへ push する（GitHub Pages: Settings → Pages → Deploy from a branch → gh-pages / root）
# 使い方: scripts/deploy-pages.sh <リモート名 既定origin>
set -euo pipefail
REMOTE="${1:-origin}"
cd "$(dirname "$0")/.."
npm run build
rm -rf .deploy && mkdir .deploy
cp -r dist/. .deploy/
touch .deploy/.nojekyll
cd .deploy
git init -q -b gh-pages
git add -A
git -c user.name="beat-on-stage" -c user.email="noreply@example.invalid" commit -q -m "deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git remote add origin "$(git -C .. remote get-url "$REMOTE")"
git push -f origin gh-pages
cd .. && rm -rf .deploy
