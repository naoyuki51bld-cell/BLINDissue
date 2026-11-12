// スマートキューブから届く回転（芯から見た外側の面の回転）を、練習の判定に使う形にする。
// スマートキューブは「センター（芯）を固定した座標」で U R F D L B の回転だけを報告する。
// M やワイドムーブは、反対側の面の回転 + 持ち替えとして届く。
import { applyMoves, FACES, rotateVec, solved, wholeCubeRotations, type Axis, type CubeState, type Face, type Vec3 } from '../cube/cube';
import { flatten, parseAlg, tokenToBaseMove } from '../cube/notation';
import type { PieceType, StickerId } from '../cube/pieces';
import { verifyState } from '../cube/verify';

/** 面の色（標準配色: U 白, L 橙, F 緑, R 赤, B 青, D 黄）。スマートキューブもこの配色を前提に面名を送ってくる */
export const COLOR_NAMES: Record<Face, string> = { U: '白', L: 'オレンジ', F: '緑', R: '赤', B: '青', D: '黄' };

export interface Grip {
  /** 上に向ける面の色（キューブ本来の面名で表す） */
  top: Face;
  /** 手前に向ける面の色 */
  front: Face;
}

export const DEFAULT_GRIP: Grip = { top: 'U', front: 'F' };

const OPPOSITE: Record<Face, Face> = { U: 'D', D: 'U', L: 'R', R: 'L', F: 'B', B: 'F' };

export function validFronts(top: Face): Face[] {
  return FACES.filter((f) => f !== top && f !== OPPOSITE[top]);
}

/** キューブ本来の面名 → 持ち方から見た面名 */
export function gripMap(grip: Grip): Record<Face, Face> {
  const n = 3;
  for (const seq of wholeCubeRotations(n)) {
    const s = applyMoves(solved(n), n, seq);
    const centerColor = (f: number) => Math.floor(s[f * 9 + 4] / 9);
    if (FACES[centerColor(0)] === grip.top && FACES[centerColor(2)] === grip.front) {
      const map = {} as Record<Face, Face>;
      for (let f = 0; f < 6; f++) map[FACES[centerColor(f)]] = FACES[f];
      return map;
    }
  }
  throw new Error('invalid grip');
}

export interface FaceTurn {
  face: Face;
  amount: number; // その面を時計回りに見た 90° 単位（-1, 1, 2）
}

