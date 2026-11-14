// BLDDB（https://blddb.net/ 、データは https://github.com/nbwzx/blddb ・GPL-3.0）の手順を、このアプリのケースに割り当てる。
// データはアプリに同梱せず、利用者のブラウザが GitHub（jsDelivr 経由）から直接読み込む。
// どのケースの手順かは、キーの文字ではなく「手順を実際にシミュレーターで回した結果」で決める（バッファだけキーから読む）。
import { applyMoves, solved } from '../cube/cube';
import { toBaseMoves } from '../cube/notation';
import { STICKER_IDS, stickerIndex, stickerName, type PieceType, type StickerId } from '../cube/pieces';
import { allPieceRefs, analyze, caseStateOf, checkSpecial, orderEdges, pieceRefId, specialKey, type SpecialCase, type TwistDir } from '../cube/special';
import { detectCase } from '../cube/verify';

export interface BlddbAlg {
  alg: string;
  /** この手順を使っている選手 */
  users: string[];
  /** パリティで入れ替わるエッジなどの補足 */
  note?: string;
}

/** キー: 3-cycle は algKey と同じ "pt|buffer|a|b"、パリティ等は specialKey */
export type BlddbTable = Record<string, BlddbAlg[]>;

export type BlddbCategory = 'corner' | 'edge' | 'parity' | 'flip' | 'ltct' | 'wing' | 'xcenter' | 'tcenter' | 'midge';

export const BLDDB_FILES: Record<BlddbCategory, string> = {
  corner: 'cornerManmade.json',
  edge: 'edgeManmade.json',
  parity: 'parityManmade.json',
  flip: 'flipsManmade.json',
  ltct: 'ltctManmade.json',
  wing: 'bigbld/wingManmade.json',
  xcenter: 'bigbld/xcenterManmade.json',
  tcenter: 'bigbld/tcenterManmade.json',
  midge: 'bigbld/midgeManmade.json',
};

export const BLDDB_SOURCES = [
  'https://cdn.jsdelivr.net/gh/nbwzx/blddb@v2/public/data/',
  'https://raw.githubusercontent.com/nbwzx/blddb/v2/public/data/',
];

// ---- BLDDB の標準の文字の振り方（Chichu）: 位置名 → 文字 ----
const POS3 = 'UBL UB UBR UL U UR UFL UF UFR LUB LU LUF LB L LF LDB LD LDF FUL FU FUR FL F FR FDL FD FDR RUF RU RUB RF R RB RDF RD RDB BUR BU BUL BR B BL BDR BD BDL DFL DF DFR DL D DR DBL DB DBR'.split(' ');
const CHICHU3 = 'DEGC GAAJEDCX TQLMBBLS QNJYKHIR ZZPSHFFY WTNPWIXK OOMR';
const POS5_FACE = (f: string, o: Record<string, string>) =>
  [
    `${f}${o.ul}`, `${f}${o.u}${o.l.toLowerCase()}`, `${f}${o.u}`, `${f}${o.u}${o.r.toLowerCase()}`, `${f}${o.ur}`,
    `${f}${o.l}${o.u.toLowerCase()}`, `${f}${(o.u + o.l).toLowerCase()}`, `${f}${o.u.toLowerCase()}`, `${f}${(o.u + o.r).toLowerCase()}`, `${f}${o.r}${o.u.toLowerCase()}`,
    `${f}${o.l}`, `${f}${o.l.toLowerCase()}`, f, `${f}${o.r.toLowerCase()}`, `${f}${o.r}`,
    `${f}${o.l}${o.d.toLowerCase()}`, `${f}${(o.d + o.l).toLowerCase()}`, `${f}${o.d.toLowerCase()}`, `${f}${(o.d + o.r).toLowerCase()}`, `${f}${o.r}${o.d.toLowerCase()}`,
    `${f}${o.dl}`, `${f}${o.d}${o.l.toLowerCase()}`, `${f}${o.d}`, `${f}${o.d}${o.r.toLowerCase()}`, `${f}${o.dr}`,
  ];
