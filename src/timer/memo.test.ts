import { describe, expect, it } from 'vitest';
import { applyMoves, solved } from '../cube/cube';
import { generateSuggestions } from '../cube/generator';
import { toBaseMoves } from '../cube/notation';
import { stickerName } from '../cube/pieces';
import { analyze, caseStateOf, orderEdges, pieceRefId } from '../cube/special';
import data from '../data/elliott.json';
import { elliottFlips, elliottParity, type ElliottData } from '../data/elliott';
import { toFaceTurns, turnToString } from '../smartcube/tracker';
import { segmentSolve } from './analysis';
import { expectedSolution, judgeSegments, type MemoSettings } from './memo';
import { randomScramble } from './scramble';

const corner = generateSuggestions('corner', 3, 'U2');
const edge = generateSuggestions('edge', 3, 'U2');
const parity = elliottParity(data as unknown as ElliottData);
const flips = elliottFlips(data as unknown as ElliottData, (id) => pieceRefId('edge', id), orderEdges);

const algs: Record<string, string> = {};
for (const [k, v] of corner) algs[`corner|U2|${k}`] = v[0].alg;
for (const [k, v] of edge) algs[`edge|U2|${k}`] = v[0].alg;
for (const [k, v] of Object.entries(parity)) algs[`parity|${k}`] = v;
for (const [k, v] of Object.entries(flips)) algs[`flip|${k}`] = v;

const settings: MemoSettings = {
  cornerBuffers: ['U2'],
  edgeBuffers: ['U2'],
  algOf: (k) => algs[k],
  hasBuffer: (_pt, b) => b === 'U2',
  label: (pt, _b, a, b) => `${stickerName(pt, a)}-${stickerName(pt, b)}`,
  single: (pt, a) => stickerName(pt, a),
};

// 手順の無いケース（自動生成で見つからないコーナー 6 ケース）を含むスクランブルは飛ばす
function solveByExpected(scramble: string) {
  const exp = expectedSolution(scramble, settings);
  const steps = exp.steps.filter((s) => s.kind !== 'twist');
  if (steps.some((s) => !s.alg)) return null;
  return { exp, algs: steps.map((s) => s.alg!) };
}

describe('expected solution (memo)', () => {
  it('solves random scrambles (twisted corners too, with 3-style combos)', () => {
    let tested = 0;
    let withTwist = 0;
    let rnd = 1;
    const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 60 && tested < 50; i++) {
      const scr = randomScramble(25, rand);
      const r = solveByExpected(scr);
      if (!r) continue;
      tested++;
      const st = applyMoves(solved(3), 3, toBaseMoves(`${scr} ${r.algs.join(' ')}`, 3));
      const a = analyze(caseStateOf(st)!);
      const twistLeft = r.exp.steps.some((s) => s.kind === 'twist');
      if (r.exp.steps.some((s) => s.twist)) withTwist++;
      const bad = a.edges.some((s, j) => s.piece !== j || s.twist !== 0) || a.corners.some((s, j) => s.piece !== j || (!twistLeft && s.twist !== 0));
      expect(bad, `${scr}\n${r.exp.steps.map((s) => s.label).join(' / ')}\n${r.exp.notes.join(' ')}`).toBe(false);
    }
    expect(tested).toBeGreaterThan(30);
    expect(withTwist).toBeGreaterThan(3);
  });

  it('judges a correct solve as all ok, and finds memo / execution mistakes', () => {
    let rnd = 7;
    const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    let scr = '';
    let r: ReturnType<typeof solveByExpected> = null;
    while (!r || r.exp.steps.filter((s) => s.kind === 'edge').length < 3) {
      scr = randomScramble(25, rand);
      r = solveByExpected(scr);
    }
    const ctx = { cornerBuffers: ['U2'], edgeBuffers: ['U2'], label: settings.label as never };
    const segs = (list: string[]) => {
      const turns = list.flatMap((a) => toFaceTurns(a));
      return segmentSolve(turns, turns.map((_, i) => i * 100), 0, ctx);
    };
    // 正しく解く
    const ok = judgeSegments(scr, segs(r.algs), settings);
    expect(ok.judged.every((j) => j.verdict === 'ok'), JSON.stringify(ok.judged)).toBe(true);

    // 記憶ミス: 2 つ目のエッジの手順の代わりに、別のケースの手順を回す
    const wrongKey = Object.keys(algs).find((k) => k.startsWith('edge|') && algs[k] !== r!.algs[1])!;
    const memoMistake = judgeSegments(scr, segs([r.algs[0], algs[wrongKey], ...r.algs.slice(2)]), settings);
    expect(memoMistake.judged[0].verdict).toBe('ok');
    expect(memoMistake.judged[1].verdict).toBe('memo');
    expect(memoMistake.judged[1].message).toContain(r.exp.steps[1].label);

    // 実行ミス: 1 つ目の手順の途中で 1 手まちがえる
    const flat = toFaceTurns(r.algs[0]).map(turnToString);
    const broken = [...flat.slice(0, -1), 'F'].join(' ');
    const execMistake = judgeSegments(scr, segs([broken, ...r.algs.slice(1)]), settings);
    expect(execMistake.judged.some((j) => j.verdict === 'exec' || j.verdict === 'memo')).toBe(true);
  });
});

