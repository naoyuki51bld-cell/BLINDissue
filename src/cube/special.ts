// パリティ・フリップ・LTCT（3x3）の手順の判定。
// 手順を揃った状態から回した結果の「逆」＝ その手順で解ける崩れ方（ケースの状態）を作り、
// コーナー・エッジの位置と向きを調べる。
import { applyMoves, FACES, geometry, solved, wholeCubeRotations, type CubeState } from './cube';
import { ParseError, toBaseMoves } from './notation';
import { pieceStickers, stickerIndex, stickerName, STICKER_IDS, type StickerId } from './pieces';

const N = 3;

export type TwistDir = 'cw' | 'ccw';
export const TWIST_LABEL: Record<TwistDir, string> = { cw: '時計回り', ccw: '反時計回り' };

interface PieceInfo {
  /** 向きの基準ステッカー（U/D 面、なければ F/B 面）から並べた位置 */
  stickers: number[];
}

const FACE_PRIORITY: Record<string, number> = { U: 0, D: 0, F: 1, B: 1, L: 2, R: 2 };

let pieceCache: { corners: PieceInfo[]; edges: PieceInfo[]; pieceOf: Map<number, { kind: 'corner' | 'edge'; i: number }> } | null = null;

function pieces() {
  if (pieceCache) return pieceCache;
  const g = geometry(N);
  const corners: PieceInfo[] = [];
  const edges: PieceInfo[] = [];
  const pieceOf = new Map<number, { kind: 'corner' | 'edge'; i: number }>();
  const seen = new Set<number>();
  const faceOf = (idx: number) => FACES[Math.floor(idx / 9)];
  for (let idx = 0; idx < g.count; idx++) {
    if (seen.has(idx) || idx % 9 === 4) continue;
    const group = pieceStickers(idx, N);
    group.forEach((s) => seen.add(s));
    // 向きの基準ステッカーを先頭に（コーナーは反時計回りの順を保つ）
    const ref = group.reduce((best, s) => (FACE_PRIORITY[faceOf(s)] < FACE_PRIORITY[faceOf(best)] ? s : best), group[0]);
    const ordered = pieceStickers(ref, N);
    const list = ordered.length === 3 ? corners : edges;
    list.push({ stickers: ordered });
    ordered.forEach((s) => pieceOf.set(s, { kind: ordered.length === 3 ? 'corner' : 'edge', i: list.length - 1 }));
  }
  pieceCache = { corners, edges, pieceOf };
  return pieceCache;
}

let rotatedCache: CubeState[] | null = null;

/** 持ち替えを打ち消してセンターを揃え、ケースの状態（手順の逆）を返す */
export function caseStateOf(effect: CubeState): CubeState | null {
  if (!rotatedCache) rotatedCache = wholeCubeRotations(N).map((seq) => applyMoves(solved(N), N, seq));
  for (const rot of rotatedCache) {
    const out = new Int32Array(effect.length);
    for (let p = 0; p < effect.length; p++) out[rot[p]] = effect[p];
    let centersOk = true;
    for (let f = 0; f < 6; f++) if (out[f * 9 + 4] !== f * 9 + 4) centersOk = false;
    if (!centersOk) continue;
    const inv = new Int32Array(out.length);
    for (let p = 0; p < out.length; p++) inv[out[p]] = p;
    return inv;
  }
  return null;
}

interface SlotState {
  /** その位置にあるパーツ（番号） */
  piece: number;
  /** 向き: 0 = 正しい、コーナーは 1 = 反時計回り / 2 = 時計回り、エッジは 1 = 反転 */
  twist: number;
}

export interface Analysis {
  corners: SlotState[];
  edges: SlotState[];
}

export function analyze(caseState: CubeState): Analysis {
  const { corners, edges, pieceOf } = pieces();
  const slot = (p: PieceInfo): SlotState => {
    const content = caseState[p.stickers[0]];
    const piece = pieceOf.get(content)!.i;
    const list = p.stickers.length === 3 ? corners : edges;
    const ref = list[piece].stickers[0];
    const twist = p.stickers.findIndex((s) => caseState[s] === ref);
    return { piece, twist };
  };
  return { corners: corners.map(slot), edges: edges.map(slot) };
}

function pieceIndex(kind: 'corner' | 'edge', id: StickerId): number {
  const idx = stickerIndex(kind, id, N);
  return pieces().pieceOf.get(idx)!.i;
}

function pieceName(kind: 'corner' | 'edge', i: number): string {
  const ref = (kind === 'corner' ? pieces().corners : pieces().edges)[i].stickers[0];
  const id = STICKER_IDS.find((x) => stickerIndex(kind, x, N) === ref)!;
  return stickerName(kind, id);
}

