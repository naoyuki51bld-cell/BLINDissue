// スクランブルから「正解のメモ」を作り、実際に回した手順と比べてどこを間違えたかを調べる。
// 解く順番: エッジ → フリップ → コーナー → （LTCT / パリティ）→ ツイスト
import { applyMoves, solved, type CubeState } from '../cube/cube';
import { toBaseMoves } from '../cube/notation';
import { pieceStickers, samePiece, stickerIndex, stickerName, STICKER_IDS, type StickerId } from '../cube/pieces';
import { allPieceRefs, analyze, caseStateOf, checkSpecial, orderEdges, pieceRefId, specialKey, type SpecialCase, type TwistDir } from '../cube/special';
import type { Segment } from './types';

type Kind3 = 'corner' | 'edge';
const N = 3;

export interface MemoSettings {
  cornerBuffers: StickerId[];
  edgeBuffers: StickerId[];
  /** 登録してある手順（キー → メインの手順） */
  algOf: (key: string) => string | undefined;
  /** そのバッファの手順を 1 つでも登録してあるか（フローティングに使えるか） */
  hasBuffer: (pt: Kind3, buffer: StickerId) => boolean;
  label: (pt: Kind3, buffer: StickerId, a: StickerId, b: StickerId) => string;
  single: (pt: Kind3, id: StickerId) => string;
}

export interface ExpectedStep {
  kind: 'edge' | 'corner' | 'flip' | 'parity' | 'ltct' | 'twist';
  label: string;
  /** 3-style / パリティ等のキー（手順の記録と同じ形） */
  key?: string;
  /** 登録してある手順 */
  alg?: string;
  /** ねじれたコーナーを 3-style の組み合わせで解く手順 */
  twist?: boolean;
}

// ---- ステッカーとパーツ ----
const idxCache = new Map<string, number>();
const idxOf = (pt: Kind3, id: StickerId) => {
  const k = pt + id;
  let v = idxCache.get(k);
  if (v === undefined) idxCache.set(k, (v = stickerIndex(pt, id, N)));
  return v;
};
const idOf = (pt: Kind3, idx: number) => STICKER_IDS.find((id) => idxOf(pt, id) === idx)!;
const pieceCache = new Map<number, number[]>();
const piece = (idx: number) => {
  let v = pieceCache.get(idx);
  if (!v) pieceCache.set(idx, (v = pieceStickers(idx, N)));
  return v;
};

/** ステッカー o が最終的に行くべき位置（パリティの入れ替えを含む） */
type Home = (o: number) => number;
const identity: Home = (o) => o;

const repsCache: Partial<Record<Kind3, number[]>> = {};
function allPieceReps(pt: Kind3): number[] {
  return (repsCache[pt] ??= computeReps(pt));
}
function computeReps(pt: Kind3): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of STICKER_IDS) {
    const i = idxOf(pt, id);
    const rep = Math.min(...piece(i));
    if (!seen.has(rep)) {
      seen.add(rep);
      out.push(i);
    }
  }
  return out;
}

const pieceSolved = (C: CubeState, p: number, home: Home) => piece(p).every((x) => home(C[x]) === x);
/** その場で向きだけ違う（フリップ・ツイスト） */
function inPlaceMisoriented(C: CubeState, p: number, home: Home) {
  const pos = piece(p);
  const homes = pos.map((x) => home(C[x]));
  return !pieceSolved(C, p, home) && homes.every((h) => pos.includes(h));
}

/** 仮想の入れ替え: バッファにあるステッカーを位置 t へ（ほかのステッカーも向きをそろえて動く） */
function virtualSwap(C: CubeState, buf: number, t: number): CubeState {
  const out = C.slice() as CubeState;
  const bs = piece(buf);
  const ts = piece(t);
  for (let i = 0; i < bs.length; i++) {
    out[ts[i]] = C[bs[i]];
    out[bs[i]] = C[ts[i]];
  }
  return out;
}

interface TraceResult {
  segments: { buffer: StickerId; targets: StickerId[] }[];
  residual: CubeState;
}

