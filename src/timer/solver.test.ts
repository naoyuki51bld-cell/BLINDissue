import { describe, expect, it } from 'vitest';
import { applyMoves, solved } from '../cube/cube';
import { toBaseMoves } from '../cube/notation';
import { analyze, caseStateOf } from '../cube/special';
import { randomStateScramble } from './solver';

function stateOf(scr: string) {
  return analyze(caseStateOf(applyMoves(solved(3), 3, toBaseMoves(scr, 3)))!);
}

describe('random-state scrambles', () => {
  let rnd = 3;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  for (const type of ['normal', 'edges', 'corners'] as const) {
    it(type, () => {
      for (let i = 0; i < 8; i++) {
        const t = Date.now();
        const scr = randomStateScramble(type, rand);
        const ms = Date.now() - t;
        const a = stateOf(scr);
        const cornersSolved = a.corners.every((s, j) => s.piece === j && s.twist === 0);
        const edgesSolved = a.edges.every((s, j) => s.piece === j && s.twist === 0);
        expect(scr.split(' ').length, scr).toBeLessThanOrEqual(24);
        if (type === 'edges') expect([cornersSolved, edgesSolved], scr).toEqual([true, false]);
        if (type === 'corners') expect([cornersSolved, edgesSolved], scr).toEqual([false, true]);
        if (type === 'normal') expect(cornersSolved || edgesSolved, scr).toBe(false);
        if (i === 0) console.log(type, scr, ms + 'ms');
      }
    }, 60000);
  }
});
