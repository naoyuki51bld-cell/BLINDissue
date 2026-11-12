// Elliott's "Full Floating & More" の手順表（エッジ 10 バッファ・コーナー 6 バッファ）。
// 元の表は「制限なく使ってよい（コピー・改変・公開・配布可）」と明記されている。
import { STICKER_IDS, stickerName, type PieceType, type StickerId } from '../cube/pieces';
import { bracketize } from '../cube/notation';

export interface ElliottData {
  source: string;
  edge: Record<string, Record<string, Record<string, string>>>;
  corner: Record<string, Record<string, Record<string, string>>>;
  /** パリティ: バッファ → 最後のターゲット → 手順 */
  parity?: Record<string, Record<string, string>>;
  /** フリップ: エッジ → エッジ → 手順 */
  flip?: Record<string, Record<string, string>>;
}

export const ELLIOTT_NAME = 'Elliott';

let promise: Promise<ElliottData> | null = null;
export function loadElliott(): Promise<ElliottData> {
  if (!promise) promise = import('./elliott.json').then((m) => (m.default ?? m) as ElliottData);
  return promise;
}

/** 位置名（UFR・RUB・RBU など文字の順番違いも可）→ スロット ID */
export function idFromName(pt: PieceType, name: string): StickerId | null {
  const key = (s: string) => s[0] + s.slice(1).split('').sort().join('');
  const want = key(name.trim().toUpperCase());
  for (const id of STICKER_IDS) if (key(stickerName(pt, id).toUpperCase()) === want) return id;
  return null;
}

export type ElliottPt = 'corner' | 'edge';

/** そのバッファの手順表（キー "A|B"、値は括弧付きに直した手順）。表に無いバッファなら null */
export function elliottTable(data: ElliottData, pt: PieceType, buffer: StickerId): Record<string, string> | null {
  if (pt !== 'corner' && pt !== 'edge') return null;
  const sheets = data[pt];
  const sheetName = Object.keys(sheets).find((n) => idFromName(pt, n) === buffer);
  if (!sheetName) return null;
  // この表は「上の行 = 1 文字目、左の列 = 2 文字目」の並び（全手順をシミュレーターで確認済み）
  const out: Record<string, string> = {};
  for (const [rowName, row] of Object.entries(sheets[sheetName])) {
    const second = idFromName(pt, rowName);
    if (!second) continue;
    for (const [colName, alg] of Object.entries(row)) {
      const first = idFromName(pt, colName);
      if (first) out[`${first}|${second}`] = bracketize(alg);
    }
  }
  return out;
}

/** 手順表があるバッファ（スロット ID） */
export function elliottBuffers(data: ElliottData, pt: PieceType): StickerId[] {
  if (pt !== 'corner' && pt !== 'edge') return [];
  return Object.keys(data[pt])
    .map((n) => idFromName(pt, n))
    .filter((x): x is StickerId => !!x);
}

/** パリティの手順（キー: "バッファ|ターゲット"） */
export function elliottParity(data: ElliottData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [bufName, rows] of Object.entries(data.parity ?? {})) {
    const buf = idFromName('corner', bufName);
    if (!buf) continue;
    for (const [tName, alg] of Object.entries(rows)) {
      const t = idFromName('corner', tName);
      if (t) out[`${buf}|${t}`] = bracketize(alg);
    }
  }
  return out;
}

/** フリップの手順（キー: 代表ステッカー 2 つを並べ替えた "A|B"） */
export function elliottFlips(data: ElliottData, refOf: (id: StickerId) => StickerId, order: (a: StickerId, b: StickerId) => [StickerId, StickerId]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [aName, row] of Object.entries(data.flip ?? {})) {
    const a = idFromName('edge', aName);
    if (!a) continue;
    for (const [bName, alg] of Object.entries(row)) {
      const b = idFromName('edge', bName);
      if (!b) continue;
      const [x, y] = order(refOf(a), refOf(b));
      out[`${x}|${y}`] = bracketize(alg);
    }
  }
  return out;
}
