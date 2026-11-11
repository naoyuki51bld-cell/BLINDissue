// NxN キューブのステッカーモデル。
// 面の順序は U L F R B D（Speffz と同じ）。ステッカー番号 = face*N*N + row*N + col。
// 各面は展開図の標準的な向き（U は B が上、D は F が上、側面は U が上）で見たときの row/col。

export const FACES = ['U', 'L', 'F', 'R', 'B', 'D'] as const;
export type Face = (typeof FACES)[number];
export type Vec3 = [number, number, number];
export type Axis = 0 | 1 | 2; // x, y, z

export const FACE_NORMAL: Record<Face, Vec3> = {
  U: [0, 1, 0],
  L: [-1, 0, 0],
  F: [0, 0, 1],
  R: [1, 0, 0],
  B: [0, 0, -1],
  D: [0, -1, 0],
};

export interface CubeGeometry {
  n: number;
  count: number;
  /** ステッカーの 3D 座標（面上の座標は ±n、それ以外はキュービー中心座標 -(n-1)..(n-1) の 2 刻み） */
  pos: Vec3[];
  normal: Vec3[];
  index: Map<string, number>;
}

const geoCache = new Map<number, CubeGeometry>();

export function stickerPosition(face: Face, r: number, c: number, n: number): Vec3 {
  const lo = (i: number) => -(n - 1) + 2 * i;
  const hi = (i: number) => n - 1 - 2 * i;
  switch (face) {
    case 'U':
      return [lo(c), n, lo(r)];
    case 'D':
      return [lo(c), -n, hi(r)];
    case 'F':
      return [lo(c), hi(r), n];
    case 'B':
      return [hi(c), hi(r), -n];
    case 'R':
      return [n, hi(r), hi(c)];
    case 'L':
      return [-n, hi(r), lo(c)];
  }
}

const key = (v: Vec3) => v.join(',');

export function geometry(n: number): CubeGeometry {
  const cached = geoCache.get(n);
  if (cached) return cached;
  const pos: Vec3[] = [];
  const normal: Vec3[] = [];
  const index = new Map<string, number>();
  FACES.forEach((f) => {
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const p = stickerPosition(f, r, c, n);
        index.set(key(p), pos.length);
        pos.push(p);
        normal.push(FACE_NORMAL[f]);
      }
  });
  const g = { n, count: pos.length, pos, normal, index };
  geoCache.set(n, g);
  return g;
}

export function faceOf(sticker: number, n: number): Face {
  return FACES[Math.floor(sticker / (n * n))];
}

/** ステッカーが属するキュービーの中心座標 */
export function cubieOf(p: Vec3, n: number): Vec3 {
  return p.map((v) => (Math.abs(v) === n ? Math.sign(v) * (n - 1) : v)) as Vec3;
}

// 各軸の正方向の面（R/U/F）を時計回りに 90° 回す回転
const ROT: Record<Axis, (v: Vec3) => Vec3> = {
  0: ([x, y, z]) => [x, z, -y],
  1: ([x, y, z]) => [-z, y, x],
  2: ([x, y, z]) => [y, -x, z],
};

export function rotateVec(v: Vec3, axis: Axis, quarterTurns: number): Vec3 {
  let out = v;
  const q = ((quarterTurns % 4) + 4) % 4;
  for (let i = 0; i < q; i++) out = ROT[axis](out);
  return out;
}

/** 基本ムーブ: 軸・回す層（キュービー座標値）・正方向への 90° 回数 */
export interface BaseMove {
  axis: Axis;
  layers: number[];
  turns: number;
}

const permCache = new Map<string, Int32Array>();

/** to[i] = ムーブ後にステッカー位置 i の中身が移動する先 */
export function movePermutation(n: number, m: BaseMove): Int32Array {
  const k = `${n}|${m.axis}|${m.layers.join(',')}|${((m.turns % 4) + 4) % 4}`;
  const cached = permCache.get(k);
  if (cached) return cached;
  const g = geometry(n);
  const to = new Int32Array(g.count);
  const layerSet = new Set(m.layers);
  for (let i = 0; i < g.count; i++) {
    const cub = cubieOf(g.pos[i], n);
    if (layerSet.has(cub[m.axis])) {
      const np = rotateVec(g.pos[i], m.axis, m.turns);
      const j = g.index.get(key(np));
      if (j === undefined) throw new Error('internal: rotation out of grid');
      to[i] = j;
    } else to[i] = i;
  }
  permCache.set(k, to);
  return to;
}

/** state[pos] = 元々どのステッカーがその位置にあるか */
export type CubeState = Int32Array;

export function solved(n: number): CubeState {
  const s = new Int32Array(geometry(n).count);
  for (let i = 0; i < s.length; i++) s[i] = i;
  return s;
}

export function applyMove(state: CubeState, n: number, m: BaseMove): CubeState {
  const to = movePermutation(n, m);
  const out = new Int32Array(state.length);
  for (let i = 0; i < state.length; i++) out[to[i]] = state[i];
  return out;
}

export function applyMoves(state: CubeState, n: number, moves: BaseMove[]): CubeState {
  let s = state;
  for (const m of moves) s = applyMove(s, n, m);
  return s;
}

export function statesEqual(a: CubeState, b: CubeState): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 状態を色（面）の配列に変換 */
export function colors(state: CubeState, n: number): Uint8Array {
  const out = new Uint8Array(state.length);
  const nn = n * n;
  for (let i = 0; i < state.length; i++) out[i] = Math.floor(state[i] / nn);
  return out;
}

const allLayers = (n: number) => Array.from({ length: n }, (_, i) => -(n - 1) + 2 * i);

/** 24 通りの持ち替え（全体回転）。各要素は基本ムーブ列 */
export function wholeCubeRotations(n: number): BaseMove[][] {
  const L = allLayers(n);
  const x: BaseMove = { axis: 0, layers: L, turns: 1 };
  const y: BaseMove = { axis: 1, layers: L, turns: 1 };
  const z: BaseMove = { axis: 2, layers: L, turns: 1 };
  const seqs: BaseMove[][] = [];
  const seen = new Set<string>();
  const firsts: BaseMove[][] = [[], [x], [x, x], [x, x, x], [z], [z, z, z]];
  for (const f of firsts)
    for (let k = 0; k < 4; k++) {
      const seq = [...f, ...Array(k).fill(y)];
      const s = applyMoves(solved(n), n, seq);
      const id = colors(s, n).join('');
      if (!seen.has(id)) {
        seen.add(id);
        seqs.push(seq);
      }
    }
  return seqs;
}