// BLDDB の 5x5 の位置名（各面を左上から右下へ）
const POS5 = [
  ...POS5_FACE('U', { u: 'B', d: 'F', l: 'L', r: 'R', ul: 'BL', ur: 'BR', dl: 'FL', dr: 'FR' }),
  ...POS5_FACE('L', { u: 'U', d: 'D', l: 'B', r: 'F', ul: 'UB', ur: 'UF', dl: 'DB', dr: 'DF' }),
  ...POS5_FACE('F', { u: 'U', d: 'D', l: 'L', r: 'R', ul: 'UL', ur: 'UR', dl: 'DL', dr: 'DR' }),
  ...POS5_FACE('R', { u: 'U', d: 'D', l: 'F', r: 'B', ul: 'UF', ur: 'UB', dl: 'DF', dr: 'DB' }),
  ...POS5_FACE('B', { u: 'U', d: 'D', l: 'R', r: 'L', ul: 'UR', ur: 'UL', dl: 'DR', dr: 'DL' }),
  ...POS5_FACE('D', { u: 'F', d: 'B', l: 'L', r: 'R', ul: 'FL', ur: 'FR', dl: 'BL', dr: 'BR' }),
];
const CHICHU5 =
  'DEE G DEGGCC GGCAAJ A AAJEDD C EDCTXX TTXQLM Q LLMBBB L BBLQSS QQSNJY N JJYKHH I KHIZRR ZZRZPS Z PPSHFF F HFFWYY WWYTNP T NNPWII X WIXOKK OOKOMR O MMR';

function nameKind(name: string): PieceType | 'midge' | null {
  const upper = name.replace(/[a-z]/g, '').length;
  const lower = name.length - upper;
  if (upper === 3 && lower === 0) return 'corner';
  if (upper === 2 && lower === 0) return 'edge';
  if (upper === 2 && lower === 1) return 'wing';
  if (upper === 1 && lower === 2) return 'xcenter';
  if (upper === 1 && lower === 1) return 'tcenter';
  return null;
}

const sortedKey = (s: string) => s[0] + s.slice(1).split('').sort().join('');

/** 位置名 → このアプリのスロット ID */
export function idFromBlddbName(pt: PieceType, name: string): StickerId | null {
  if (pt === 'corner' || pt === 'edge') {
    const want = sortedKey(name);
    return STICKER_IDS.find((id) => sortedKey(stickerName(pt, id)) === want) ?? null;
  }
  return STICKER_IDS.find((id) => stickerName(pt, id) === name) ?? null;
}

/** キーの 1 文字 → スロット ID（Chichu） */
export function letterToId(pt: PieceType, letter: string, big = false): StickerId | null {
  const pos = big ? POS5 : POS3;
  const scheme = big ? CHICHU5 : CHICHU3;
  for (let i = 0; i < pos.length; i++) {
    if (scheme[i] !== letter) continue;
    if (nameKind(pos[i]) !== pt) continue;
    const id = idFromBlddbName(pt, pos[i]);
    if (id) return id;
  }
  return null;
}

/** 4BLD・5BLD の表記: 小文字 1 文字（r, l, u…）は内側の 1 層だけ → 2R などに直す */
export function bigNotation(alg: string): string {
  return alg
    .replace(/(^|[^0-9A-Za-z])([rludfb])(?![w])/g, (_, pre: string, m: string) => `${pre}2${m.toUpperCase()}`)
    .replace(/(^|[^0-9A-Za-z])([mes])(?![w])/g, (_, pre: string, m: string) => `${pre}${m.toUpperCase()}`);
}

interface RawEntry {
  algs: string[];
  users: string[];
}

/** BLDDB の 1 ケース分を共通の形に（3x3 は [[手順…], [選手…]]、4/5BLD は [手順, [選手…], 交換子?]） */
function entriesOf(raw: unknown): RawEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RawEntry[] = [];
  for (const e of raw) {
    if (!Array.isArray(e)) continue;
    if (Array.isArray(e[0])) out.push({ algs: (e[0] as unknown[]).filter((x): x is string => typeof x === 'string'), users: Array.isArray(e[1]) ? (e[1] as string[]) : [] });
    else if (typeof e[0] === 'string') {
      const algs = [e[0] as string];
      if (typeof e[2] === 'string') algs.push(e[2] as string);
      out.push({ algs, users: Array.isArray(e[1]) ? (e[1] as string[]) : [] });
    }
  }
  return out;
}

function effect(alg: string, n: number) {
  try {
    return applyMoves(solved(n), n, toBaseMoves(alg, n));
  } catch {
    return null;
  }
}