describe('floating buffers', () => {
  it('uses the second edge buffer when its algs are registered, and still solves', () => {
    const ub = generateSuggestions('edge', 3, 'U0');
    const more: Record<string, string> = { ...algs };
    for (const [k, v] of ub) more[`edge|U0|${k}`] = v[0].alg;
    const s2: MemoSettings = { ...settings, edgeBuffers: ['U2', 'U0'], algOf: (k) => more[k], hasBuffer: () => true };
    let rnd = 11;
    const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    let floated = 0;
    let tested = 0;
    for (let i = 0; i < 80 && tested < 40; i++) {
      const scr = randomScramble(25, rand);
      const exp = expectedSolution(scr, s2);
      const steps = exp.steps.filter((s) => s.kind !== 'twist');
      if (steps.some((s) => !s.alg)) continue;
      tested++;
      if (steps.some((s) => s.key?.startsWith('edge|U0|'))) floated++;
      const st = applyMoves(solved(3), 3, toBaseMoves(`${scr} ${steps.map((s) => s.alg).join(' ')}`, 3));
      const a = analyze(caseStateOf(st)!);
      const bad = a.edges.some((s, j) => s.piece !== j || s.twist !== 0) || a.corners.some((s, j) => s.piece !== j);
      expect(bad, `${scr}\n${exp.steps.map((s) => s.label).join(' / ')}`).toBe(false);
    }
    expect(floated).toBeGreaterThan(0);
  });
});

describe('twisted corners with two 3-style algs', () => {
  it('solves twist-only states with registered corner algs and judges them ok', async () => {
    const { solve, moveName, inverseMove, solvedCubie } = await import('./solver');
    let rnd = 5;
    const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    let tested = 0;
    for (let i = 0; i < 40 && tested < 12; i++) {
      const c = solvedCubie();
      // 2〜3 個のコーナーだけをねじる
      const picks = [0, 1, 2, 3, 4, 5, 6, 7].sort(() => rand() - 0.5).slice(0, rand() < 0.5 ? 2 : 3);
      const tw = picks.length === 2 ? [1, 2] : rand() < 0.5 ? [1, 1, 1] : [2, 2, 2];
      picks.forEach((p, k) => (c.co[p] = tw[k]));
      const sol = solve(c)!;
      const scr = sol.slice().reverse().map((m) => moveName(inverseMove(m))).join(' ');
      const exp = expectedSolution(scr, settings);
      const steps = exp.steps;
      expect(steps.some((s) => s.kind === 'twist'), `${scr}\n${steps.map((s) => s.label).join(' / ')}`).toBe(false);
      if (steps.some((s) => !s.alg)) continue;
      tested++;
      expect(steps.every((s) => s.twist)).toBe(true);
      const st = applyMoves(solved(3), 3, toBaseMoves(`${scr} ${steps.map((s) => s.alg).join(' ')}`, 3));
      const a = analyze(caseStateOf(st)!);
      expect(a.corners.every((s, j) => s.piece === j && s.twist === 0), `${scr}\n${steps.map((s) => s.label).join(' / ')}`).toBe(true);
      const ctx = { cornerBuffers: ['U2'], edgeBuffers: ['U2'], label: settings.label as never };
      const turns = steps.flatMap((s) => toFaceTurns(s.alg!));

      const j = judgeSegments(scr, segmentSolve(turns, turns.map((_, k) => k * 100), 0, ctx), settings);
      expect(j.judged.every((x) => x.verdict === 'ok'), JSON.stringify(j.judged)).toBe(true);
    }
    expect(tested).toBeGreaterThan(5);
  }, 60000);
});
