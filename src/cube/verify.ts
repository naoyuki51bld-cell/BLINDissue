// 手順が「バッファ → A → B」の 3-cycle になっているかを確認する
import { applyMoves, colors, solved, wholeCubeRotations, type CubeState } from './cube';
import { ParseError, toBaseMoves } from './notation';
import { isValidSize, pieceStickers, stickerIndex, STICKER_IDS, type PieceType, type StickerId } from './pieces';

export type VerifyResult =
  | { kind: 'ok'; rotation: boolean }
  | { kind: 'mismatch'; detected: [StickerId, StickerId] | null; changed: number }
  | { kind: 'error'; message: string }
  | { kind: 'empty' };

const rotationCache = new Map<number, CubeState[]>();

/** 解いた状態から 24 通り持ち替えた状態 */
function rotatedSolved(n: number): CubeState[] {
  let r = rotationCache.get(n);
  if (!r) {
    r = wholeCubeRotations(n).map((seq) => applyMoves(solved(n), n, seq));
    rotationCache.set(n, r);
  }
  return r;
}

/** 最後に持ち替えが残っていれば打ち消した状態の候補を返す */
function normalizations(state: CubeState, n: number): { state: CubeState; rotated: boolean }[] {
  return rotatedSolved(n).map((rot, i) => {
    // state のあとに rot の逆を適用 = 位置 p にある中身を rot^-1 で並べ替える
    // rot[p] = 元の位置 → 持ち替えで p に来たステッカー。逆変換: out[rot[p]] = state[p]
    if (i === 0) return { state, rotated: false };
    const out = new Int32Array(state.length);
    for (let p = 0; p < state.length; p++) out[rot[p]] = state[p];
    return { state: out, rotated: true };
  });
}

export function expectedColors(pt: PieceType, n: number, buffer: StickerId, a: StickerId, b: StickerId): Uint8Array {
  const base = colors(solved(n), n);
  const out = base.slice();
  const buf = pieceStickers(stickerIndex(pt, buffer, n), n);
  const pa = pieceStickers(stickerIndex(pt, a, n), n);
  const pb = pieceStickers(stickerIndex(pt, b, n), n);
  for (let i = 0; i < buf.length; i++) {
    out[pa[i]] = base[buf[i]];
    out[pb[i]] = base[pa[i]];
    out[buf[i]] = base[pb[i]];
  }
  return out;
}

function sameColors(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 手順がどのケースを解くか（バッファを含む純粋な 3-cycle の場合） */
export function detectCase(pt: PieceType, n: number, state: CubeState, buffer: StickerId): [StickerId, StickerId] | null {
  const bufIdx = stickerIndex(pt, buffer, n);
  const slotByIndex = new Map(STICKER_IDS.map((id) => [stickerIndex(pt, id, n), id]));
  for (const { state: s } of normalizations(state, n)) {
    const posOf = (orig: number) => s.indexOf(orig);
    const aIdx = posOf(bufIdx);
    if (aIdx === bufIdx) continue;
    const bIdx = posOf(aIdx);
    if (posOf(bIdx) !== bufIdx) continue;
    const a = slotByIndex.get(aIdx);
    const b = slotByIndex.get(bIdx);
    if (!a || !b) continue;
    // 3 パーツ以外が動いていないか
    const allowed = new Set([...pieceStickers(bufIdx, n), ...pieceStickers(aIdx, n), ...pieceStickers(bIdx, n)]);
    let clean = true;
    for (let p = 0; p < s.length; p++) if (s[p] !== p && !allowed.has(p)) clean = false;
    if (clean) return [a, b];
  }
  return null;
}

export function verifyAlg(
  pt: PieceType,
  n: number,
  text: string,
  buffer: StickerId,
  a: StickerId,
  b: StickerId,
): VerifyResult {
  if (!text.trim()) return { kind: 'empty' };
  if (!isValidSize(pt, n)) return { kind: 'error', message: `${n}x${n} では確認できません` };
  let state: CubeState;
  try {
    state = applyMoves(solved(n), n, toBaseMoves(text, n));
  } catch (e) {
    return { kind: 'error', message: e instanceof ParseError ? e.message : String(e) };
  }
  return verifyState(pt, n, state, buffer, a, b);
}

/** 揃った状態からの変化 state が「バッファ → A → B」の 3-cycle か */
export function verifyState(
  pt: PieceType,
  n: number,
  state: CubeState,
  buffer: StickerId,
  a: StickerId,
  b: StickerId,
): VerifyResult {
  const expected = expectedColors(pt, n, buffer, a, b);
  for (const { state: s, rotated } of normalizations(state, n)) {
    if (sameColors(colors(s, n), expected)) return { kind: 'ok', rotation: rotated };
  }
  let changed = 0;
  for (let p = 0; p < state.length; p++) if (state[p] !== p) changed++;
  return { kind: 'mismatch', detected: detectCase(pt, n, state, buffer), changed };
}

export function stateAfter(text: string, n: number): CubeState | null {
  try {
    return applyMoves(solved(n), n, toBaseMoves(text, n));
  } catch {
    return null;
  }
}
