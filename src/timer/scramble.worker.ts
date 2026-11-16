import { randomStateScramble, type ScrambleType } from './solver';

self.onmessage = (e: MessageEvent<{ id: number; type: ScrambleType }>) => {
  const { id, type } = e.data;
  (self as unknown as Worker).postMessage({ id, scramble: randomStateScramble(type) });
};
