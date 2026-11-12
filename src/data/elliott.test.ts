import { describe, expect, it } from 'vitest';
import { stickerName } from '../cube/pieces';
import { verifyAlg } from '../cube/verify';
import data from './elliott.json';
import { elliottBuffers, elliottFlips, elliottParity, elliottTable, idFromName, type ElliottData } from './elliott';
import { checkSpecial, flipCases, orderEdges, parityCases, pieceRefId, describeAlg } from '../cube/special';

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
  it('parity algs all swap the buffer with the last target and two edges', () => {
    const t = elliottParity(d);
    const bad: string[] = [];
    let n = 0;
    for (const [k, alg] of Object.entries(t)) {
      const [buffer, target] = k.split('|');
      n++;
      const r = checkSpecial({ kind: 'parity', buffer, target }, alg);
      if (!r.ok) bad.push(`${stickerName('corner', buffer)} ${stickerName('corner', target)}: ${alg} → ${r.message}`);
    }
    console.log(`PARITY ${n - bad.length}/${n}`);
    bad.slice(0, 20).forEach((x) => console.log('BADP', x));
    expect(n).toBe(66);
    expect(bad).toEqual([]);
    expect(parityCases('U2')).toHaveLength(21);
  });
  it('flip algs flip exactly the two edges', () => {
    const t = elliottFlips(d, (id) => pieceRefId('edge', id), orderEdges);
    const bad: string[] = [];
    for (const [k, alg] of Object.entries(t)) {
      const [a, b] = k.split('|');
      const r = checkSpecial({ kind: 'flip', a, b }, alg);
      if (!r.ok) bad.push(`${stickerName('edge', a)}+${stickerName('edge', b)}: ${alg} → ${r.message}`);
    }
    console.log(`FLIP ${Object.keys(t).length - bad.length}/${Object.keys(t).length}`);
    bad.slice(0, 20).forEach((x) => console.log('BADF', x));
    expect(Object.keys(t)).toHaveLength(66);
    expect(flipCases()).toHaveLength(66);
    expect(bad).toEqual([]);
  });
  it('describes what an alg solves', () => {
    expect(describeAlg("R U R' U' R' F R2 U' R' U' R U R' F'")).toContain('交換');
  });
});
