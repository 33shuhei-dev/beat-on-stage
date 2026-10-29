import { loadAudioData } from './data';
import { AudioEngine } from './engine/audio';

let engine: AudioEngine | null = null;
const raw = new Map<string, Promise<ArrayBuffer>>();
const decoded = new Map<string, Promise<AudioBuffer>>();

/** 最初のユーザー操作で生成する（自動再生制限のため） */
export function getAudio(): AudioEngine {
  if (!engine) engine = new AudioEngine();
  return engine;
}
export const hasAudio = () => engine !== null;

/** 音源ファイルの先読み（AudioContext 不要） */
export function prefetch(path: string): Promise<ArrayBuffer> {
  let p = raw.get(path);
  if (!p) {
    p = loadAudioData(path);
    p.catch(() => raw.delete(path));
    raw.set(path, p);
  }
  return p;
}

export function getBuffer(path: string): Promise<AudioBuffer> {
  let p = decoded.get(path);
  if (!p) {
    p = prefetch(path).then((ab) => getAudio().decode(ab.slice(0)));
    p.catch(() => decoded.delete(path));
    decoded.set(path, p);
  }
  return p;
}
