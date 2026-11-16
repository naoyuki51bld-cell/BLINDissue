// スクランブルの進み具合を「回した手の順番」で追う（キューブ内部の状態がずれていても動く）
import type { Face } from '../cube/cube';
import type { FaceTurn } from '../smartcube/tracker';

export interface ScrambleProgress {
  /** 終わった手の数 */
  pos: number;
  /** 2 回転の手の途中（1 回分だけ回した） */
  partial: number;
  /** スクランブルから外れた手（戻す必要がある） */
  off: FaceTurn[];
}

export const startProgress = (): ScrambleProgress => ({ pos: 0, partial: 0, off: [] });

export function parseScramble(s: string): FaceTurn[] {
  return s
    .split(/\s+/)
    .map((tok) => /^([URFDLB])(2?)('?)$/.exec(tok))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ face: m[1] as Face, amount: m[2] ? 2 : m[3] ? -1 : 1 }));
}

const mod4 = (a: number) => ((a % 4) + 4) % 4;
const norm = (a: number) => (mod4(a) === 3 ? -1 : mod4(a));

function pushOff(off: FaceTurn[], t: FaceTurn): FaceTurn[] {
  const last = off[off.length - 1];
  if (last && last.face === t.face) {
    const a = norm(last.amount + t.amount);
    return a === 0 ? off.slice(0, -1) : [...off.slice(0, -1), { face: t.face, amount: a }];
  }
  return [...off, { face: t.face, amount: norm(t.amount) }];
}

export function stepProgress(p: ScrambleProgress, tokens: FaceTurn[], t: FaceTurn): ScrambleProgress {
  if (p.off.length) return { ...p, off: pushOff(p.off, t) };
  const exp = tokens[p.pos];
  if (!exp) return { ...p, off: pushOff([], t) };
  if (t.face !== exp.face) {
    const off = p.partial ? pushOff([], { face: exp.face, amount: p.partial }) : [];
    return { pos: p.pos, partial: 0, off: pushOff(off, t) };
  }
  if (Math.abs(exp.amount) === 1) {
    if (t.amount === exp.amount) return { pos: p.pos + 1, partial: 0, off: [] };
    // 逆向き（R のところを R'）: 2 回分なので R2 の扱いにはせず、戻してもらう
    return { ...p, off: pushOff([], t) };
  }
  const acc = norm(p.partial + t.amount);
  if (mod4(acc) === 2) return { pos: p.pos + 1, partial: 0, off: [] };
  return { pos: p.pos, partial: acc, off: [] };
}

export const isDone = (p: ScrambleProgress, tokens: FaceTurn[]) => p.pos === tokens.length && !p.partial && !p.off.length;
