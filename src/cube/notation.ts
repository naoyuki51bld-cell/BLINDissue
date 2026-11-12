// 回転記号のパーサ。交換子 [A, B]、共役 [A: B]、括弧 (A)2 などに対応。
import type { Axis, BaseMove } from './cube';

export type Node =
  | { type: 'move'; token: string; amount: number }
  | { type: 'group'; items: Node[]; amount: number }
  | { type: 'comm'; a: Node[]; b: Node[]; amount: number }
  | { type: 'conj'; a: Node[]; b: Node[]; amount: number }
  /** [a/b] = a b a2 b' a */
  | { type: 'slash'; a: Node[]; b: Node[]; amount: number };

export class ParseError extends Error {
  constructor(
    message: string,
    public position: number,
  ) {
    super(message);
  }
}

/** 全角文字や各種アポストロフィを半角に揃える */
export function normalizeAlgText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[’‘′´`ʼ]/g, "'")
    .replace(/[【〔「]/g, '[')
    .replace(/[】〕」]/g, ']')
    .replace(/、/g, ',')
    .replace(/;/g, ':');
}

const MOVE_RE = /^(?:(\d+)(?:-(\d+))?)?([RLUDFB]w|[RLUDFBrludfbMESxyz])/;
const SUFFIX_RE = /^(\d+)?('?)/;

/**
 * 括弧を省いた書き方を括弧付きに直す（例: "R2 U': R2, S" → "[R2 U': [R2, S]]"、"a/b" → "[a/b]"）。
 * 「+」でつないだ複数の部分はそれぞれ変換して並べる。
 */
export function bracketize(text: string): string {
  const s = normalizeAlgText(text).trim();
  if (s.includes('[') || !/[,:/]/.test(s)) return s;
  const inner = (x: string) => {
    const t = x.trim();
    const comma = t.indexOf(',');
    if (comma >= 0) return `[${t.slice(0, comma).trim()}, ${t.slice(comma + 1).trim()}]`;
    const slash = t.indexOf('/');
    if (slash >= 0) return `[${t.slice(0, slash).trim()}/${t.slice(slash + 1).trim()}]`;
    return t;
  };
  return s
    .split('+')
    .map((part) => {
      const colon = part.indexOf(':');
      if (colon >= 0) return `[${part.slice(0, colon).trim()}: ${inner(part.slice(colon + 1))}]`;
      return inner(part);
    })
    .join(' ');
}

export function parseAlg(input: string): Node[] {
  const s = bracketize(input);
  let i = 0;

  const skipWs = () => {
    while (i < s.length && /[\s.*+]/.test(s[i])) i++;
  };

  const readSuffix = (): number => {
    const m = SUFFIX_RE.exec(s.slice(i));
    if (!m) return 1;
    i += m[0].length;
    let amount = m[1] ? parseInt(m[1], 10) : 1;
    const prime = m[2] === "'";
    // R'2 のような書き方も許す
    if (prime && !m[1]) {
      const m2 = /^\d+/.exec(s.slice(i));
      if (m2) {
        amount = parseInt(m2[0], 10);
        i += m2[0].length;
      }
    }
    return prime ? -amount : amount;
  };

  const parseSeq = (terminators: string): Node[] => {
    const items: Node[] = [];
    for (;;) {
      skipWs();
      if (i >= s.length) {
        if (terminators) throw new ParseError(`「${terminators[0]}」が足りません`, i);
        return items;
      }
      const ch = s[i];
      if (terminators.includes(ch)) return items;
      if (ch === '[') {
        const start = i;
        i++;
        const a = parseSeq(',:/]');
        const sep = s[i];
        if (sep === ']') throw new ParseError('[ ] の中に「,」「:」「/」のどれかが必要です', start);
        i++;
        const b = parseSeq(']');
        i++; // ]
        const amount = readSuffix();
        items.push({ type: sep === ',' ? 'comm' : sep === '/' ? 'slash' : 'conj', a, b, amount });
        continue;
      }
      if (ch === '(') {
        i++;
        const inner = parseSeq(')');
        i++;
        const amount = readSuffix();
        items.push({ type: 'group', items: inner, amount });
        continue;
      }
      if (ch === ']' || ch === ')' || ch === ',' || ch === ':' || ch === '/')
        throw new ParseError(`予期しない「${ch}」`, i);
      const m = MOVE_RE.exec(s.slice(i));
      if (!m) throw new ParseError(`読めない記号「${ch}」`, i);
      i += m[0].length;
      const amount = readSuffix();
      items.push({ type: 'move', token: m[0], amount });
    }
  };

  const result = parseSeq('');
  return result;
}

/** 回転記号を基本ムーブへ。n はキューブのサイズ */
export function tokenToBaseMove(token: string, amount: number, n: number): BaseMove {
  const m = MOVE_RE.exec(token);
  if (!m || m[0] !== token) throw new ParseError(`不明な記号 ${token}`, 0);
  const [, p1, p2, body] = m;
  const coord = (depth: number) => n - 1 - 2 * (depth - 1); // 正方向の面から depth 層目
  const all = Array.from({ length: n }, (_, k) => -(n - 1) + 2 * k);

  const rotations: Record<string, Axis> = { x: 0, y: 1, z: 2 };
  if (body in rotations) return { axis: rotations[body], layers: all, turns: amount };

  if (body === 'M' || body === 'E' || body === 'S') {
    if (n < 3) throw new ParseError(`${body} は ${n}x${n} では使えません`, 0);
    const axis: Axis = body === 'M' ? 0 : body === 'E' ? 1 : 2;
    const sign = body === 'S' ? 1 : -1; // M は L 方向、E は D 方向、S は F 方向
    const layers = n % 2 === 1 ? [0] : [-1, 1];
    return { axis, layers, turns: sign * amount };
  }

  const faceLetter = body[0].toUpperCase();
  const wide = body.endsWith('w') || body[0] !== faceLetter;
  const info: Record<string, { axis: Axis; sign: number }> = {
    R: { axis: 0, sign: 1 },
    L: { axis: 0, sign: -1 },
    U: { axis: 1, sign: 1 },
    D: { axis: 1, sign: -1 },
    F: { axis: 2, sign: 1 },
    B: { axis: 2, sign: -1 },
  };
  const { axis, sign } = info[faceLetter];
  let from: number;
  let to: number;
  if (p2) {
    from = parseInt(p1, 10);
    to = parseInt(p2, 10);
  } else if (wide) {
    from = 1;
    to = p1 ? parseInt(p1, 10) : 2;
  } else {
    from = to = p1 ? parseInt(p1, 10) : 1;
  }
  if (from < 1 || to < from || to > n)
    throw new ParseError(`${token} は ${n}x${n} の層の範囲外です`, 0);
  const layers: number[] = [];
  for (let d = from; d <= to; d++) layers.push(sign * coord(d));
  return { axis, layers, turns: sign * amount };
}

export interface FlatMove {
  token: string;
  amount: number;
}

function invertSeq(seq: FlatMove[]): FlatMove[] {
  return seq
    .slice()
    .reverse()
    .map((m) => ({ token: m.token, amount: -m.amount }));
}

function repeat(seq: FlatMove[], amount: number): FlatMove[] {
  const base = amount < 0 ? invertSeq(seq) : seq;
  const out: FlatMove[] = [];
  for (let k = 0; k < Math.abs(amount); k++) out.push(...base);
  return out;
}

export function flatten(nodes: Node[]): FlatMove[] {
  const out: FlatMove[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'move':
        out.push({ token: node.token, amount: node.amount });
        break;
      case 'group':
        out.push(...repeat(flatten(node.items), node.amount));
        break;
      case 'comm': {
        const a = flatten(node.a);
        const b = flatten(node.b);
        out.push(...repeat([...a, ...b, ...invertSeq(a), ...invertSeq(b)], node.amount));
        break;
      }
      case 'conj': {
        const a = flatten(node.a);
        const b = flatten(node.b);
        out.push(...repeat([...a, ...b, ...invertSeq(a)], node.amount));
        break;
      }
      case 'slash': {
        const a = flatten(node.a);
        const b = flatten(node.b);
        out.push(...repeat([...a, ...b, ...a, ...a, ...invertSeq(b), ...a], node.amount));
        break;
      }
    }
  }
  return out;
}

const norm4 = (a: number) => {
  const r = ((a % 4) + 4) % 4;
  return r === 3 ? -1 : r;
};

/** 隣接する同じ記号をまとめる（R R → R2、R R' → 消去） */
export function cancel(moves: FlatMove[]): FlatMove[] {
  const out: FlatMove[] = [];
  for (const m of moves) {
    const last = out[out.length - 1];
    if (last && last.token === m.token) {
      const a = norm4(last.amount + m.amount);
      if (a === 0) out.pop();
      else last.amount = a;
    } else {
      const a = norm4(m.amount);
      if (a !== 0) out.push({ token: m.token, amount: a });
    }
  }
  return out;
}

export function amountSuffix(a: number): string {
  if (a === 1) return '';
  if (a === -1) return "'";
  if (a < 0) return `${-a}'`;
  return String(a);
}

