// スプレッドシートの表から手順・レターペアを読み取る
import { samePiece, STICKER_IDS, stickerName, type PieceType, type StickerId } from '../cube/pieces';
import type { PieceConfig } from '../data/store';
import { verifyAlg } from '../cube/verify';
import type { Table } from './table';

export interface Matcher {
  /** 1 文字目の文字・2 文字目の文字・位置名のどれかで照合 */
  match: (token: string) => StickerId | null;
  /** 1 文字目として照合 */
  matchFirst: (token: string) => StickerId | null;
  /** 2 文字目として照合 */
  matchSecond: (token: string) => StickerId | null;
  splitPair: (text: string) => [StickerId, StickerId] | null;
}

const clean = (s: string) => s.normalize('NFKC').trim();

function lookup(pt: PieceType, labels: Record<StickerId, string>, withNames = true) {
  const exact = new Map<string, StickerId[]>();
  const loose = new Map<string, StickerId[]>();
  const add = (m: Map<string, StickerId[]>, k: string, id: StickerId) => {
    if (!k) return;
    const list = m.get(k) ?? [];
    if (!list.includes(id)) list.push(id);
    m.set(k, list);
  };
  for (const id of STICKER_IDS) {
    const label = clean(labels[id] ?? '');
    add(exact, label, id);
    add(loose, label.toLowerCase(), id);
  }
  // 位置名（UFR など）は文字と衝突しないときだけ使う
  for (const id of withNames ? STICKER_IDS : []) {
    const name = stickerName(pt, id);
    if (!exact.has(name)) add(exact, name, id);
    if (!loose.has(name.toLowerCase())) add(loose, name.toLowerCase(), id);
  }
  return (token: string): StickerId | null => {
    const t = clean(token);
    const e = exact.get(t);
    if (e && e.length === 1) return e[0];
    if (e && e.length > 1) return null;
    const l = loose.get(t.toLowerCase());
    return l && l.length === 1 ? l[0] : null;
  };
}

export function makeMatcher(pt: PieceType, cfg: PieceConfig): Matcher {
  const matchFirst = lookup(pt, cfg.labels);
  // 2 文字目: 2 文字目のセットを優先し、無ければ 1 文字目のセット・位置名
  const second2 = cfg.dual ? lookup(pt, Object.fromEntries(Object.entries(cfg.labels2 ?? {}).filter(([, v]) => v)), false) : null;
  const matchSecond = second2 ? (t: string) => second2(t) ?? matchFirst(t) : matchFirst;
  const match = (token: string) => matchFirst(token) ?? matchSecond(token);
  const splitPair = (text: string): [StickerId, StickerId] | null => {
    const t = clean(text);
    const parts = t.split(/\s*(?:[\s\-→>＞・/,、|]|->)\s*/).filter(Boolean);
    if (parts.length === 2) {
      const a = matchFirst(parts[0]);
      const b = matchSecond(parts[1]);
      return a && b ? [a, b] : null;
    }
    const s = t.replace(/\s+/g, '');
    const found: [StickerId, StickerId][] = [];
    const chars = Array.from(s);
    for (let i = 1; i < chars.length; i++) {
      const a = matchFirst(chars.slice(0, i).join(''));
      const b = matchSecond(chars.slice(i).join(''));
      if (a && b) found.push([a, b]);
    }
    return found.length === 1 ? found[0] : null;
  };
  return { match, matchFirst, matchSecond, splitPair };
}

export interface ImportedAlg {
  a: StickerId;
  b: StickerId;
  algs: string[];
  memo?: string;
}

export interface AlgImportResult {
  mode: 'matrix' | 'list';
  /** 表形式で「上の行 = 1 文字目」と判定して読み替えたか */
  transposed?: boolean;
  entries: ImportedAlg[];
  unmatched: string[];
  skippedInvalid: string[];
}