/** メモを作る（向きだけ違うパーツは別の手順で解くので、サイクルブレイク先にしない） */
function trace(C0: CubeState, pt: Kind3, buffers: StickerId[], home: Home, settings: MemoSettings): TraceResult {
  let C = C0.slice() as CubeState;
  let bi = 0;
  const segs: TraceResult['segments'] = [{ buffer: buffers[0], targets: [] }];
  const reps = allPieceReps(pt);
  for (let guard = 0; guard < 80; guard++) {
    const buffer = buffers[bi];
    const bufIdx = idxOf(pt, buffer);
    const bufPiece = piece(bufIdx);
    const seg = segs[segs.length - 1];
    const h = home(C[bufIdx]);
    if (!bufPiece.includes(h)) {
      seg.targets.push(idOf(pt, h));
      C = virtualSwap(C, bufIdx, h);
      continue;
    }
    const earlier = buffers.slice(0, bi).map((b) => idxOf(pt, b));
    const unsolved = reps.filter(
      (p) => !bufPiece.includes(p) && !earlier.some((e) => piece(e).includes(p)) && !pieceSolved(C, p, home) && !inPlaceMisoriented(C, p, home),
    );
    if (!unsolved.length) break;
    // フローティング: 偶数個で区切りがよく、次のバッファの手順を登録してあり、そのパーツが未完成なら移る
    const next = buffers[bi + 1];
    if (next && seg.targets.length % 2 === 0 && settings.hasBuffer(pt, next) && unsolved.some((p) => piece(p).includes(idxOf(pt, next)))) {
      bi++;
      segs.push({ buffer: next, targets: [] });
      continue;
    }
    // サイクルブレイク: 番号の若いステッカーから
    const t = STICKER_IDS.map((id) => idxOf(pt, id)).find((i) => unsolved.some((p) => piece(p).includes(i)))!;
    seg.targets.push(idOf(pt, t));
    C = virtualSwap(C, bufIdx, t);
  }
  return { segments: segs, residual: C };
}

/** パリティ手順の「エッジ UF⇔UR / UF⇔RU」から、エッジの行き先を作る */
function parityHome(swap: string | undefined, edgeBuffer: StickerId): Home {
  let a: StickerId | undefined;
  let b: StickerId | undefined;
  if (swap) {
    const [x, y] = swap.replace(/^エッジ\s*/, '').split('⇔');
    a = STICKER_IDS.find((id) => stickerName('edge', id) === x);
    b = STICKER_IDS.find((id) => stickerName('edge', id) === y);
  }
  if (!a || !b) {
    // 登録が無いとき: バッファと UR（バッファが UR 側なら UL）の入れ替え
    a = edgeBuffer;
    b = ['U1', 'U3', 'U0'].find((x) => !samePiece('edge', x, edgeBuffer))!;
  }
  const xs = piece(idxOf('edge', a));
  const ys = piece(idxOf('edge', b));
  const map = new Map<number, number>();
  xs.forEach((x, i) => {
    map.set(x, ys[i]);
    map.set(ys[i], x);
  });
  return (o) => map.get(o) ?? o;
}

export interface Expected {
  steps: ExpectedStep[];
  /** 正解を作るときに使った、エッジのパリティの入れ替え（例: UF⇔UR） */
  paritySwap?: string;
  notes: string[];
}

function pairsOf(pt: Kind3, segs: TraceResult['segments'], settings: MemoSettings, notes: string[]): { steps: ExpectedStep[]; last?: { buffer: StickerId; target: StickerId } } {
  const steps: ExpectedStep[] = [];
  let last: { buffer: StickerId; target: StickerId } | undefined;
  segs.forEach((seg, si) => {
    for (let i = 0; i < seg.targets.length; i += 2) {
      const a = seg.targets[i];
      const b = seg.targets[i + 1];
      if (!b) {
        if (si === segs.length - 1) last = { buffer: seg.buffer, target: a };
        else notes.push(`${stickerName(pt, seg.buffer)} バッファで ${settings.single(pt, a)} が 1 つ余ります`);
        continue;
      }
      const key = `${pt}|${seg.buffer}|${a}|${b}`;
      steps.push({ kind: pt, label: settings.label(pt, seg.buffer, a, b), key, alg: settings.algOf(key) });
    }
  });
  return { steps, last };
}

