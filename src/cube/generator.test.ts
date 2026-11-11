import { describe, expect, it } from 'vitest';
import { generateSuggestions } from './generator';
import { casesFor, type PieceType } from './pieces';
import { verifyAlg } from './verify';

const CASES: [PieceType, number, string][] = [
  ['corner', 3, 'U2'],
  ['edge', 3, 'U2'],
  ['wing', 4, 'U2'],
  ['xcenter', 4, 'U0'],
  ['tcenter', 5, 'U0'],
];

describe('suggestion generator', () => {
  for (const [pt, n, buf] of CASES) {
    it(`${pt}: suggestions are correct and cover most cases`, () => {
      const t0 = performance.now();
      const table = generateSuggestions(pt, n, buf);
      const ms = performance.now() - t0;
      const cases = casesFor(pt, buf);
      let covered = 0;
      for (const [a, b] of cases) {
        const list = table.get(`${a}|${b}`);
        if (!list?.length) continue;
        covered++;
        for (const s of list.slice(0, 2)) expect(verifyAlg(pt, n, s.alg, buf, a, b).kind, `${a}${b} ${s.alg}`).toBe('ok');
      }
      console.log(`GEN ${pt}: ${covered}/${cases.length} cases, ${Math.round(ms)}ms, e.g. ${table.get(`${cases[0][0]}|${cases[0][1]}`)?.[0]?.alg}`);
      expect(covered / cases.length).toBeGreaterThan(0.8);
    }, 60000);
  }
});