function push(table: BlddbTable, key: string, item: BlddbAlg, limit: number) {
  const list = (table[key] ??= []);
  if (list.some((x) => x.alg === item.alg)) return;
  list.push(item);
  list.sort((a, b) => b.users.length - a.users.length);
  if (list.length > limit) list.length = limit;
}

export interface ProcessResult {
  table: BlddbTable;
  total: number;
  assigned: number;
}

/** BLDDB の JSON（1 ファイル分）をこのアプリのケースに割り当てる */
export function processBlddb(category: BlddbCategory, json: Record<string, unknown>, limit = 8): ProcessResult {
  const table: BlddbTable = {};
  let total = 0;
  let assigned = 0;
  const big = category === 'wing' || category === 'xcenter' || category === 'tcenter' || category === 'midge';
  const pt: PieceType = category === 'midge' ? 'edge' : (['corner', 'edge', 'wing', 'xcenter', 'tcenter'].includes(category) ? category : 'corner') as PieceType;
  const n = big ? 5 : 3;

  for (const [key, raw] of Object.entries(json)) {
    const entries = entriesOf(raw);
    for (const e of entries) {
      total++;
      let done = false;
      for (const original of e.algs) {
        if (done) break;
        const candidates = big ? [bigNotation(original), original] : [original];
        for (const alg of candidates) {
          const key2 = assign(category, pt, n, key, alg, big);
          if (key2) {
            push(table, key2.key, { alg, users: e.users, note: key2.note }, limit);
            assigned++;
            done = true;
            break;
          }
        }
      }
    }
  }
  return { table, total, assigned };
}

function assign(category: BlddbCategory, pt: PieceType, n: number, key: string, alg: string, big: boolean): { key: string; note?: string } | null {
  if (category === 'flip') {
    const st = effect(alg, 3);
    if (!st) return null;
    const cs = caseStateOf(st);
    if (!cs) return null;
    const a = analyze(cs);
    const flipped = a.edges.map((s, i) => ({ s, i })).filter(({ s, i }) => s.piece === i && s.twist === 1);
    if (flipped.length !== 2) return null;
    const refs = edgeRefs();
    const [x, y] = orderEdges(refs[flipped[0].i], refs[flipped[1].i]);
    const c: SpecialCase = { kind: 'flip', a: x, b: y };
    return checkSpecial(c, alg).ok ? { key: specialKey(c) } : null;
  }
  if (category === 'parity' || category === 'ltct') {
    const buffer = letterToId('corner', category === 'parity' ? key[2] : key[0]);
    if (!buffer) return null;
    const st = effect(alg, 3);
    if (!st) return null;
    const cs = caseStateOf(st);
    if (!cs) return null;
    const bufIdx = stickerIndex('corner', buffer, 3);
    const target = STICKER_IDS.find((id) => stickerIndex('corner', id, 3) === cs[bufIdx]);
    if (!target) return null;
    if (category === 'parity') {
      const c: SpecialCase = { kind: 'parity', buffer, target };
      const r = checkSpecial(c, alg);
      return r.ok ? { key: specialKey(c), note: r.swap ? `エッジ ${r.swap}` : undefined } : null;
    }
    const a = analyze(cs);
    const refs = cornerRefs();
    for (let i = 0; i < a.corners.length; i++) {
      const s = a.corners[i];
      if (s.piece !== i || s.twist === 0) continue;
      const twisted = refs[i];
      if (pieceRefId('corner', twisted) === pieceRefId('corner', buffer) || pieceRefId('corner', twisted) === pieceRefId('corner', target)) continue;
      const dir: TwistDir = s.twist === 2 ? 'cw' : 'ccw';
      const c: SpecialCase = { kind: 'ltct', buffer, target, twisted, dir };
      const r = checkSpecial(c, alg);
      if (r.ok) return { key: specialKey(c), note: r.swap ? `エッジ ${r.swap}` : undefined };
    }
    return null;
  }
  // 3-style
  const buffer = letterToId(pt, key[0], big);
  if (!buffer) return null;
  const st = effect(alg, n);
  if (!st) return null;
  const d = detectCase(pt, n, st, buffer);
  return d ? { key: `${pt}|${buffer}|${d[0]}|${d[1]}` } : null;
}

// analyze() のパーツ番号順の代表ステッカー
const edgeRefs = () => allPieceRefs('edge');
const cornerRefs = () => allPieceRefs('corner');
