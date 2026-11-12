import { describe, expect, it } from 'vitest';
import { stickerName } from '../cube/pieces';
import { verifyAlg } from '../cube/verify';
import data from './elliott.json';
import { elliottBuffers, elliottTable, idFromName, type ElliottData } from './elliott';

const d = data as unknown as ElliottData;

describe("Elliott's sheet", () => {
  it('maps position names', () => {
    expect(idFromName('corner', 'UFR')).toBe('U2');
    expect(idFromName('corner', 'RBU')).toBe(idFromName('corner', 'RUB'));
    expect(idFromName('edge', 'RU')).toBe('R0');
    expect(elliottBuffers(d, 'edge')).toHaveLength(10);
    expect(elliottBuffers(d, 'corner')).toHaveLength(6);
  });
  for (const pt of ['edge', 'corner'] as const) {
    it(`${pt}: every alg is the right 3-cycle`, () => {
      const bad: string[] = [];
      let total = 0;
      for (const buf of elliottBuffers(d, pt)) {
        const t = elliottTable(d, pt, buf)!;
        for (const [k, alg] of Object.entries(t)) {
          const [a, b] = k.split('|');
          total++;
          const r = verifyAlg(pt, 3, alg, buf, a, b);
          if (r.kind !== 'ok') bad.push(`${stickerName(pt, buf)} ${stickerName(pt, a)}-${stickerName(pt, b)}: ${alg} → ${r.kind}${r.kind === 'error' ? ' ' + r.message : ''}`);
        }
      }
      console.log(`ELLIOTT ${pt}: ${total - bad.length}/${total} ok`);
      bad.slice(0, 40).forEach((x) => console.log('BAD', x));
      expect(total).toBeGreaterThan(500);
      expect(bad).toEqual([]);
    });
  }
});
