import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkSpecial, parseSpecialKey } from '../cube/special';
import { verifyAlg } from '../cube/verify';
import { bigNotation, BLDDB_FILES, letterToId, processBlddb, type BlddbCategory } from './blddb';

// 実データでの確認（手元に BLDDB のデータがあるときだけ）: BLDDB_DATA=/path/to/blddb/public/data
const DATA = process.env.BLDDB_DATA ?? '';

describe('BLDDB conversion', () => {
  it('decodes Chichu letters', () => {
    expect(letterToId('corner', 'J')).toBe('U2'); // UFR
    expect(letterToId('edge', 'A')).toBe('U2'); // UF
    expect(letterToId('corner', 'A')).toBe('U3'); // UFL
    expect(letterToId('wing', 'A', true)).toBeTruthy();
  });
  it('converts big cube notation', () => {
    expect(bigNotation("Lw U L' U l2 U' L U l2 U2 Lw'")).toBe("Lw U L' U 2L2 U' L U 2L2 U2 Lw'");
    expect(bigNotation("r' D2 r")).toBe("2R' D2 2R");
  });
  it('assigns a small sample correctly', () => {
    const sample = { JAB: [[["R U R' D R U' R' D'"], ['Someone']]] };
    // キーの 2・3 文字目は無視し、手順の効果でケースを決める
    const r = processBlddb('corner', sample);
    expect(r.assigned).toBe(1);
    const [key] = Object.keys(r.table);
    const [pt, buf, a, b] = key.split('|');
    expect(pt).toBe('corner');
    expect(buf).toBe('U2');
    expect(verifyAlg('corner', 3, "R U R' D R U' R' D'", buf, a, b).kind).toBe('ok');
  });

  const cats: BlddbCategory[] = ['corner', 'edge', 'parity', 'flip', 'ltct', 'wing', 'xcenter', 'tcenter', 'midge'];
  for (const cat of cats) {
    it.skipIf(!DATA || !existsSync(`${DATA}/${BLDDB_FILES[cat]}`))(`real data: ${cat}`, () => {
      const json = JSON.parse(readFileSync(`${DATA}/${BLDDB_FILES[cat]}`, 'utf8'));
      const t0 = performance.now();
      const r = processBlddb(cat, json);
      const ms = Math.round(performance.now() - t0);
      const keys = Object.keys(r.table);
      console.log(`BLDDB ${cat}: ${r.assigned}/${r.total} algs → ${keys.length} cases, ${ms}ms`);
      // 割り当てた手順は必ずそのケースで正しい
      for (const k of keys.slice(0, 200)) {
        const top = r.table[k][0];
        const sp = parseSpecialKey(k);
        if (sp) expect(checkSpecial(sp, top.alg).ok, `${k} ${top.alg}`).toBe(true);
        else {
          const [pt, buf, a, b] = k.split('|');
          const n = cat === 'corner' || cat === 'edge' ? 3 : 5;
          expect(verifyAlg(pt as never, n, top.alg, buf, a, b).kind, `${k} ${top.alg}`).toBe('ok');
        }
      }
      expect(r.assigned / r.total).toBeGreaterThan(0.5);
    }, 300000);
  }
});
