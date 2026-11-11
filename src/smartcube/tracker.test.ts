import { describe, expect, it } from 'vitest';
import { applyMoves, solved } from '../cube/cube';
import { invertAlgText, toBaseMoves } from '../cube/notation';
import { detectCase } from '../cube/verify';
import { AttemptTracker, divergence, gripMap, parseFaceTurn, toFaceTurns, turnToString } from './tracker';

const ALGS: ['corner' | 'edge', string][] = [
  ['corner', "[R U R', D]"],
  ['corner', "[D: [R U R', D2]]"],
  ['edge', "[M', U2]"],
  ['edge', "[U R U', M']"],
  ['edge', "[R' U' R: [R2', E]]"],
  ['edge', "[Rw' : [U' R U, M']]"],
  ['corner', "x' [R U R', D] x"],
];

describe('smart cube tracker', () => {
  it('face-turn conversion has the same effect as the alg (up to rotation)', () => {
    for (const [pt, alg] of ALGS) {
      const d = detectCase(pt, 3, applyMoves(solved(3), 3, toBaseMoves(alg, 3)), 'U2');
      expect(d, alg).not.toBeNull();
      const t = new AttemptTracker(pt, 'U2', d![0], d![1], alg);
      const turns = toFaceTurns(alg);
      expect(turns.every((x) => 'URFDLB'.includes(x.face)), alg).toBe(true);
      let solvedAt = -1;
      turns.forEach((x, i) => {
        if (t.push(x) && solvedAt < 0) solvedAt = i;
      });
      // 最後の数手が打ち消し合う場合（M と Rw が続くなど）は少し早く正解になる
      expect(solvedAt, alg).toBeGreaterThan(turns.length / 2);
      expect(t.isSolved(), alg).toBe(true);
      expect(t.divergence(), alg).toBeNull();
    }
  });

  it('M is reported as opposite outer faces', () => {
    expect(toFaceTurns("M'").map(turnToString)).toEqual(["R'", 'L']);
    expect(toFaceTurns("M' U").map(turnToString)).toEqual(["R'", 'L', 'F']);
    expect(toFaceTurns('Rw U').map(turnToString)).toEqual(['L', 'F']);
    expect(toFaceTurns("x U x'").map(turnToString)).toEqual(['F']);
  });

  it('wrong alg is not accepted and divergence is located', () => {
    const t = new AttemptTracker('corner', 'U2', 'U0', 'U1', "[R U R', D]");
    for (const m of ['R', 'U', "R'", "D'"]) t.push(parseFaceTurn(m)!);
    expect(t.divergence()).toBe(3);
    expect(t.isSolved()).toBe(false);
  });

  it('treats R2 as R R and parallel moves in any order', () => {
    const exp = toFaceTurns("M' U2 M U2");
    const performed = ['L', "R'", 'U', 'U', "L'", 'R', "U'", "U'"].map((m) => parseFaceTurn(m)!);
    // M' U2 M U2 → R' L, (持ち替え後の U2 = F2), L' R ... の順序や向きの違いを許す
    const p2 = exp.flatMap((x) => (Math.abs(x.amount) === 2 ? [{ face: x.face, amount: 1 }, { face: x.face, amount: 1 }] : [x]));
    expect(divergence(p2, exp)).toBeNull();
    expect(divergence(performed.slice(0, 2), exp)).toBeNull();
  });

  it('inverse alg solves the reverse case', () => {
    const alg = "[U R U', M']";
    const d = detectCase('edge', 3, applyMoves(solved(3), 3, toBaseMoves(alg, 3)), 'U2')!;
    const t = new AttemptTracker('edge', 'U2', d[1], d[0], invertAlgText(alg));
    const turns = toFaceTurns(invertAlgText(alg));
    expect(turns.map((x) => t.push(x)).pop()).toBe(true);
  });

  it('maps faces for other grips', () => {
    expect(gripMap({ top: 'U', front: 'F' })).toEqual({ U: 'U', L: 'L', F: 'F', R: 'R', B: 'B', D: 'D' });
    // 黄色上・緑前（z2）: 白(U)は下、赤(R)は左
    const m = gripMap({ top: 'D', front: 'F' });
    expect(m.U).toBe('D');
    expect(m.R).toBe('L');
    expect(m.F).toBe('F');
  });
});
