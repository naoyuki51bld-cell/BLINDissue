// 3x3 の 2 フェーズ解法（Kociemba 法）。ランダムな状態のスクランブルを作るのに使う。
// 状態はコーナー・エッジの位置と向き（cubie）で表す。

// コーナー: URF UFL ULB UBR DFR DLF DBL DRB / エッジ: UR UF UL UB DR DF DL DB FR FL BL BR
export interface Cubie {
  cp: number[];
  co: number[];
  ep: number[];
  eo: number[];
}

const FACE_NAMES = ['U', 'R', 'F', 'D', 'L', 'B'];
const BASIC: Cubie[] = [
  { cp: [3, 0, 1, 2, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0], ep: [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11], eo: Array(12).fill(0) },
  { cp: [4, 1, 2, 0, 7, 5, 6, 3], co: [2, 0, 0, 1, 1, 0, 0, 2], ep: [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0], eo: Array(12).fill(0) },
  { cp: [1, 5, 2, 3, 0, 4, 6, 7], co: [1, 2, 0, 0, 2, 1, 0, 0], ep: [0, 9, 2, 3, 4, 8, 6, 7, 1, 5, 10, 11], eo: [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0] },
  { cp: [0, 1, 2, 3, 5, 6, 7, 4], co: [0, 0, 0, 0, 0, 0, 0, 0], ep: [0, 1, 2, 3, 5, 6, 7, 4, 8, 9, 10, 11], eo: Array(12).fill(0) },
  { cp: [0, 2, 6, 3, 4, 1, 5, 7], co: [0, 1, 2, 0, 0, 2, 1, 0], ep: [0, 1, 10, 3, 4, 5, 9, 7, 8, 2, 6, 11], eo: Array(12).fill(0) },
  { cp: [0, 1, 3, 7, 4, 5, 2, 6], co: [0, 0, 1, 2, 0, 0, 2, 1], ep: [0, 1, 2, 11, 4, 5, 6, 10, 8, 9, 3, 7], eo: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1] },
];

export const solvedCubie = (): Cubie => ({ cp: [0, 1, 2, 3, 4, 5, 6, 7], co: Array(8).fill(0), ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eo: Array(12).fill(0) });

export function multiply(a: Cubie, b: Cubie): Cubie {
  return {
    cp: b.cp.map((p) => a.cp[p]),
    co: b.cp.map((p, i) => (a.co[p] + b.co[i]) % 3),
    ep: b.ep.map((p) => a.ep[p]),
    eo: b.ep.map((p, i) => (a.eo[p] + b.eo[i]) % 2),
  };
}

// 18 手: 面 f の (1, 2, 3) 回 = index f*3 + (k-1)
const MOVES: Cubie[] = [];
for (const m of BASIC) {
  let c = m;
  for (let k = 0; k < 3; k++) {
    MOVES.push(c);
    c = multiply(c, m);
  }
}
export const moveName = (m: number) => FACE_NAMES[Math.floor(m / 3)] + ['', '2', "'"][m % 3];
export const applyMove = (c: Cubie, m: number) => multiply(c, MOVES[m]);

// ---- 座標 ----
function permIndex(p: number[]): number {
  let idx = 0;
  for (let i = 0; i < p.length; i++) {
    let c = 0;
    for (let j = i + 1; j < p.length; j++) if (p[j] < p[i]) c++;
    idx = idx * (p.length - i) + c;
  }
  return idx;
}
function permFromIndex(idx: number, n: number): number[] {
  const code: number[] = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    code[i] = idx % (n - i);
    idx = Math.floor(idx / (n - i));
  }
  const avail = Array.from({ length: n }, (_, i) => i);
  return code.map((c) => avail.splice(c, 1)[0]);
}
const C = (n: number, k: number) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
};

