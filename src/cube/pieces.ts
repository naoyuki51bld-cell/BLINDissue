// BLD で扱うパーツの種類と、各種類の 24 個のターゲット位置（スロット）。
// スロット ID は「面 + 番号(0-3)」。番号は面を時計回りに見た順（Speffz と同じ並び）。
import { FACES, type Face, geometry, cubieOf, type Vec3 } from './cube';

export type PieceType = 'corner' | 'edge' | 'wing' | 'xcenter' | 'tcenter';
export const PIECE_TYPES: PieceType[] = ['corner', 'edge', 'wing', 'xcenter', 'tcenter'];

export const PIECE_LABEL: Record<PieceType, string> = {
  corner: 'コーナー',
  edge: 'エッジ',
  wing: 'ウイング',
  xcenter: 'Xセンター',
  tcenter: '+センター',
};

export const PIECE_EVENTS: Record<PieceType, string> = {
  corner: '3BLD〜5BLD・MBLD',
  edge: '3BLD・5BLD・MBLD',
  wing: '4BLD・5BLD',
  xcenter: '4BLD・5BLD',
  tcenter: '5BLD',
};

export type StickerId = string; // 例: "U2"

export const STICKER_IDS: StickerId[] = FACES.flatMap((f) => [0, 1, 2, 3].map((k) => `${f}${k}`));

export function isValidSize(pt: PieceType, n: number): boolean {
  switch (pt) {
    case 'corner':
      return n >= 2;
    case 'edge':
      return n >= 3 && n % 2 === 1;
    case 'wing':
    case 'xcenter':
      return n >= 4;
    case 'tcenter':
      return n >= 5 && n % 2 === 1;
  }
}

export const VALID_SIZES: Record<PieceType, number[]> = {
  corner: [3, 4, 5],
  edge: [3, 5],
  wing: [4, 5],
  xcenter: [4, 5],
  tcenter: [5],
};

export const DEFAULT_SIZE: Record<PieceType, number> = {
  corner: 3,
  edge: 3,
  wing: 4,
  xcenter: 4,
  tcenter: 5,
};

/** 面上の (row, col) */
export function slotRC(pt: PieceType, slot: number, n: number): [number, number] {
  const e = n - 1;
  const m = (n - 1) / 2;
  const table: Record<PieceType, [number, number][]> = {
    corner: [
      [0, 0],
      [0, e],
      [e, e],
      [e, 0],
    ],
    edge: [
      [0, m],
      [m, e],
      [e, m],
      [m, 0],
    ],
    wing: [
      [0, 1],
      [1, e],
      [e, e - 1],
      [e - 1, 0],
    ],
    xcenter: [
      [1, 1],
      [1, e - 1],
      [e - 1, e - 1],
      [e - 1, 1],
    ],
    tcenter: [
      [1, m],
      [m, e - 1],
      [e - 1, m],
      [m, 1],
    ],
  };
  return table[pt][slot];
}

export function parseStickerId(id: StickerId): { face: Face; slot: number } {
  return { face: id[0] as Face, slot: parseInt(id.slice(1), 10) };
}

export function stickerIndex(pt: PieceType, id: StickerId, n: number): number {
  const { face, slot } = parseStickerId(id);
  const [r, c] = slotRC(pt, slot, n);
  return FACES.indexOf(face) * n * n + r * n + c;
}

const DIRS: { axis: number; pos: string; neg: string }[] = [
  { axis: 1, pos: 'U', neg: 'D' },
  { axis: 2, pos: 'F', neg: 'B' },
  { axis: 0, pos: 'R', neg: 'L' },
];

/** 位置の名前（例: UFR, UF, UFr, Ubl, Ub） */
export function stickerName(pt: PieceType, id: StickerId): StickerId {
  const n = pt === 'tcenter' ? 5 : pt === 'corner' || pt === 'edge' ? 3 : 4;
  const g = geometry(n);
  const idx = stickerIndex(pt, id, n);
  const own = id[0];
  const p = g.pos[idx];
  const cub = cubieOf(p, n);
  const ownAxis = g.normal[idx].findIndex((v) => v !== 0);
  let upper = '';
  let lower = '';
  for (const d of DIRS) {
    if (d.axis === ownAxis) continue;
    const v = cub[d.axis];
    if (v === 0) continue;
    const letter = v > 0 ? d.pos : d.neg;
    if (Math.abs(v) === n - 1) upper += letter;
    else lower += letter.toLowerCase();
  }
  return own + upper + lower;
}

/** あるステッカーと同じパーツのステッカー（先頭が自身、コーナーは一定の回転順） */
export function pieceStickers(index: number, n: number): number[] {
  const g = geometry(n);
  const cub = cubieOf(g.pos[index], n);
  const same: number[] = [];
  for (let i = 0; i < g.count; i++) {
    const c = cubieOf(g.pos[i], n);
    if (c[0] === cub[0] && c[1] === cub[1] && c[2] === cub[2]) same.push(i);
  }
  if (same.length === 3) {
    const others = same.filter((i) => i !== index);
    const det = (a: Vec3, b: Vec3, c: Vec3) =>
      a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    const [o1, o2] = others;
    return det(g.normal[index], g.normal[o1], g.normal[o2]) > 0 ? [index, o1, o2] : [index, o2, o1];
  }
  return [index, ...same.filter((i) => i !== index)];
}

/** 2 つのスロットが同じパーツか */
export function samePiece(pt: PieceType, a: StickerId, b: StickerId): boolean {
  const n = DEFAULT_SIZE[pt];
  return pieceStickers(stickerIndex(pt, a, n), n).includes(stickerIndex(pt, b, n));
}

/** バッファ以外のターゲットのうち、バッファと同じパーツでないもの */
export function targetsFor(pt: PieceType, buffer: StickerId): StickerId[] {
  return STICKER_IDS.filter((id) => !samePiece(pt, id, buffer));
}

/** バッファに対する全ケース（first, second） */
export function casesFor(pt: PieceType, buffer: StickerId): [StickerId, StickerId][] {
  const t = targetsFor(pt, buffer);
  const out: [StickerId, StickerId][] = [];
  for (const a of t) for (const b of t) if (!samePiece(pt, a, b)) out.push([a, b]);
  return out;
}

export function faceIndexOfId(id: StickerId): number {
  return FACES.indexOf(id[0] as Face);
}
