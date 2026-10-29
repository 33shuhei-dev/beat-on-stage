import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base: './' で、どのURL配下に置いても動く相対パスにする（公開先は未確定）
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true },
})
