import { describe, expect, it } from 'vitest';
import { applyMoves, colors, solved } from '../cube/cube';
import { toBaseMoves } from '../cube/notation';
import { toFaceTurns, turnToString } from '../smartcube/tracker';
import { segmentSolve } from './analysis';
import { applyAlgColors, colorsToState, describeUnsolved, fromFacelets, fromGrip, isSolvedColors, solvedColors, toGrip } from './cubeColors';
import { randomScramble } from './scramble';
import { averageOf, bestOf, formatTime, meanOf, successRate, value } from './stats';
import type { Solve } from './types';

const solve = (total: number, penalty: Solve['penalty'] = 'OK'): Solve => ({ id: String(Math.random()), session: 's', date: 0, scramble: '', total, penalty, updatedAt: 0 });

describe('timer', () => {
  it('makes valid scrambles', () => {
    const s = randomScramble(25).split(' ');
    expect(s).toHaveLength(25);
    for (let i = 1; i < s.length; i++) expect(s[i][0]).not.toBe(s[i - 1][0]);
  });
  it('tracks colors and converts back to stickers', () => {
    const scr = randomScramble(25);
    const c = applyAlgColors(solvedColors(), scr);
    expect(isSolvedColors(c)).toBe(false);
    const st = applyMoves(solved(3), 3, toBaseMoves(scr, 3));
    expect(Array.from(colors(st, 3))).toEqual(Array.from(c));
    expect(Array.from(colorsToState(c)!)).toEqual(Array.from(st));
    const inv = scr.split(' ').reverse().map((m) => (m.endsWith("'") ? m[0] : m.endsWith('2') ? m : m + "'")).join(' ');
    expect(isSolvedColors(applyAlgColors(c, inv))).toBe(true);
  });
  it('reads GAN facelets and explains an unsolved cube', () => {
    const f = 'U'.repeat(9) + 'R'.repeat(9) + 'F'.repeat(9) + 'D'.repeat(9) + 'L'.repeat(9) + 'B'.repeat(9);
    expect(isSolvedColors(fromFacelets(f)!)).toBe(true);
    const c = applyAlgColors(solvedColors(), "R U R' U' R' F R2 U' R' U' R U R' F'");
    expect(describeUnsolved(c)).toContain('交換');
  });
  it('computes stats like csTimer', () => {
    const list = [solve(30000), solve(40000, 'DNF'), solve(35000), solve(20000, '+2'), solve(50000)];
    expect(value(list[3])).toBe(22000);
    expect(meanOf(list.slice(0, 3))).toBe(Infinity); // DNF を含む mo3
    expect(meanOf([list[0], list[2], list[3]])).toBeCloseTo(29000);
    // ao5: 最良 22.00 と最悪 DNF を除いた 30, 35, 50 の平均
    expect(averageOf(list)).toBeCloseTo(38333.33, 1);
    expect(bestOf(list, 3, meanOf)).toBeCloseTo((35000 + 22000 + 50000) / 3);
    expect(successRate(list)).toBe(0.8);
    expect(formatTime(83456)).toBe('1:23.45');
    expect(formatTime(5432)).toBe('5.43');
  });
  it('splits an execution into algorithms', () => {
    const algs = ["[R U R', D]", "[M', U2]", "R U R' F' R U R' U' R' F R2 U' R' U'"];
    const turns = algs.flatMap((a) => toFaceTurns(a));
    const times = turns.map((_, i) => 1000 + i * 100 + (i >= 8 ? 500 : 0)); // 2 つ目の前で 0.5 秒止まる
    const segs = segmentSolve(turns, times, 900, {
      cornerBuffers: ['U2'],
      edgeBuffers: ['U2'],
      label: (pt, _b, a, b) => `${pt}:${a}${b}`,
    });
    expect(segs.map((s) => s.kind)).toEqual(['corner', 'edge', 'parity']);
    expect(segs[1].pause).toBe(600); // 0.1 + 0.5 秒
    expect(segs[0].moves).toBe(toFaceTurns(algs[0]).map(turnToString).join(' '));
  });
  it('converts between core and grip frames', () => {
    const c = applyAlgColors(solvedColors(), "R U F' D2 L B'");
    for (const grip of [{ top: 'D', front: 'F' }, { top: 'U', front: 'R' }, { top: 'F', front: 'D' }] as const) {
      expect(Array.from(fromGrip(toGrip(c, grip), grip))).toEqual(Array.from(c));
    }
  });
});

import { isDone, parseScramble, startProgress, stepProgress } from './scrambleTracker';
import { parseFaceTurn } from '../smartcube/tracker';

describe('scramble tracking by moves', () => {
  const run = (scr: string, moves: string) => {
    const tokens = parseScramble(scr);
    let p = startProgress();
    for (const m of moves.split(' ').filter(Boolean)) p = stepProgress(p, tokens, parseFaceTurn(m)!);
    return { p, tokens };
  };
  it('follows the scramble, R2 as two quarter turns in either direction', () => {
    const { p, tokens } = run("R2 U F'", "R R U F'");
    expect(isDone(p, tokens)).toBe(true);
    expect(isDone(run("R2 U F'", "R' R' U F'").p, tokens)).toBe(true);
  });
  it('reports wrong moves and recovers after undoing them', () => {
    const { p } = run("R2 U F'", 'R R U L');
    expect(p.pos).toBe(2);
    expect(p.off).toEqual([{ face: 'L', amount: 1 }]);
    const { p: p2, tokens } = run("R2 U F'", "R R U L L' F'");
    expect(isDone(p2, tokens)).toBe(true);
  });
  it('a half-finished R2 followed by another face is off', () => {
    const { p } = run("R2 U", 'R U');
    expect(p.off).toEqual([
      { face: 'R', amount: 1 },
      { face: 'U', amount: 1 },
    ]);
  });
});
