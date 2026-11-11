// 3-style の交換子を総当たりで探して、ケースごとのおすすめ手順を作る。
// 形は [S: [A, B]]（S = セットアップ 0〜2 手、A = 挿入 1 手または X Y X'、B = 交換 1 手）。
import { applyMove, geometry, solved } from './cube';
import { amountSuffix, cancel, type FlatMove, tokenToBaseMove } from './notation';
import { pieceStickers, stickerIndex, STICKER_IDS, type PieceType, type StickerId } from './pieces';

export interface Suggestion {
  alg: string;
  moves: number;
  score: number;
}

interface Move {
  token: string;
  amount: number;
  /** その手で動く位置の写像（位置 p の中身 → to[p]） */
  to: Int32Array;
  from: Int32Array; // 逆写像
  axis: number;
}

const FACE_WEIGHT: Record<string, number> = {
  R: 0, U: 0, D: 0.25, L: 0.4, F: 0.6, B: 1.3,
  M: 0.1, E: 0.7, S: 0.9,
  '2R': 0.35, '2L': 0.45, '2U': 0.35, '2D': 0.35, '2F': 0.7, '2B': 1.2,
  r: 0.3, l: 0.5, u: 0.5, d: 0.5, f: 0.8, b: 1.4,
  '3R': 0.4, '3L': 0.4, '3U': 0.5, '3D': 0.5, '3F': 0.8, '3B': 1.2,
};

function movesetFor(pt: PieceType, n: number): { ins: string[]; int: string[]; setup: string[] } {
  const faces = ['R', 'L', 'U', 'D', 'F', 'B'];
  const slices = ['M', 'E', 'S'];
  const inner = ['2R', '2L', '2U', '2D', '2F', '2B'];
  switch (pt) {
    case 'corner':
      return { ins: faces, int: faces, setup: faces };
    case 'edge':
      return { ins: [...faces, ...slices], int: [...faces, ...slices], setup: [...faces, ...slices] };
    case 'wing':
    case 'xcenter':
      return { ins: [...faces, ...inner], int: [...faces, ...inner], setup: n === 5 ? [...faces, 'r', 'l', 'u', 'd'] : [...faces, 'r', 'l', 'u', 'd'] };
    case 'tcenter':
      return { ins: [...faces, ...inner, ...slices], int: [...faces, ...inner, ...slices], setup: [...faces, ...inner] };
  }
}

function makeMoves(tokens: string[], n: number): Move[] {
  const g = geometry(n);
  const out: Move[] = [];
  for (const token of tokens)
    for (const amount of [1, -1, 2]) {
      const bm = tokenToBaseMove(token, amount, n);
      let s = solved(n);
      s = applyMove(s, n, bm);
      // s[pos] = 元の位置 → 元の位置 s[pos] の中身が pos へ
      const to = new Int32Array(g.count);
      const from = new Int32Array(g.count);
      for (let p = 0; p < g.count; p++) {
        to[s[p]] = p;
        from[p] = s[p];
      }
      out.push({ token, amount, to, from, axis: bm.axis });
    }
  return out;
}

/** 列の写像（位置 p の中身が最終的にどこへ行くか） */
function seqTo(seq: Move[], count: number): Int32Array {
  const t = new Int32Array(count);
  for (let p = 0; p < count; p++) {
    let q = p;
    for (const m of seq) q = m.to[q];
    t[p] = q;
  }
  return t;
}

function invertMap(m: Int32Array): Int32Array {
  const inv = new Int32Array(m.length);
  for (let p = 0; p < m.length; p++) inv[m[p]] = p;
  return inv;
}

function compose(first: Int32Array, second: Int32Array): Int32Array {
  const out = new Int32Array(first.length);
  for (let p = 0; p < first.length; p++) out[p] = second[first[p]];
  return out;
}

interface BaseComm {
  a: Move[];
  b: Move[];
  /** 位置の写像 */
  map: Int32Array;
}

const inv = (m: Move[]): FlatMove[] => m.slice().reverse().map((x) => ({ token: x.token, amount: -x.amount }));
const flat = (m: Move[]): FlatMove[] => m.map((x) => ({ token: x.token, amount: x.amount }));
const seqText = (m: Move[]) => m.map((x) => x.token + amountSuffix(x.amount)).join(' ');

function weightOf(moves: FlatMove[]): number {
  let w = 0;
  for (const m of moves) w += FACE_WEIGHT[m.token] ?? 0.5;
  return w;
}

/**
 * 全ケースのおすすめ手順を作る。
 * 戻り値のキーは "A|B"（スロット ID）。各ケース最大 limit 個、良い順。
 */