const twistLabel = (ref: StickerId, dir: TwistDir) => `${stickerName('corner', ref)}${dir === 'cw' ? '↻' : '↺'}`;

/** スクランブル（持ち方から見た表記）から正解の解き方を作る */
export function expectedSolution(scramble: string, settings: MemoSettings): Expected {
  const S = applyMoves(solved(N), N, toBaseMoves(scramble, N));
  const notes: string[] = [];
  // コーナーを先に調べてパリティの有無と最後のターゲットを決める
  const ct = trace(S, 'corner', settings.cornerBuffers, identity, settings);
  const corner = pairsOf('corner', ct.segments, settings, notes);
  let paritySwap: string | undefined;
  let parityCase: SpecialCase | undefined;
  if (corner.last) {
    parityCase = { kind: 'parity', buffer: corner.last.buffer, target: corner.last.target };
    const alg = settings.algOf(specialKey(parityCase));
    if (alg) {
      const r = checkSpecial(parityCase, alg);
      if (r.ok) paritySwap = r.swap;
    }
  }
  const eHome = corner.last ? parityHome(paritySwap, settings.edgeBuffers[0]) : identity;
  const et = trace(S, 'edge', settings.edgeBuffers, eHome, settings);
  const edge = pairsOf('edge', et.segments, settings, notes);
  if (edge.last) notes.push(`エッジの最後のターゲット ${settings.single('edge', edge.last.target)} が余ります`);

  const steps: ExpectedStep[] = [...edge.steps];
  // フリップ: その場で反転しているエッジを 2 つずつ
  const flipped = allPieceReps('edge').filter((p) => inPlaceMisoriented(et.residual, p, eHome));
  const flippedIds = flipped.map((p) => idOf('edge', p));
  for (let i = 0; i + 1 < flippedIds.length; i += 2) {
    const ord = orderFlip(flippedIds[i], flippedIds[i + 1]);
    steps.push({ kind: 'flip', label: `フリップ ${stickerName('edge', ord.a)}・${stickerName('edge', ord.b)}`, key: specialKey(ord), alg: settings.algOf(specialKey(ord)) });
  }
  if (flippedIds.length % 2) notes.push('反転しているエッジが奇数個です');
  steps.push(...corner.steps);

  // 残り: コーナーのねじれ（とパリティ）
  const cs = caseStateOf(ct.residual);
  const twisted: { ref: StickerId; dir: TwistDir }[] = [];
  if (cs) {
    const a = analyze(cs);
    a.corners.forEach((s, i) => {
      if (s.piece === i && s.twist !== 0) twisted.push({ ref: cornerRefs()[i], dir: s.twist === 2 ? 'cw' : 'ccw' });
    });
  }
  let rest = twisted;
  if (corner.last) {
    const { buffer, target } = corner.last;
    // ねじれたコーナーがあり、LTCT の手順を登録してあれば LTCT
    const ltct = twisted
      .filter((t) => !samePiece('corner', t.ref, buffer) && !samePiece('corner', t.ref, target))
      .map((t) => ({ t, c: { kind: 'ltct', buffer, target, twisted: t.ref, dir: t.dir } as SpecialCase }))
      .find(({ c }) => settings.algOf(specialKey(c)));
    if (ltct) {
      steps.push({ kind: 'ltct', label: `LTCT ${settings.single('corner', target)} + ${twistLabel(ltct.t.ref, ltct.t.dir)}`, key: specialKey(ltct.c), alg: settings.algOf(specialKey(ltct.c)) });
      rest = twisted.filter((t) => t !== ltct.t);
    } else if (parityCase) {
      steps.push({ kind: 'parity', label: `パリティ ${settings.single('corner', target)}`, key: specialKey(parityCase), alg: settings.algOf(specialKey(parityCase)) });
    }
  }
  if (rest.length) {
    // ねじれを 3-style の組み合わせで解く（登録してある手順で、2〜3 個ずつ）
    let R = ct.residual.slice() as CubeState;
    const fixed = twisted.filter((t) => !rest.includes(t));
    for (const t of fixed) for (const x of piece(idxOf('corner', t.ref))) R[x] = x;
    const twistBuffers = settings.cornerBuffers.filter((b, i) => i === 0 || settings.hasBuffer('corner', b));
    const combos: ExpectedStep[] = [];
    for (;;) {
      const found = twistCombo(R, twistBuffers, settings);
      if (!found) break;
      R = found.state;
      for (const [buf, a, b] of found.pairs) {
        const key = `corner|${buf}|${a}|${b}`;
        combos.push({ kind: 'corner', label: `${settings.label('corner', buf, a, b)}（ツイスト）`, key, alg: settings.algOf(key), twist: true });
      }
    }
    steps.push(...combos);
    const left = rest.filter((t) => !pieceSolved(R, idxOf('corner', t.ref), identity));
    if (left.length) steps.push({ kind: 'twist', label: `ツイスト ${left.map((t) => twistLabel(t.ref, t.dir)).join(' ')}` });
  }
  return { steps, paritySwap, notes };
}