const twistOf = (c: Cubie) => c.co.slice(0, 7).reduce((a, x) => a * 3 + x, 0);
function setTwist(c: Cubie, t: number) {
  let s = 0;
  for (let i = 6; i >= 0; i--) {
    c.co[i] = t % 3;
    s += c.co[i];
    t = Math.floor(t / 3);
  }
  c.co[7] = (3 - (s % 3)) % 3;
}
const flipOf = (c: Cubie) => c.eo.slice(0, 11).reduce((a, x) => a * 2 + x, 0);
function setFlip(c: Cubie, f: number) {
  let s = 0;
  for (let i = 10; i >= 0; i--) {
    c.eo[i] = f % 2;
    s += c.eo[i];
    f = Math.floor(f / 2);
  }
  c.eo[11] = s % 2;
}
const isSlice = (e: number) => e >= 8;
/** スライスの 4 エッジ（FR FL BL BR）がある位置の組合せ（0..494） */
function sliceOf(c: Cubie): number {
  let idx = 0;
  let k = 0;
  for (let i = 0; i < 12; i++) if (isSlice(c.ep[i])) idx += C(i, ++k);
  return idx;
}
function setSlice(c: Cubie, s: number) {
  const pos: boolean[] = Array(12).fill(false);
  let k = 4;
  for (let i = 11; i >= 0 && k > 0; i--) {
    if (C(i, k) <= s) {
      s -= C(i, k);
      pos[i] = true;
      k--;
    }
  }
  let a = 8;
  let b = 0;
  c.ep = pos.map((p) => (p ? a++ : b++));
}
const cpOf = (c: Cubie) => permIndex(c.cp);
const setCp = (c: Cubie, i: number) => void (c.cp = permFromIndex(i, 8));
const epOf = (c: Cubie) => permIndex(c.ep.slice(0, 8));
const setEp = (c: Cubie, i: number) => void (c.ep = [...permFromIndex(i, 8), 8, 9, 10, 11]);
const spOf = (c: Cubie) => permIndex(c.ep.slice(8).map((x) => x - 8));
const setSp = (c: Cubie, i: number) => void (c.ep = [0, 1, 2, 3, 4, 5, 6, 7, ...permFromIndex(i, 4).map((x) => x + 8)]);

const P2_MOVES = [0, 1, 2, 9, 10, 11, 4, 7, 13, 16]; // U U2 U' D D2 D' R2 F2 L2 B2

interface Tables {
  twist: Uint16Array;
  flip: Uint16Array;
  slice: Uint16Array;
  cp: Uint16Array;
  ep: Uint16Array;
  sp: Uint8Array;
  pTwistSlice: Int8Array;
  pFlipSlice: Int8Array;
  pCpSp: Int8Array;
  pEpSp: Int8Array;
  sliceGoal: number;
}

function moveTable(size: number, moves: number[], set: (c: Cubie, i: number) => void, get: (c: Cubie) => number, wide = true): Uint16Array {
  const t = new Uint16Array(size * moves.length);
  for (let i = 0; i < size; i++) {
    const c = solvedCubie();
    set(c, i);
    moves.forEach((m, j) => {
      t[i * moves.length + j] = get(multiply(c, MOVES[m]));
    });
  }
  void wide;
  return t;
}

function prune(n1: number, n2: number, t1: ArrayLike<number>, t2: ArrayLike<number>, nm: number, start: number): Int8Array {
  const p = new Int8Array(n1 * n2).fill(-1);
  p[start] = 0;
  let frontier = [start];
  let d = 0;
  while (frontier.length) {
    const next: number[] = [];
    for (const x of frontier) {
      const a = Math.floor(x / n2);
      const b = x % n2;
      for (let m = 0; m < nm; m++) {
        const y = t1[a * nm + m] * n2 + t2[b * nm + m];
        if (p[y] < 0) {
          p[y] = d + 1;
          next.push(y);
        }
      }
    }
    frontier = next;
    d++;
  }
  return p;
}

let tables: Tables | null = null;
function init(): Tables {
  if (tables) return tables;
  const all = Array.from({ length: 18 }, (_, i) => i);
  const twist = moveTable(2187, all, setTwist, twistOf);
  const flip = moveTable(2048, all, setFlip, flipOf);
  const slice = moveTable(495, all, setSlice, sliceOf);
  const cp = moveTable(40320, P2_MOVES, setCp, cpOf);
  const ep = moveTable(40320, P2_MOVES, setEp, epOf);
  const sp = Uint8Array.from(moveTable(24, P2_MOVES, setSp, spOf));
  const sliceGoal = sliceOf(solvedCubie());
  tables = {
    twist,
    flip,
    slice,
    cp,
    ep,
    sp,
    sliceGoal,
    pTwistSlice: prune(2187, 495, twist, slice, 18, sliceGoal),
    pFlipSlice: prune(2048, 495, flip, slice, 18, sliceGoal),
    pCpSp: prune(40320, 24, cp, sp, 10, 0),
    pEpSp: prune(40320, 24, ep, sp, 10, 0),
  };
  return tables;
}

const sameAxisBlocked = (prev: number, f: number) => prev >= 0 && (prev === f || (prev % 3 === f % 3 && prev > f));
// 面の番号: U0 R1 F2 D3 L4 B5（同じ軸: f%3 が同じ）

