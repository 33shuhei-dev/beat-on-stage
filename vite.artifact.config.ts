import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 非公開テストページ（claude.ai Artifact）用ビルド。JS/CSSは1つのHTMLに内包し、
// 音源・画像・JSONは同じ階層の別ファイルとして配信する（publicDirは使わず scripts/build-artifact.mjs でコピー）
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  publicDir: false,
  build: { outDir: 'dist-artifact', emptyOutDir: true },
})