/** コーナーがねじれだけ（位置はすべて正しい）か。ねじれの数を返す（そうでなければ -1） */
function twistOnlyCount(C: CubeState): number {
  let n = 0;
  for (const p of allPieceReps('corner')) {
    if (pieceSolved(C, p, identity)) continue;
    if (!inPlaceMisoriented(C, p, identity)) return -1;
    n++;
  }
  return n;
}

/**
 * 登録してある 3-style を 2〜3 個組み合わせて、ねじれたコーナーを減らす。
 * 例: UFR↻ と UBL↺ → バッファから UFR に入って UBL の別の面から戻る 2 手順。
 * 「手順の数 + 残るねじれの数」が最も少ない組み合わせを選ぶ。
 */
const comboCache = new Map<string, ReturnType<typeof twistComboRaw>>();
function twistCombo(R: CubeState, buffers: StickerId[], settings: MemoSettings) {
  const key = `${buffers.join(',')}|${Array.from(R).join(',')}`;
  if (comboCache.has(key)) return comboCache.get(key)!;
  const r = twistComboRaw(R, buffers, settings);
  if (comboCache.size > 500) comboCache.clear();
  comboCache.set(key, r);
  return r;
}
function twistComboRaw(R: CubeState, buffers: StickerId[], settings: MemoSettings): { state: CubeState; pairs: [StickerId, StickerId, StickerId][] } | null {
  const count = twistOnlyCount(R);
  if (count <= 1) return null;
  const cs = caseStateOf(R);
  if (!cs || analyze(cs).corners.reduce((n, c) => n + c.twist, 0) % 3 !== 0) return null; // ねじれの合計が合わない
  const found: { best: { state: CubeState; pairs: [StickerId, StickerId, StickerId][]; score: number } | null } = { best: null };
  const done = (depth: number) => !!found.best && found.best.score <= depth;
  for (const depth of [2, 3]) {
    if (done(depth)) break; // これ以上よくならない
    for (const buf of buffers) {
      const bufIdx = idxOf('corner', buf);
      const bufPiece = piece(bufIdx);
      const twistedT = STICKER_IDS.filter((id) => {
        const i = idxOf('corner', id);
        return !bufPiece.includes(i) && !pieceSolved(R, i, identity);
      });
      // バッファ自体がねじれているときは、ほかのパーツを経由する
      const allT = STICKER_IDS.filter((id) => !bufPiece.includes(idxOf('corner', id)));
      const bufTwisted = !pieceSolved(R, bufIdx, identity);
      const tiers = depth === 2 ? (bufTwisted ? [twistedT, allT] : [twistedT]) : twistedT.length <= 9 ? [twistedT] : [];
      for (const targets of tiers) {
        const pairs: [StickerId, StickerId, StickerId][] = [];
        const options: [StickerId, StickerId][] = [];
        for (const a of targets) for (const b of targets) if (!samePiece('corner', a, b) && settings.algOf(`corner|${buf}|${a}|${b}`)) options.push([a, b]);
        const dfs = (X: CubeState, d: number) => {
          if (done(depth)) return;
          if (d === 0) {
            const c = twistOnlyCount(X);
            if (c >= 0 && c < count && (!found.best || depth + c < found.best.score)) found.best = { state: X, pairs: pairs.slice(), score: depth + c };
            return;
          }
          for (const [a, b] of options) {
            pairs.push([buf, a, b]);
            dfs(virtualSwap(virtualSwap(X, bufIdx, idxOf('corner', a)), bufIdx, idxOf('corner', b)), d - 1);
            pairs.pop();
          }
        };
        dfs(R, depth);
        if (done(depth)) break;
      }
    }
  }
  const b = found.best;
  return b ? { state: b.state, pairs: b.pairs } : null;
}