/** 代表ステッカー（U/D → F/B の面）のスロット ID。フリップやひねりのケース名に使う */
export function pieceRefId(kind: 'corner' | 'edge', id: StickerId): StickerId {
  const i = pieceIndex(kind, id);
  const ref = (kind === 'corner' ? pieces().corners : pieces().edges)[i].stickers[0];
  return STICKER_IDS.find((x) => stickerIndex(kind, x, N) === ref)!;
}

export function allPieceRefs(kind: 'corner' | 'edge'): StickerId[] {
  const list = kind === 'corner' ? pieces().corners : pieces().edges;
  return list.map((p) => STICKER_IDS.find((x) => stickerIndex(kind, x, N) === p.stickers[0])!);
}

/** ケースの状態を日本語で説明（揃っていないところだけ） */
export function describe(a: Analysis): string {
  const parts: string[] = [];
  const cyc = (kind: 'corner' | 'edge', list: SlotState[]) => {
    const done = new Set<number>();
    list.forEach((s, i) => {
      if (done.has(i)) return;
      if (s.piece === i) {
        if (s.twist !== 0)
          parts.push(
            kind === 'corner'
              ? `${pieceName(kind, i)} ${s.twist === 2 ? '時計回り' : '反時計回り'}にねじれ`
              : `${pieceName(kind, i)} 反転`,
          );
        return;
      }
      const cycle: number[] = [];
      let j = i;
      while (!done.has(j)) {
        done.add(j);
        cycle.push(j);
        j = list[j].piece;
      }
      parts.push(`${cycle.map((x) => pieceName(kind, x)).join('→')} の${cycle.length === 2 ? '交換' : '巡回'}`);
    });
  };
  cyc('corner', a.corners);
  cyc('edge', a.edges);
  return parts.length ? parts.join('、') : '何も変わらない';
}

export type SpecialCheck = { ok: true; swap?: string } | { ok: false; message: string };

function effectOf(alg: string): CubeState | string {
  try {
    return applyMoves(solved(N), N, toBaseMoves(alg, N));
  } catch (e) {
    return e instanceof ParseError ? e.message : String(e);
  }
}

/**
 * エッジがちょうど 1 組だけ入れ替わっているか。入れ替わりの名前を返す。
 * 向きそのままの交換（UF⇔UR）のほか、向きを変える交換（UF⇔RU のようにステッカー同士がずれる）も認める。
 */
function singleEdgeSwap(a: Analysis): string | null {
  const moved = a.edges.map((s, i) => ({ s, i })).filter(({ s, i }) => s.piece !== i || s.twist !== 0);
  if (moved.length !== 2) return null;
  const [x, y] = moved;
  if (x.s.piece !== y.i || y.s.piece !== x.i || x.s.twist !== y.s.twist) return null;
  const nx = pieceName('edge', x.i);
  const ny = pieceName('edge', y.i);
  return x.s.twist === 0 ? `${nx}⇔${ny}` : `${nx}⇔${ny[1]}${ny[0]}`;
}

function checkWith(alg: string, test: (cs: CubeState, a: Analysis) => SpecialCheck): SpecialCheck {
  if (!alg.trim()) return { ok: false, message: '手順が空です' };
  const eff = effectOf(alg);
  if (typeof eff === 'string') return { ok: false, message: eff };
  return checkState(eff, test);
}

function checkState(eff: CubeState, test: (cs: CubeState, a: Analysis) => SpecialCheck): SpecialCheck {
  const cs = caseStateOf(eff);
  if (!cs) return { ok: false, message: 'センターがずれたままです' };
  const a = analyze(cs);
  const r = test(cs, a);
  if (r.ok) return r;
  return { ok: false, message: `${r.message}（この手順で解けるのは: ${describe(a)}）` };
}

export type SpecialKind = 'parity' | 'flip' | 'ltct';
export const SPECIAL_LABEL: Record<SpecialKind, string> = { parity: 'パリティ', flip: 'フリップ', ltct: 'LTCT' };

export interface ParityCase {
  kind: 'parity';
  buffer: StickerId; // コーナーのバッファ
  target: StickerId; // 最後のコーナーのターゲット
}
export interface FlipCase {
  kind: 'flip';
  a: StickerId; // エッジ（代表ステッカー）
  b: StickerId;
}
export interface LtctCase {
  kind: 'ltct';
  buffer: StickerId;
  target: StickerId;
  twisted: StickerId; // ねじれているコーナー（代表ステッカー）
  dir: TwistDir;
}
export type SpecialCase = ParityCase | FlipCase | LtctCase;

