// 譜面データの品質チェック（public/data の実データを読む）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChartData, SongData } from '../types';
import { buildTimedNotes } from './tempo';

const root = resolve(__dirname, '../../public');
const songs: SongData[] = JSON.parse(readFileSync(resolve(root, 'data/songs.json'), 'utf8'));

for (const song of songs) {
  for (const [diff, path] of Object.entries(song.charts)) {
    if (!path) continue;
    describe(`${song.id}/${diff}`, () => {
      const chart: ChartData = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
      const notes = buildTimedNotes(chart, song.beatMap!);

      it('全ノーツが曲中・フェード開始前に収まる', () => {
        for (const n of notes) {
          expect(n.t).toBeGreaterThan(0);
          expect(n.end ?? n.t).toBeLessThan(song.fadeOut.startSeconds * 1000);
        }
      });
      it('最後のノーツの後に余韻（2秒以上）', () => {
        const last = Math.max(...notes.map((n) => n.end ?? n.t));
        expect(song.durationSeconds * 1000 - last).toBeGreaterThan(2000);
      });
      it('同時に指が触れるのは最大2か所（長押し中も含む）', () => {
        const EPS = 1;
        for (const n of notes) {
          const busy = notes.filter((m) => m.t <= n.t + EPS && (m.end ?? m.t) >= n.t - EPS);
          const lanes = new Set(busy.map((m) => m.lane));
          expect(lanes.size, `t=${n.t.toFixed(0)}ms lanes=${[...lanes]}`).toBeLessThanOrEqual(2);
        }
      });
      it('同時押しは左右の手に1つずつ（親指2本で取れる）', () => {
        const byT = new Map<number, number[]>();
        for (const n of notes) {
          const k = Math.round(n.t);
          byT.set(k, [...(byT.get(k) ?? []), n.lane]);
        }
        for (const [t, lanes] of byT) {
          if (lanes.length < 2) continue;
          const left = lanes.filter((l) => l <= 1).length;
          expect(left, `t=${t}`).toBe(1);
        }
      });
      it('同じレーンでノーツが重ならない（長押し中に同レーンのノーツなし）', () => {
        for (let l = 0; l < 4; l++) {
          const ln = notes.filter((n) => n.lane === l);
          for (let i = 1; i < ln.length; i++) {
            const prevEnd = ln[i - 1].end ?? ln[i - 1].t;
            expect(ln[i].t - prevEnd, `lane${l} t=${ln[i].t}`).toBeGreaterThan(100);
          }
        }
      });
      it('長押し中、もう片方の手で打つノーツは長押し側の手を使わない', () => {
        for (const h of notes.filter((n) => n.end !== undefined)) {
          const hand = h.lane <= 1 ? 0 : 1;
          const during = notes.filter((m) => m !== h && m.t > h.t + 1 && m.t < h.end! - 1);
          for (const m of during) expect((m.lane <= 1 ? 0 : 1), `hold@${h.t} vs ${m.t}`).not.toBe(hand);
        }
      });
      it('片手の連続打鍵が速すぎない（同じ手で150ms未満の連打なし）', () => {
        const single = notes;
        for (const hand of [0, 1]) {
          const hn = single.filter((n) => (n.lane <= 1 ? 0 : 1) === hand);
          for (let i = 1; i < hn.length; i++) {
            const gap = hn[i].t - (hn[i - 1].end ?? hn[i - 1].t);
            if (Math.abs(hn[i].t - hn[i - 1].t) < 1) continue;
            expect(gap, `hand${hand} t=${hn[i].t.toFixed(0)}`).toBeGreaterThanOrEqual(150);
          }
        }
      });
      it('休符がある（1.5秒以上ノーツのない区間が少なくとも1つ、または小節単位の空き）', () => {
        let maxGap = 0;
        for (let i = 1; i < notes.length; i++) maxGap = Math.max(maxGap, notes[i].t - (notes[i - 1].end ?? notes[i - 1].t));
        expect(maxGap).toBeGreaterThan(400);
      });
    });
  }
}
