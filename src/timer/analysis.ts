// 解いた手順を、1 つずつの手順（3-cycle・パリティ・フリップ・ツイスト）に区切る
import { applyMove, solved, type CubeState } from '../cube/cube';
import { tokenToBaseMove } from '../cube/notation';
import type { PieceType, StickerId } from '../cube/pieces';
import { analyze, caseStateOf } from '../cube/special';
import { detectCase } from '../cube/verify';
import type { FaceTurn } from '../smartcube/tracker';
import { turnToString } from '../smartcube/tracker';
import type { Segment } from './types';

export interface SegmentContext {
  cornerBuffers: StickerId[];
  edgeBuffers: StickerId[];
  label: (pt: PieceType, buffer: StickerId, a: StickerId, b: StickerId) => string;
}

type Kind = { kind: string; label: string; key?: string };

function classify(eff: CubeState, ctx: SegmentContext): Kind | null {
  // 何も変わっていない（R R' など）は区切らない
  let moved = false;
  for (let i = 0; i < eff.length; i++) if (eff[i] !== i) moved = true;
  if (!moved) return null;
  for (const [pt, bufs] of [
    ['corner', ctx.cornerBuffers],
    ['edge', ctx.edgeBuffers],
  ] as [PieceType, StickerId[]][]) {
    for (const buf of bufs) {
      const d = detectCase(pt, 3, eff, buf);
      if (d) return { kind: pt, label: ctx.label(pt, buf, d[0], d[1]), key: `${pt}|${buf}|${d[0]}|${d[1]}` };
    }
  }
  const cs = caseStateOf(eff);
  if (!cs) return null;
  const a = analyze(cs);
  const cornerSwaps = a.corners.filter((s, i) => s.piece !== i).length;
  const twists = a.corners.filter((s, i) => s.piece === i && s.twist !== 0).length;
  const edgeSwaps = a.edges.filter((s, i) => s.piece !== i).length;
  const flips = a.edges.filter((s, i) => s.piece === i && s.twist !== 0).length;
  if (!cornerSwaps && !edgeSwaps && !flips && twists >= 2) return { kind: 'twist', label: `ツイスト（${twists}）` };
  if (!cornerSwaps && !edgeSwaps && !twists && flips >= 2) return { kind: 'flip', label: `フリップ（${flips}）` };
  if (cornerSwaps === 2 && edgeSwaps === 2 && !flips) return twists ? { kind: 'ltct', label: 'LTCT' } : { kind: 'parity', label: 'パリティ' };
  return null;
}

export function segmentSolve(turns: FaceTurn[], times: number[], memoEnd: number, ctx: SegmentContext): Segment[] {
  const out: Segment[] = [];
  let start = 0;
  let eff = solved(3);
  let prevEnd = memoEnd;
  const push = (end: number, k: Kind) => {
    const t0 = times[start];
    const t1 = times[end];
    out.push({
      ...k,
      moves: turns.slice(start, end + 1).map(turnToString).join(' '),
      pause: Math.max(0, t0 - prevEnd),
      exec: Math.max(0, t1 - t0),
    });
    prevEnd = t1;
    start = end + 1;
    eff = solved(3);
  };
  for (let i = 0; i < turns.length; i++) {
    eff = applyMove(eff, 3, tokenToBaseMove(turns[i].face, turns[i].amount, 3));
    const k = classify(eff, ctx);
    if (k) push(i, k);
  }
  if (start < turns.length) push(turns.length - 1, { kind: 'unknown', label: '区切れなかった手' });
  return out;
}