export function specialTest(c: SpecialCase): (cs: CubeState, a: Analysis) => SpecialCheck {
  return (cs, a) => {
    if (c.kind === 'flip') {
      const ia = pieceIndex('edge', c.a);
      const ib = pieceIndex('edge', c.b);
      const cornersOk = a.corners.every((s, i) => s.piece === i && s.twist === 0);
      const edgesOk = a.edges.every((s, i) => s.piece === i && s.twist === (i === ia || i === ib ? 1 : 0));
      return cornersOk && edgesOk ? { ok: true } : { ok: false, message: 'このケースのフリップになっていません' };
    }
    const bIdx = stickerIndex('corner', c.buffer, N);
    const tIdx = stickerIndex('corner', c.target, N);
    const ib = pieceIndex('corner', c.buffer);
    const itarget = pieceIndex('corner', c.target);
    if (cs[bIdx] !== tIdx) return { ok: false, message: 'バッファのコーナーが最後のターゲットに入りません' };
    const swap = singleEdgeSwap(a);
    if (!swap) return { ok: false, message: 'エッジの入れ替えが 1 組になっていません' };
    if (c.kind === 'parity') {
      if (cs[tIdx] !== bIdx) return { ok: false, message: 'コーナーの交換で向きがずれています' };
      const others = a.corners.every((s, i) => i === ib || i === itarget || (s.piece === i && s.twist === 0));
      return others ? { ok: true, swap } : { ok: false, message: 'ほかのコーナーも動いています' };
    }
    const it = pieceIndex('corner', c.twisted);
    const want = c.dir === 'cw' ? 2 : 1;
    if (a.corners[itarget].piece !== ib) return { ok: false, message: 'コーナーの交換になっていません' };
    if (a.corners[it].piece !== it || a.corners[it].twist !== want)
      return { ok: false, message: `${pieceName('corner', it)} が${TWIST_LABEL[c.dir]}のねじれになっていません` };
    const others = a.corners.every((s, i) => i === ib || i === itarget || i === it || (s.piece === i && s.twist === 0));
    return others ? { ok: true, swap } : { ok: false, message: 'ほかのコーナーも動いています' };
  };
}

export function checkSpecial(c: SpecialCase, alg: string): SpecialCheck {
  return checkWith(alg, specialTest(c));
}

export function checkSpecialState(c: SpecialCase, effect: CubeState): SpecialCheck {
  return checkState(effect, specialTest(c));
}

/** 手順で解けるケースの説明（記号エラーなら null） */
export function describeAlg(alg: string): string | null {
  const eff = effectOf(alg);
  if (typeof eff === 'string') return null;
  const cs = caseStateOf(eff);
  return cs ? describe(analyze(cs)) : null;
}

// ---- ケースの一覧とキー ----

export function specialKey(c: SpecialCase): string {
  switch (c.kind) {
    case 'parity':
      return `parity|${c.buffer}|${c.target}`;
    case 'flip':
      return `flip|${c.a}|${c.b}`;
    case 'ltct':
      return `ltct|${c.buffer}|${c.target}|${c.twisted}|${c.dir}`;
  }
}

export function parseSpecialKey(k: string): SpecialCase | null {
  const p = k.split('|');
  if (p[0] === 'parity') return { kind: 'parity', buffer: p[1], target: p[2] };
  if (p[0] === 'flip') return { kind: 'flip', a: p[1], b: p[2] };
  if (p[0] === 'ltct') return { kind: 'ltct', buffer: p[1], target: p[2], twisted: p[3], dir: p[4] as TwistDir };
  return null;
}

const sameCorner = (x: StickerId, y: StickerId) => pieceIndex('corner', x) === pieceIndex('corner', y);

export function parityCases(buffer: StickerId): ParityCase[] {
  return STICKER_IDS.filter((t) => !sameCorner(t, buffer)).map((target) => ({ kind: 'parity', buffer, target }));
}

/** フリップのケースの 2 つのエッジを決まった順に並べる */
export function orderEdges(a: StickerId, b: StickerId): [StickerId, StickerId] {
  const refs = allPieceRefs('edge');
  const ra = pieceRefId('edge', a);
  const rb = pieceRefId('edge', b);
  return refs.indexOf(ra) <= refs.indexOf(rb) ? [ra, rb] : [rb, ra];
}

export function flipCases(): FlipCase[] {
  const refs = allPieceRefs('edge');
  const out: FlipCase[] = [];
  for (let i = 0; i < refs.length; i++) for (let j = i + 1; j < refs.length; j++) out.push({ kind: 'flip', a: refs[i], b: refs[j] });
  return out;
}

export function ltctCases(buffer: StickerId): LtctCase[] {
  const out: LtctCase[] = [];
  const twistable = allPieceRefs('corner');
  for (const target of STICKER_IDS) {
    if (sameCorner(target, buffer)) continue;
    for (const twisted of twistable) {
      if (sameCorner(twisted, buffer) || sameCorner(twisted, target)) continue;
      for (const dir of ['cw', 'ccw'] as TwistDir[]) out.push({ kind: 'ltct', buffer, target, twisted, dir });
    }
  }
  return out;
}

export { pieceName };
