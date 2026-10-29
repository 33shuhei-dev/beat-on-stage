// MP3 をブラウザ(Chromium)でデコードしたときの時間ずれを、解析に使った WAV と相互相関で比較する
const { chromium } = require('playwright');
const fs = require('fs');
const [,, base, wavPath] = process.argv;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.route('**/__master.wav', (r) => r.fulfill({ body: fs.readFileSync(wavPath), contentType: 'audio/wav' }));
  await p.goto(base);
  const res = await p.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    const get = async (u) => ctx.decodeAudioData(await (await fetch(u)).arrayBuffer());
    const mp3 = await get('./assets/audio/vote.mp3');
    const wav = await get('./__master.wav');
    const a = mp3.getChannelData(0), w = wav.getChannelData(0);
    // 10〜12秒区間で ±100ms の相互相関
    const s0 = 10 * 44100, n = 2 * 44100; let best = [-1e9, 0];
    for (let lag = -4410; lag <= 4410; lag++) {
      let acc = 0; for (let i = 0; i < n; i += 2) acc += a[s0 + i + lag] * w[s0 + i];
      if (acc > best[0]) best = [acc, lag];
    }
    return { mp3Dur: mp3.duration, wavDur: wav.duration, sr: mp3.sampleRate, lagSamples: best[1], lagMs: best[1] / 44.1 };
  });
  console.log(JSON.stringify(res));
  await b.close();
})();