const cornerRefs = () => allPieceRefs('corner');
const refEdge = (id: StickerId) => pieceRefId('edge', id);
function orderFlip(x: StickerId, y: StickerId): { kind: 'flip'; a: StickerId; b: StickerId } {
  const [a, b] = orderEdges(refEdge(x), refEdge(y));
  return { kind: 'flip', a, b };
}

// ---- 実際に回した手順との比較 ----

export type Verdict = 'ok' | 'memo' | 'exec' | 'order' | 'extra';

export interface Judged {
  verdict: Verdict;
  message: string;
}

/**
 * 回した手順（区切ったもの）を、その時点の実際の状態と照らし合わせて判定する。
 * サイクルブレイクの選び方はどれでも正しいとみなす。
 */
export function judgeSegments(scramble: string, segments: Segment[], settings: MemoSettings): { judged: Judged[]; expected: Expected } {
  const expected = expectedSolution(scramble, settings);
  let C = applyMoves(solved(N), N, toBaseMoves(scramble, N));
  const parityPending = expected.steps.some((s) => s.kind === 'parity' || s.kind === 'ltct');
  const eHome = parityPending ? parityHome(expected.paritySwap, settings.edgeBuffers[0]) : identity;
  const homeOf = (pt: Kind3) => (pt === 'edge' ? eHome : identity);
  const curBuffer: Record<Kind3, number> = { corner: 0, edge: 0 };
  const judged: Judged[] = [];

  /** 今の状態で次に回すべきペア（サイクルブレイクは番号の若いもの） */
  const nextPair = (pt: Kind3): string | null => {
    const buffers = (pt === 'corner' ? settings.cornerBuffers : settings.edgeBuffers).slice(curBuffer[pt]);
    const t = trace(C, pt, buffers, homeOf(pt), settings);
    const seg = t.segments.find((s) => s.targets.length >= 2);
    return seg ? settings.label(pt, seg.buffer, seg.targets[0], seg.targets[1]) : null;
  };
  const nextAny = (): string => {
    const e = nextPair('edge');
    if (e) return e;
    const c = nextPair('corner');
    if (c) return c;
    const sp = expected.steps.find((s) => s.kind === 'parity' || s.kind === 'ltct' || s.kind === 'twist' || s.kind === 'flip' || s.twist);
    return sp ? sp.label : '（もう揃っているはず）';
  };

  /** コーナーを揃えるのに必要な手順の数（ねじれの組み合わせを含む） */
  const cornerCost = (X: CubeState): number => {
    const buffers = settings.cornerBuffers.slice(curBuffer.corner);
    const t = trace(X, 'corner', buffers, identity, settings);
    let cost = Math.ceil(t.segments.reduce((n, sg) => n + sg.targets.length, 0) / 2);
    let R = t.residual;
    for (;;) {
      const f = twistCombo(R, buffers, settings);
      if (!f) break;
      cost += f.pairs.length;
      R = f.state;
    }
    return cost + 2 * Math.max(0, twistOnlyCount(R));
  };

  /** 登録してある手順 n 個（2 個まで）でコーナーが揃うか */
  const solvableWithin = (X: CubeState, n: number): boolean => {
    if (twistOnlyCount(X) === 0) return true;
    if (n <= 0) return false;
    const unsolvedT = STICKER_IDS.filter((id) => !pieceSolved(X, idxOf('corner', id), identity));
    for (const buf of settings.cornerBuffers.slice(curBuffer.corner)) {
      const bufIdx = idxOf('corner', buf);
      for (const a of unsolvedT)
        for (const b of unsolvedT) {
          if (samePiece('corner', a, b) || [a, b].some((x) => samePiece('corner', x, buf)) || !settings.algOf(`corner|${buf}|${a}|${b}`)) continue;
          if (solvableWithin(virtualSwap(virtualSwap(X, bufIdx, idxOf('corner', a)), bufIdx, idxOf('corner', b)), n - 1)) return true;
        }
    }
    return false;
  };

  /** バッファ buf で (a, b) を回すのが正しいか（サイクルブレイクはどのパーツでも可） */
  const validPair = (pt: Kind3, buf: StickerId, a: StickerId, b: StickerId): boolean => {
    const home = homeOf(pt);
    const bufIdx = idxOf(pt, buf);
    const step = (X: CubeState, t: StickerId): CubeState | null => {
      const h = home(X[bufIdx]);
      const ti = idxOf(pt, t);
      if (!piece(bufIdx).includes(h)) return h === ti ? virtualSwap(X, bufIdx, ti) : null;
      const p = piece(ti);
      if (p.includes(bufIdx) || pieceSolved(X, ti, home)) return null;
      return virtualSwap(X, bufIdx, ti);
    };
    const c1 = step(C, a);
    if (c1 && step(c1, b)) return true;
    // ねじれを 3-style の組み合わせで解く途中など: 残りの手順数が減っていれば正しい
    if (pt === 'corner' && !samePiece('corner', a, b) && ![a, b].some((x) => samePiece('corner', x, buf))) {
      const cost = cornerCost(C);
      if (cost > 3) return false; // ねじれの段階（残りが少ない）だけ
      const after = virtualSwap(virtualSwap(C, bufIdx, idxOf('corner', a)), bufIdx, idxOf('corner', b));
      return solvableWithin(after, Math.min(cost - 1, 2));
    }
    return false;
  };

  for (const seg of segments) {
    const before = C;
    // 実際の状態を進める（判定はこの手順を回す前の状態で行う）
    const after = applyMoves(before, N, toBaseMoves(seg.moves, N));
    if (seg.kind === 'unknown') {
      judged.push({ verdict: 'exec', message: `ここで手順が崩れています（実行ミス）。この時点で回すべきだったのは ${nextAny()}` });
      C = after;
      continue;
    }
    if (seg.kind === 'edge' || seg.kind === 'corner') {
      const pt = seg.kind as Kind3;
      const [, buf, a, b] = (seg.key ?? '').split('|');
      const buffers = pt === 'corner' ? settings.cornerBuffers : settings.edgeBuffers;
      const bi = buffers.indexOf(buf);
      if (bi > curBuffer[pt]) curBuffer[pt] = bi; // フローティング
      const ok = buf && a && b && validPair(pt, buf, a, b);
      if (ok) {
        const edgeLeft = pt === 'corner' && nextPair('edge');
        judged.push(edgeLeft ? { verdict: 'order', message: `正しい手順ですが、まだエッジ（${edgeLeft}）が残っています` } : { verdict: 'ok', message: '' });
      } else {
        const exp = nextPair(pt);
        judged.push({
          verdict: 'memo',
          message: exp
            ? `この時点の正解は ${exp}（記憶ミスの可能性）`
            : pt === 'corner' && twistOnlyCount(C) > 0
              ? `ねじれの解き方が違います。正解の例: ${expected.steps.filter((s) => s.twist || s.kind === 'twist').map((s) => s.label).join(' → ')}`
              : `${pt === 'edge' ? 'エッジ' : 'コーナー'}はもう揃っているはずです（余計な手順）`,
        });
      }
      C = after;
      continue;
    }
    // フリップ・パリティ・LTCT・ツイスト: 正解の中にその種類があれば正しいとみなす
    const exp = expected.steps.find((s) => s.kind === seg.kind || (seg.kind === 'parity' && s.kind === 'ltct'));
    if (exp) {
      const edgeLeft = seg.kind !== 'flip' ? nextPair('edge') : null;
      judged.push(edgeLeft ? { verdict: 'order', message: `まだエッジ（${edgeLeft}）が残っています` } : { verdict: 'ok', message: '' });
    } else judged.push({ verdict: 'extra', message: `このスクランブルでは${seg.label}は不要のはずです` });
    C = after;
  }
  return { judged, expected };
}