export function flatToString(moves: FlatMove[]): string {
  return moves.map((m) => m.token + amountSuffix(m.amount)).join(' ');
}

export function nodesToString(nodes: Node[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'move':
          return n.token + amountSuffix(n.amount);
        case 'group':
          return `(${nodesToString(n.items)})${amountSuffix(n.amount)}`;
        case 'comm':
          return `[${nodesToString(n.a)}, ${nodesToString(n.b)}]${amountSuffix(n.amount)}`;
        case 'conj':
          return `[${nodesToString(n.a)}: ${nodesToString(n.b)}]${amountSuffix(n.amount)}`;
        case 'slash':
          return `[${nodesToString(n.a)}/${nodesToString(n.b)}]${amountSuffix(n.amount)}`;
      }
    })
    .join(' ');
}

function invertNode(n: Node): Node {
  if (n.amount !== 1) return { ...n, amount: -n.amount } as Node;
  switch (n.type) {
    case 'move':
      return { ...n, amount: -1 };
    case 'group':
      return { ...n, items: invertNodes(n.items) };
    case 'comm':
      return { ...n, a: n.b, b: n.a };
    case 'conj':
      return { ...n, b: invertNodes(n.b) };
    case 'slash':
      // (a b a2 b' a)' = a' b a2 b' a'
      return { ...n, a: invertNodes(n.a) };
  }
}

export function invertNodes(nodes: Node[]): Node[] {
  return nodes.slice().reverse().map(invertNode);
}

/** 交換子の構造を保ったまま逆手順のテキストを作る */
export function invertAlgText(text: string): string {
  return nodesToString(invertNodes(parseAlg(text)));
}

export function isRotation(token: string): boolean {
  return /^[xyz]$/.test(token);
}

/** 手数（持ち替えを除いた、打ち消し後の手数） */
export function moveCount(text: string): number {
  return cancel(flatten(parseAlg(text))).filter((m) => !isRotation(m.token)).length;
}

export function toBaseMoves(text: string, n: number): BaseMove[] {
  return flatten(parseAlg(text)).map((m) => tokenToBaseMove(m.token, m.amount, n));
}
