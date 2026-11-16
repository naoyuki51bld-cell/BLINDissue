// スクランブルの作成（エッジのみ・コーナーのみはランダムな状態から解法で作るので、バックグラウンドで）
import { randomScramble } from './scramble';
import { randomStateScramble, type ScrambleType } from './solver';

export type { ScrambleType };
export const SCRAMBLE_TYPES: { id: ScrambleType; label: string }[] = [
  { id: 'normal', label: '通常' },
  { id: 'edges', label: 'エッジのみ' },
  { id: 'corners', label: 'コーナーのみ' },
];

let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, (s: string) => void>();
/** 次の分を先に作っておく */
const ready: Partial<Record<ScrambleType, Promise<string>>> = {};

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./scramble.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; scramble: string }>) => {
      pending.get(e.data.id)?.(e.data.scramble);
      pending.delete(e.data.id);
    };
  } catch {
    worker = null;
  }
  return worker;
}

function generate(type: ScrambleType): Promise<string> {
  const w = getWorker();
  if (!w) return new Promise((resolve) => setTimeout(() => resolve(randomStateScramble(type)), 0));
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    w.postMessage({ id, type });
  });
}

/** すぐ使えるスクランブル（通常は即座、それ以外は作り終わったら） */
export function makeScramble(type: ScrambleType): Promise<string> {
  if (type === 'normal') return Promise.resolve(randomScramble());
  const p = ready[type] ?? generate(type);
  ready[type] = p.then(() => generate(type));
  return p;
}