/** セルに複数の手順がある場合（改行区切り）に分ける */
export function splitAlgCell(cell: string): string[] {
  return cell
    .split(/\r?\n|\s+\/\/?\s+|\s*｜\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function looksLikeAlg(s: string): boolean {
  return /[RLUDFBMESrludfbxyz]/.test(s) && /^[\s\[\]()RLUDFBMESrludfbwxyz0-9'’′,:：，、;\-*．.]+$/.test(s.normalize('NFKC'));
}

export function importAlgTable(pt: PieceType, cfg: PieceConfig, table: Table): AlgImportResult {
  const m = makeMatcher(pt, cfg);
  const buffer = cfg.buffer;
  const unmatched = new Set<string>();
  const skippedInvalid: string[] = [];
  const entries: ImportedAlg[] = [];
  const valid = (a: StickerId, b: StickerId) =>
    !samePiece(pt, a, buffer) && !samePiece(pt, b, buffer) && !samePiece(pt, a, b);

  // 行列形式かどうか: どこかの行がヘッダー（ラベルが多数並ぶ）になっている
  let headerRow = -1;
  let headerScore = 0;
  for (let r = 0; r < Math.min(table.length, 10); r++) {
    const row = table[r];
    const score = row.filter((c) => c && m.match(c)).length;
    // ヘッダー行には手順らしいセル（ラベルとして読めないもの）が無い
    if (row.some((c) => c && !m.match(c) && looksLikeAlg(c))) continue;
    if (score > headerScore) {
      headerScore = score;
      headerRow = r;
    }
  }
  if (headerScore >= 2) {
    const header = table[headerRow];
    // 行ラベルの列: ラベルが最も多い列
    let labelCol = 0;
    let best = -1;
    for (let c = 0; c < Math.min(header.length, 4); c++) {
      const score = table.slice(headerRow + 1).filter((row) => row[c] && m.match(row[c])).length;
      if (score > best) {
        best = score;
        labelCol = c;
      }
    }
    // 行と列のどちらが 1 文字目かは表によって違う。両方の読み方で作り、手順を実際に検証して多く合う方を採用する
    const build = (rowFirst: boolean) => {
      const rowMatch = rowFirst ? m.matchFirst : m.matchSecond;
      const colMatch = rowFirst ? m.matchSecond : m.matchFirst;
      const out: ImportedAlg[] = [];
      const miss = new Set<string>();
      const invalid: string[] = [];
      const cols = header.map((h, c) => (c === labelCol ? null : h ? colMatch(h) : null));
      header.forEach((h, c) => {
        if (c !== labelCol && h && !cols[c]) miss.add(h);
      });
      for (let r = headerRow + 1; r < table.length; r++) {
        const row = table[r];
        const rowLabel = row[labelCol];
        if (!rowLabel) continue;
        const x = rowMatch(rowLabel);
        if (!x) {
          if (row.some((c, i) => i !== labelCol && c)) miss.add(rowLabel);
          continue;
        }
        cols.forEach((y, c) => {
          const cell = row[c];
          if (!y || !cell) return;
          const [a, b] = rowFirst ? [x, y] : [y, x];
          if (!valid(a, b)) {
            if (a !== b) invalid.push(`${rowLabel}${header[c]}`);
            return;
          }
          const algs = splitAlgCell(cell);
          if (algs.length) out.push({ a, b, algs });
        });
      }
      return { entries: out, unmatched: [...miss], skippedInvalid: invalid };
    };
    const okCount = (list: ImportedAlg[]) =>
      list.slice(0, 80).filter((e) => verifyAlg(pt, cfg.size, e.algs[0], buffer, e.a, e.b).kind === 'ok').length;
    const normal = build(true);
    const transposed = build(false);
    const sn = okCount(normal.entries);
    const st = okCount(transposed.entries);
    if (st > sn || (st === sn && transposed.entries.length > normal.entries.length)) return { mode: 'matrix', transposed: true, ...transposed };
    return { mode: 'matrix', ...normal };
  }

  // リスト形式: 「ペア | 手順 | メモ」または「1 文字目 | 2 文字目 | 手順 | メモ」
  for (const row of table) {
    const cells = row.filter((c) => c !== '');
    if (cells.length < 2) continue;
    let pair: [StickerId, StickerId] | null = null;
    let rest: string[] = [];
    const a1 = m.matchFirst(row[0] ?? '');
    const b1 = m.matchSecond(row[1] ?? '');
    if (a1 && b1 && row[2] && looksLikeAlg(row[2])) {
      pair = [a1, b1];
      rest = row.slice(2);
    } else {
      pair = m.splitPair(row[0] ?? '');
      rest = row.slice(1);
    }
    if (!pair) {
      if (row[0] && rest.some((c) => c && looksLikeAlg(c))) unmatched.add(row[0]);
      continue;
    }
    const algCell = rest.find((c) => c && looksLikeAlg(c));
    if (!algCell) continue;
    if (!valid(pair[0], pair[1])) {
      skippedInvalid.push(row[0]);
      continue;
    }
    const memo = rest.filter((c) => c && c !== algCell).join(' / ');
    entries.push({ a: pair[0], b: pair[1], algs: splitAlgCell(algCell), memo: memo || undefined });
  }
  return { mode: 'list', entries, unmatched: [...unmatched], skippedInvalid };
}

export interface ImportedPair {
  pair: string;
  word: string;
  memo?: string;
}

export interface PairImportResult {
  mode: 'matrix' | 'list';
  /** 表形式で「上の行 = 1 文字目」と判定して読み替えたか */
  transposed?: boolean;
  entries: ImportedPair[];
  /** 文字の割り振りと一致しなかった見出し・ペア */
  unmatched: string[];
}

/** セルの中身を単語とメモに分ける（2 行目以降・括弧書きはメモ） */
function splitWordCell(cell: string): { word: string; memo?: string } {
  const lines = cell.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return { word: lines[0] ?? '', memo: lines.slice(1).join(' / ') || undefined };
}

/**
 * レターペアの表を読む。
 * 表形式（1 行目に 2 文字目、1 列目に 1 文字目、セルに単語。逆向きも自動判定）、
 * リスト形式（「ペア ｜ 単語 ｜ メモ」または「1 文字目 ｜ 2 文字目 ｜ 単語 ｜ メモ」）に対応。
 * ペアの文字は今の文字の割り振りに合わせて書き直す（大文字・小文字、位置名、ローマ字の読みがなも照合）。
 */
export function importPairTable(pt: PieceType, cfg: PieceConfig, table: Table, reading?: (pair: string) => string | null): PairImportResult {
  const m = makeMatcher(pt, cfg);
  const firstOnly = lookup(pt, cfg.labels, false);
  const secondOnly = cfg.dual ? lookup(pt, Object.fromEntries(Object.entries(cfg.labels2 ?? {}).filter(([, v]) => v)), false) : firstOnly;
  const text = (a: StickerId, b: StickerId) => (cfg.labels[a] || stickerName(pt, a)) + ((cfg.dual && cfg.labels2?.[b]) || cfg.labels[b] || stickerName(pt, b));
  const unmatched = new Set<string>();

  // ---- 表形式: 見出しの行と列を探す ----
  let headerRow = -1;
  let headerScore = 0;
  for (let r = 0; r < Math.min(table.length, 10); r++) {
    const score = table[r].filter((c) => c && m.match(c)).length;
    if (score > headerScore) {
      headerScore = score;
      headerRow = r;
    }
  }
  if (headerScore >= 4) {
    const header = table[headerRow];
    const body = table.slice(headerRow + 1);
    const width = Math.max(...table.map((r) => r.length));
    let labelCol = 0;
    let colScore = -1;
    for (let c = 0; c < Math.min(width, 5); c++) {
      const sc = body.filter((r) => r[c] && m.match(r[c])).length;
      if (sc > colScore) {
        colScore = sc;
        labelCol = c;
      }
    }
    // 向き: 2 セット使う設定なら、見出しがどちらのセットに多く一致するかで決める
    let transposed = false;
    if (cfg.dual) {
      const hs = header.filter((h, c) => h && c !== labelCol);
      const rs = body.map((r) => r[labelCol]).filter(Boolean);
      const count = (xs: string[], f: (t: string) => StickerId | null) => xs.filter((x) => f(x)).length;
      const normal = count(hs, secondOnly) + count(rs, firstOnly);
      const swapped = count(hs, firstOnly) + count(rs, secondOnly);
      transposed = swapped > normal;
    }
    const entries: ImportedPair[] = [];
    const cols = header.map((h, c) => (c === labelCol || !h ? null : transposed ? m.matchFirst(h) : m.matchSecond(h)));
    header.forEach((h, c) => c !== labelCol && h && !cols[c] && unmatched.add(h));
    for (const row of body) {
      const head = row[labelCol] ?? '';
      if (!head.trim()) continue;
      const rid = transposed ? m.matchSecond(head) : m.matchFirst(head);
      if (!rid) {
        unmatched.add(head);
        continue;
      }
      row.forEach((cell, c) => {
        const cid = cols[c];
        if (!cid || !cell?.trim()) return;
        const [a, b] = transposed ? [cid, rid] : [rid, cid];
        entries.push({ pair: text(a, b), ...splitWordCell(cell) });
      });
    }
    return { mode: 'matrix', transposed, entries, unmatched: [...unmatched] };
  }

  // ---- リスト形式 ----
  const byReading = new Map<string, StickerId[]>();
  if (reading) {
    for (const a of STICKER_IDS)
      for (const b of STICKER_IDS) {
        const r = reading(text(a, b));
        if (r) byReading.set(r, [a, b]);
      }
  }
  const pairOf = (cell: string): [StickerId, StickerId] | null => {
    const sp = m.splitPair(cell);
    if (sp) return sp;
    const r = byReading.get(clean(cell).replace(/\s+/g, ''));
    return r ? [r[0], r[1]] : null;
  };
  const entries: ImportedPair[] = [];
  for (const row of table) {
    const c0 = (row[0] ?? '').trim();
    if (!c0) continue;
    // 1 文字目 ｜ 2 文字目 ｜ 単語
    const a1 = m.matchFirst(c0);
    const b1 = row[1] ? m.matchSecond(row[1]) : null;
    if (a1 && b1 && row[2]?.trim()) {
      const w = splitWordCell(row[2]);
      const memo = [w.memo, ...row.slice(3).filter(Boolean)].filter(Boolean).join(' / ');
      entries.push({ pair: text(a1, b1), word: w.word, ...(memo ? { memo } : {}) });
      continue;
    }
    const word = (row[1] ?? '').trim();
    if (!word) continue;
    const p = pairOf(c0);
    if (!p) {
      unmatched.add(c0);
      continue;
    }
    const w = splitWordCell(word);
    const memo = [w.memo, ...row.slice(2).filter(Boolean)].filter(Boolean).join(' / ');
    entries.push({ pair: text(p[0], p[1]), word: w.word, ...(memo ? { memo } : {}) });
  }
  // 見出し行（「ペア」「単語」など）は一致しなくて当然なので数えない
  const first = table.find((r) => r[0]?.trim())?.[0]?.trim();
  if (first) unmatched.delete(first);
  return { mode: 'list', entries, unmatched: [...unmatched] };
}