export function generateSuggestions(pt: PieceType, n: number, buffer: StickerId, limit = 6): Map<string, Suggestion[]> {
  const g = geometry(n);
  const count = g.count;
  const set = movesetFor(pt, n);
  const insMoves = makeMoves(set.ins, n);
  const intMoves = makeMoves(set.int, n);
  const setupMoves = makeMoves(set.setup, n);

  // この種類のパーツのステッカー（ほかのステッカーは動いてはいけない）
  const pieceSet = new Uint8Array(count);
  const slotOf = new Map<number, StickerId>();
  const pieceRep = new Map<number, number>();
  for (const id of STICKER_IDS) {
    const idx = stickerIndex(pt, id, n);
    slotOf.set(idx, id);
    const ps = pieceStickers(idx, n);
    pieceRep.set(idx, Math.min(...ps));
    for (const s of ps) pieceSet[s] = 1;
  }

  // 挿入: 1 手、または X Y X'（X と Y は別の軸）
  const insertions: Move[][] = insMoves.map((m) => [m]);
  for (const x of insMoves)
    for (const y of insMoves) {
      if (x.axis === y.axis) continue;
      const xi = insMoves.find((m) => m.token === x.token && m.amount === (x.amount === 2 ? 2 : -x.amount))!;
      insertions.push([x, y, xi]);
    }
  const insMaps = insertions.map((s) => seqTo(s, count));
  const intMaps = intMoves.map((m) => m.to);

  // 純粋な 3-cycle になる交換子を集め、動く位置ごとに索引を作る
  const index = new Map<number, BaseComm[]>();
  const tryComm = (a: Move[], aMap: Int32Array, b: Move[], bMap: Int32Array) => {
    const aInv = invertMap(aMap);
    const bInv = invertMap(bMap);
    const map = compose(compose(compose(aMap, bMap), aInv), bInv);
    let moved = 0;
    for (let p = 0; p < count; p++) {
      if (map[p] !== p) {
        if (!pieceSet[p]) return;
        moved++;
        if (moved > 9) return;
      }
    }
    if (moved === 0) return;
    // スロットの 3-cycle になっているか
    const slots: number[] = [];
    for (const idx of slotOf.keys()) if (map[idx] !== idx) slots.push(idx);
    const pieces = new Set(slots.map((s) => pieceRep.get(s)));
    if (pieces.size !== 3) return;
    const comm: BaseComm = { a, b, map };
    for (const s of slots) {
      const list = index.get(s) ?? [];
      list.push(comm);
      index.set(s, list);
    }
  };
  for (let i = 0; i < insertions.length; i++)
    for (let j = 0; j < intMoves.length; j++) {
      const a = insertions[i];
      const b = [intMoves[j]];
      if (a.length === 1 && a[0].axis === b[0].axis) continue;
      // [U2, U2 M U2] のように挿入の外側と交換が同じ軸だと打ち消しが起きて読みにくい
      if (a.length === 3 && a[0].axis === b[0].axis) continue;
      tryComm(a, insMaps[i], b, intMaps[j]);
      tryComm(b, intMaps[j], a, insMaps[i]);
    }

  // セットアップ 0〜2 手
  const setups: Move[][] = [[]];
  for (const m of setupMoves) setups.push([m]);
  for (const m1 of setupMoves)
    for (const m2 of setupMoves) if (m1.axis !== m2.axis) setups.push([m1, m2]);

  const bufIdx = stickerIndex(pt, buffer, n);
  const result = new Map<string, Suggestion[]>();
  const worst = new Map<string, number>();
  for (const s of setups) {
    const sigma = seqTo(s, count);
    const sigmaInv = invertMap(sigma);
    const q = sigma[bufIdx];
    const comms = index.get(q);
    if (!comms) continue;
    const lastSetup = s[s.length - 1];
    for (const c of comms) {
      // セットアップの最後と交換子の最初が同じ軸だと打ち消しが起きる（[R: [R', …]] など）
      if (lastSetup && (c.a[0].axis === lastSetup.axis)) continue;
      const r = c.map[q];
      const s2 = c.map[r];
      if (c.map[s2] !== q) continue;
      const aId = slotOf.get(sigmaInv[r]);
      const bId = slotOf.get(sigmaInv[s2]);
      if (!aId || !bId) continue;
      const key = `${aId}|${bId}`;
      const all = cancel([...flat(s), ...flat(c.a), ...flat(c.b), ...inv(c.a), ...inv(c.b), ...inv(s)]);
      const score = all.length + weightOf(all) + (s.length ? 0.3 : 0);
      const list = result.get(key) ?? [];
      if (list.length >= limit && score >= (worst.get(key) ?? Infinity)) continue;
      const inner = `[${seqText(c.a)}, ${seqText(c.b)}]`;
      const alg = s.length ? `[${seqText(s)}: ${inner}]` : inner;
      if (list.some((x) => x.alg === alg)) continue;
      list.push({ alg, moves: all.length, score: Math.round(score * 10) / 10 });
      list.sort((x, y) => x.score - y.score || x.alg.length - y.alg.length);
      if (list.length > limit) list.length = limit;
      worst.set(key, list.length >= limit ? list[list.length - 1].score : Infinity);
      result.set(key, list);
    }
  }
  return result;
}

export type SuggestionTable = Record<string, Suggestion[]>;

export function suggestionsToObject(m: Map<string, Suggestion[]>): SuggestionTable {
  return Object.fromEntries(m);
}
