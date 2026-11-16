// 3x3 の色の状態（スマートキューブの状態を追う・揃ったかを調べる・DNF の中身を調べる）
import { applyMoves, colors, cubieOf, FACES, geometry, movePermutation, solved, wholeCubeRotations, type CubeState, type Face } from '../cube/cube';
import { tokenToBaseMove } from '../cube/notation';
import { analyze, describe } from '../cube/special';
import type { FaceTurn, Grip } from '../smartcube/tracker';

export type Colors = Uint8Array; // 54 個、各ステッカーの面（0..5 = U L F R B D の色）

export function solvedColors(): Colors {
  return colors(solved(3), 3);
}

export function applyTurnColors(c: Colors, t: FaceTurn): Colors {
  const to = movePermutation(3, tokenToBaseMove(t.face, t.amount, 3));
  const out = new Uint8Array(54);
  for (let i = 0; i < 54; i++) out[to[i]] = c[i];
  return out;
}

export function applyAlgColors(c: Colors, alg: string): Colors {
  let out = c;
  for (const tok of alg.split(/\s+/).filter(Boolean)) {
    const m = /^([URFDLB])(2?)('?)$/.exec(tok);
    if (!m) continue;
    const q = m[2] ? 2 : 1;
    out = applyTurnColors(out, { face: m[1] as Face, amount: m[3] ? -q : q });
  }
  return out;
}

/** 向きに関係なく揃っているか（各面が 1 色） */
export function isSolvedColors(c: Colors): boolean {
  for (let f = 0; f < 6; f++) for (let i = 1; i < 9; i++) if (c[f * 9 + i] !== c[f * 9]) return false;
  return true;
}

export function sameColors(a: Colors, b: Colors): boolean {
  for (let i = 0; i < 54; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** GAN の FACELETS（Kociemba 形式 "UUU…RRR…FFF…DDD…LLL…BBB…"）→ このアプリの並び（U L F R B D） */
export function fromFacelets(f: string): Colors | null {
  if (f.length !== 54) return null;
  const order = 'URFDLB';
  const out = new Uint8Array(54);
  for (const face of FACES) {
    const src = order.indexOf(face) * 9;
    const dst = FACES.indexOf(face) * 9;
    for (let i = 0; i < 9; i++) {
      const color = FACES.indexOf(f[src + i] as Face);
      if (color < 0) return null;
      out[dst + i] = color;
    }
  }
  return out;
}

function gripRotation(grip: Grip) {
  for (const seq of wholeCubeRotations(3)) {
    const s = applyMoves(solved(3), 3, seq);
    const centerColor = (f: number) => Math.floor(s[f * 9 + 4] / 9);
    if (FACES[centerColor(0)] === grip.top && FACES[centerColor(2)] === grip.front) return seq;
  }
  return [];
}

function applyBase(c: Colors, moves: ReturnType<typeof gripRotation>): Colors {
  let out = c;
  for (const m of moves) {
    const to = movePermutation(3, m);
    const next = new Uint8Array(54);
    for (let i = 0; i < 54; i++) next[to[i]] = out[i];
    out = next;
  }
  return out;
}

/** 持ち方から見た色 → キューブ本来の向きの色（toGrip の逆） */
export function fromGrip(c: Colors, grip: Grip): Colors {
  if (grip.top === 'U' && grip.front === 'F') return c;
  const inv = gripRotation(grip)
    .slice()
    .reverse()
    .map((m) => ({ ...m, turns: -m.turns }));
  return applyBase(c, inv);
}

/** キューブ本来の向きの色 → 持ち方から見た色 */
export function toGrip(c: Colors, grip: Grip): Colors {
  if (grip.top === 'U' && grip.front === 'F') return c;
  for (const seq of wholeCubeRotations(3)) {
    const s = applyMoves(solved(3), 3, seq);
    const centerColor = (f: number) => Math.floor(s[f * 9 + 4] / 9);
    if (FACES[centerColor(0)] === grip.top && FACES[centerColor(2)] === grip.front) {
      let out = c;
      for (const m of seq) {
        const to = movePermutation(3, m);
        const next = new Uint8Array(54);
        for (let i = 0; i < 54; i++) next[to[i]] = out[i];
        out = next;
      }
      return out;
    }
  }
  return c;
}

// ---- 色 → パーツの並び（DNF の中身を調べるため） ----
let pieceCache: { stickers: number[] }[] | null = null;
function allPieces() {
  if (pieceCache) return pieceCache;
  const g = geometry(3);
  const groups = new Map<string, number[]>();
  for (let i = 0; i < 54; i++) {
    if (i % 9 === 4) continue;
    const k = cubieOf(g.pos[i], 3).join(',');
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  pieceCache = [...groups.values()].map((stickers) => ({ stickers }));
  return pieceCache;
}

/**
 * 色の状態をステッカーの並び（CubeState）に直す。
 * 各位置のパーツを色の組から特定する。センターは揃っている前提（持ち替えはしない）。
 */
export function colorsToState(c: Colors): CubeState | null {
  const pieces = allPieces();
  const home = solvedColors();
  // 解いた状態で、色の組 → パーツ
  const byColors = new Map<string, number[]>();
  for (const p of pieces) byColors.set(p.stickers.map((i) => home[i]).sort().join(''), p.stickers);
  const state = new Int32Array(54);
  for (let f = 0; f < 6; f++) state[f * 9 + 4] = f * 9 + 4;
  for (const p of pieces) {
    const key = p.stickers.map((i) => c[i]).sort().join('');
    const target = byColors.get(key);
    if (!target) return null;
    // 位置 p のステッカー i に、パーツ target のどのステッカーがあるか（色が一致するもの）
    for (const i of p.stickers) {
      const src = target.find((j) => home[j] === c[i]);
      if (src === undefined) return null;
      state[i] = src;
    }
  }
  return state;
}

/** 揃っていないときの説明（例: 「UF 反転、UFR→UBR→UBL の巡回」） */
export function describeUnsolved(c: Colors): string {
  if (isSolvedColors(c)) return '揃っています';
  const st = colorsToState(c);
  if (!st) return 'センターがずれているか、状態を読み取れませんでした';
  return describe(analyze(st));
}
