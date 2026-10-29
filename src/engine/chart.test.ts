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

// 難易度ごとの設計条件（EASYは単純・HARDは密だが片手に無理をさせない・段差がある）
for (const song of songs) {
  describe(`${song.id} 難易度設計`, () => {
    const load = (d: 'easy' | 'normal' | 'hard') => {
      const chart: ChartData = JSON.parse(readFileSync(resolve(root, song.charts[d]!), 'utf8'));
      return { chart, notes: buildTimedNotes(chart, song.beatMap!) };
    };
    const E = load('easy');
    const N = load('normal');
    const H = load('hard');
    const perSec = (notes: { t: number }[]) => notes.length / ((notes[notes.length - 1].t - notes[0].t) / 1000);
    const handGaps = (notes: ReturnType<typeof buildTimedNotes>, hand: 0 | 1) => {
      const hn = notes.filter((n) => (n.lane <= 1 ? 0 : 1) === hand);
      const out: number[] = [];
      for (let i = 1; i < hn.length; i++) if (Math.abs(hn[i].t - hn[i - 1].t) > 1) out.push(hn[i].t - (hn[i - 1].end ?? hn[i - 1].t));
      return out;
    };

    it('譜面データが曲・難易度・版と一致する', () => {
      for (const [d, c] of [['easy', E], ['normal', N], ['hard', H]] as const) {
        expect(c.chart.songId).toBe(song.id);
        expect(c.chart.difficulty).toBe(d);
        expect(c.chart.chartVersion).toBeTruthy();
      }
    });
    it('ノーツ数と密度が EASY < NORMAL < HARD', () => {
      expect(E.notes.length).toBeLessThan(N.notes.length);
      expect(N.notes.length).toBeLessThan(H.notes.length);
      expect(perSec(E.notes)).toBeLessThan(2.2);
      expect(perSec(H.notes)).toBeGreaterThan(perSec(N.notes) * 1.3);
    });
    it('EASY：同時押しなし・長押し中に他のノーツなし・ノーツ間は0.3秒以上', () => {
      const byT = new Map<number, number>();
      for (const n of E.notes) byT.set(Math.round(n.t), (byT.get(Math.round(n.t)) ?? 0) + 1);
      expect([...byT.values()].every((c) => c === 1)).toBe(true);
      for (const h of E.notes.filter((n) => n.end !== undefined)) {
        expect(E.notes.some((m) => m !== h && m.t > h.t + 1 && m.t < h.end! + 250), `hold@${h.t.toFixed(0)}`).toBe(false);
      }
      for (let i = 1; i < E.notes.length; i++) expect(E.notes[i].t - (E.notes[i - 1].end ?? E.notes[i - 1].t)).toBeGreaterThan(300);
    });
    it('HARD：片手の連打は短い・長い連続は左右交互（同じ手 0.17秒未満なし、0.25秒未満の連続は3回まで）', () => {
      for (const hand of [0, 1] as const) {
        const g = handGaps(H.notes, hand);
        expect(Math.min(...g)).toBeGreaterThanOrEqual(170);
        let run = 0;
        for (const x of g) {
          run = x < 250 ? run + 1 : 0;
          expect(run).toBeLessThanOrEqual(3);
        }
      }
    });
    it('HARD：1秒間のノーツ数が多すぎない（9以下）・同時押しは全体の1割未満', () => {
      const ts = H.notes.map((n) => n.t);
      const max1s = Math.max(...ts.map((t) => ts.filter((u) => u >= t && u < t + 1000).length));
      expect(max1s).toBeLessThanOrEqual(9);
      const chords = H.notes.length - new Set(ts.map((t) => Math.round(t))).size;
      expect(chords / H.notes.length).toBeLessThan(0.1);
    });
    it('4レーンを偏りなく使う（各レーン15%以上）', () => {
      for (const c of [E, N, H]) for (let l = 0; l < 4; l++) expect(c.notes.filter((n) => n.lane === l).length / c.notes.length).toBeGreaterThan(0.15);
    });
  });
}
