// 非公開テストページ用：単一HTMLから <!doctype>/<html>/<head>/<body> を外し、配信する素材をコピーする
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname } from 'node:path'
const out = 'dist-artifact'
let html = readFileSync(`${out}/index.html`, 'utf8')
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
const title = head.match(/<title>.*?<\/title>/)[0]
const styles = [...head.matchAll(/<style[\s\S]*?<\/style>/g)].map((m) => m[0]).join('\n')
const scripts = [...head.matchAll(/<script[\s\S]*?<\/script>/g)].map((m) => m[0]).join('\n')
const page = `${title}\n<meta name="claude:viewport-fit-sides" content="cover">\n<meta name="theme-color" content="#0f0420">\n${styles}\n${body.trim()}\n${scripts}\n`
writeFileSync(`${out}/page.html`, page)
const files = [
  'data/songs.json', 'data/characters.json', 'data/charts/vote.normal.json',
  'assets/audio/vote.mp3', 'assets/characters/char_0001/idle.png',
  'assets/brand/logo.png', 'assets/jackets/vote.png', 'assets/jackets/yobuyo.png',
]
for (const f of files) {
  mkdirSync(dirname(`${out}/${f}`), { recursive: true })
  copyFileSync(`public/${f}`, `${out}/${f}`)
}
console.log('page.html', page.length, 'bytes; files:', files.length)