/** "R'" "U2" などを FaceTurn に */
export function parseFaceTurn(move: string): FaceTurn | null {
  const m = /^([URFDLB])(2?)('?)$/.exec(move.trim());
  if (!m) return null;
  const q = m[2] ? 2 : 1;
  return { face: m[1] as Face, amount: m[3] ? -q : q };
}

const POS_FACE: Record<Axis, Face> = { 0: 'R', 1: 'U', 2: 'F' };
const NEG_FACE: Record<Axis, Face> = { 0: 'L', 1: 'D', 2: 'B' };

/**
 * 手順を、最初の持ち方から見た「外側の面の回転」の列に直す（3x3 のみ）。
 * スライス・ワイド・持ち替えは、芯から見た回転と持ち方の変化に分解する。
 */
export function toFaceTurns(algText: string): FaceTurn[] {
  const n = 3;
  // 今の持ち方の軸ベクトル → 最初の持ち方での軸ベクトル
  let frame: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const out: FaceTurn[] = [];
  for (const fm of flatten(parseAlg(algText))) {
    const bm = tokenToBaseMove(fm.token, fm.amount, n);
    const v = frame[bm.axis];
    const axis = v.findIndex((x) => x !== 0) as Axis;
    const sign = v[axis];
    const layers = bm.layers.map((l) => l * sign);
    const turns = bm.turns * sign;
    const all = [2, 0, -2];
    const emit = (coord: number, t: number) => {
      if (coord > 0) out.push({ face: POS_FACE[axis], amount: t });
      else out.push({ face: NEG_FACE[axis], amount: -t });
    };
    if (layers.includes(0)) {
      // 真ん中を含む回転 = 残りの層の逆回転 + 全体の回転
      for (const c of all.filter((c) => !layers.includes(c) && c !== 0)) emit(c, -turns);
      frame = frame.map((col) => rotateVec(col, axis, -turns));
    } else {
      for (const c of layers) emit(c, turns);
    }
  }
  return out;
}

const AXIS_OF: Record<Face, Axis> = { R: 0, L: 0, U: 1, D: 1, F: 2, B: 2 };

type Block = Map<Face, number>;

function norm(a: number) {
  const r = ((a % 4) + 4) % 4;
  return r === 3 ? -1 : r;
}

/** 同じ軸の連続した回転をまとめる（R L' と L' R、R R と R2 を同じに扱う） */
export function toBlocks(turns: FaceTurn[]): { block: Block; count: number }[] {
  const out: { block: Block; count: number }[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    const lastAxis = last && last.block.size ? AXIS_OF[[...last.block.keys()][0]] : -1;
    if (last && (lastAxis === AXIS_OF[t.face] || last.block.size === 0)) {
      last.block.set(t.face, norm((last.block.get(t.face) ?? 0) + t.amount));
      if (last.block.get(t.face) === 0) last.block.delete(t.face);
      last.count++;
    } else {
      out.push({ block: new Map([[t.face, norm(t.amount)]]), count: 1 });
    }
  }
  return out.filter((b) => b.block.size > 0 || b.count === 0);
}

function sameBlock(a: Block, b: Block) {
  if (a.size !== b.size) return false;
  for (const [f, v] of a) if (b.get(f) !== v) return false;
  return true;
}

/** 回した手順が登録手順からずれ始めた位置（回した手の数）。ずれていなければ null */
export function divergence(performed: FaceTurn[], expected: FaceTurn[]): number | null {
  const p = toBlocks(performed);
  const e = toBlocks(expected);
  let moves = 0;
  for (let i = 0; i < p.length; i++) {
    const isLast = i === p.length - 1;
    const exp = e[i];
    if (!exp) return moves;
    if (!sameBlock(p[i].block, exp.block)) {
      // 最後のブロックは回している途中かもしれない（R2 の 1 手目など）
      const inProgress = [...p[i].block].every(([f, v]) => {
        const want = exp.block.get(f);
        return want !== undefined && (want === v || (Math.abs(want) === 2 && Math.abs(v) === 1));
      });
      if (isLast && inProgress) return null;
      return moves;
    }
    moves += p[i].count;
  }
  return null;
}

function faceToBase(t: FaceTurn) {
  return tokenToBaseMove(t.face, t.amount, 3);
}

/** 1 問分の回転を記録して判定する */
export class AttemptTracker {
  private turns: FaceTurn[] = [];
  private state: CubeState = solved(3);
  readonly expected: FaceTurn[] | null;

  /** check: 揃った状態から回した結果を受け取り、正解なら true */
  constructor(
    private check: (state: CubeState) => boolean,
    algText: string,
  ) {
    let exp: FaceTurn[] | null = null;
    try {
      exp = toFaceTurns(algText);
    } catch {
      exp = null;
    }
    this.expected = exp;
  }

  /** 3-style のケース（バッファ → A → B）用 */
  static forCase(pt: PieceType, buffer: StickerId, a: StickerId, b: StickerId, algText: string) {
    return new AttemptTracker((s) => verifyState(pt, 3, s, buffer, a, b).kind === 'ok', algText);
  }

  /** 持ち方に合わせて変換済みの 1 手を加える。正解になったら true */
  push(turn: FaceTurn): boolean {
    this.turns.push(turn);
    this.state = applyMoves(this.state, 3, [faceToBase(turn)]);
    return this.isSolved();
  }

  /** 数え直す（手で戻したときなど） */
  reset() {
    this.turns = [];
    this.state = solved(3);
  }

  isSolved(): boolean {
    return this.check(this.state);
  }

  get moves(): FaceTurn[] {
    return this.turns;
  }

  divergence(): number | null {
    return this.expected ? divergence(this.turns, this.expected) : null;
  }
}

export function turnToString(t: FaceTurn): string {
  return t.face + (t.amount === 2 || t.amount === -2 ? '2' : t.amount === -1 ? "'" : '');
}