/** 2 フェーズ解法。解（手の番号の列）を返す */
export function solve(cube: Cubie, maxLength = 24, timeLimitMs = 800): number[] | null {
  const T = init();
  const deadline = Date.now() + timeLimitMs;
  const p1: number[] = [];
  let best: number[] | null = null;
  let limit = maxLength;

  const phase2 = (cp: number, ep: number, sp: number, depth: number, lastFace: number, out: number[]): boolean => {
    if (cp === 0 && ep === 0 && sp === 0) return true;
    if (depth === 0) return false;
    if (Math.max(T.pCpSp[cp * 24 + sp], T.pEpSp[ep * 24 + sp]) > depth) return false;
    for (let j = 0; j < 10; j++) {
      const m = P2_MOVES[j];
      const f = Math.floor(m / 3);
      if (sameAxisBlocked(lastFace, f)) continue;
      out.push(m);
      if (phase2(T.cp[cp * 10 + j], T.ep[ep * 10 + j], T.sp[sp * 10 + j], depth - 1, f, out)) return true;
      out.pop();
    }
    return false;
  };

  const finishPhase1 = (): boolean => {
    let c = cube;
    for (const m of p1) c = multiply(c, MOVES[m]);
    const cp = cpOf(c);
    const ep = epOf(c);
    const sp = spOf(c);
    const lastFace = p1.length ? Math.floor(p1[p1.length - 1] / 3) : -1;
    for (let d = 0; d < limit - p1.length; d++) {
      const out: number[] = [];
      if (phase2(cp, ep, sp, d, lastFace, out)) {
        best = [...p1, ...out];
        limit = best.length - 1;
        return true;
      }
    }
    return false;
  };

  const phase1 = (tw: number, fl: number, sl: number, depth: number, lastFace: number): boolean => {
    if (Date.now() > deadline && best) return true;
    if (depth === 0) {
      if (tw === 0 && fl === 0 && sl === T.sliceGoal) {
        // 最後が phase2 の手だと重複するので除く
        if (p1.length && P2_MOVES.includes(p1[p1.length - 1])) return false;
        finishPhase1();
        return limit < 21; // 21 手以下が見つかれば十分
      }
      return false;
    }
    if (Math.max(T.pTwistSlice[tw * 495 + sl], T.pFlipSlice[fl * 495 + sl]) > depth) return false;
    for (let m = 0; m < 18; m++) {
      const f = Math.floor(m / 3);
      if (sameAxisBlocked(lastFace, f)) continue;
      p1.push(m);
      const stop = phase1(T.twist[tw * 18 + m], T.flip[fl * 18 + m], T.slice[sl * 18 + m], depth - 1, f);
      p1.pop();
      if (stop) return true;
    }
    return false;
  };

  const tw = twistOf(cube);
  const fl = flipOf(cube);
  const sl = sliceOf(cube);
  for (let d = 0; d <= limit; d++) {
    if (phase1(tw, fl, sl, d, -1)) break;
    if (best && (Date.now() > deadline || d >= limit)) break;
  }
  return best;
}

export const inverseMove = (m: number) => Math.floor(m / 3) * 3 + (2 - (m % 3));

// ---- ランダムな状態 ----
const parity = (p: number[]) => {
  let s = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[j] < p[i]) s ^= 1;
  return s;
};
function shuffle(n: number, rand: () => number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type ScrambleType = 'normal' | 'edges' | 'corners';

export function randomCubie(type: ScrambleType, rand: () => number = Math.random): Cubie {
  const c = solvedCubie();
  if (type !== 'edges') {
    c.cp = shuffle(8, rand);
    setTwist(c, Math.floor(rand() * 2187));
  }
  if (type !== 'corners') {
    c.ep = shuffle(12, rand);
    setFlip(c, Math.floor(rand() * 2048));
  }
  // 偶奇をそろえる（動かさない方は揃っているので、動かす方を偶置換に）
  const fix = (p: number[]) => ([p[0], p[1]] = [p[1], p[0]]);
  if (parity(c.cp) !== parity(c.ep)) {
    if (type === 'corners') fix(c.cp);
    else fix(c.ep);
  }
  return c;
}

/** ランダムな状態のスクランブル（エッジのみ・コーナーのみも） */
export function randomStateScramble(type: ScrambleType, rand: () => number = Math.random): string {
  for (;;) {
    const c = randomCubie(type, rand);
    const sol = solve(c);
    if (!sol || sol.length < 8) continue; // ほとんど揃っている状態は避ける
    return sol
      .slice()
      .reverse()
      .map((m) => moveName(inverseMove(m)))
      .join(' ');
  }
}
