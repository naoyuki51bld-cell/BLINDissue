// 同期用: データを Firestore のドキュメント単位（チャンク）に分け、1 件ずつ新しい方を採用して統合する
import type { AlgEntry, AppData, PairEntry, PieceConfig } from '../data/store';
import type { ReviewState } from '../data/srs';

export type Chunks = Record<string, Record<string, unknown>>;

/** チャンク名: pieces / algs-<種類> / pairs / reviews-<種類> / reviews-pairs */
export function chunkNameForAlg(key: string): string {
  return `algs-${key.split('|')[0]}`;
}
export function chunkNameForReview(key: string): string {
  const [kind, second] = key.split('|');
  return kind === 'p' ? 'reviews-pairs' : `reviews-${second}`;
}

export function splitChunks(d: Pick<AppData, 'pieces' | 'algs' | 'pairs' | 'reviews'>): Chunks {
  const out: Chunks = { pieces: { ...d.pieces }, pairs: { ...d.pairs } };
  for (const [k, v] of Object.entries(d.algs)) (out[chunkNameForAlg(k)] ??= {})[k] = v;
  for (const [k, v] of Object.entries(d.reviews)) (out[chunkNameForReview(k)] ??= {})[k] = v;
  return out;
}

export function joinChunks(chunks: Chunks): Pick<AppData, 'pieces' | 'algs' | 'pairs' | 'reviews'> {
  const algs: Record<string, AlgEntry> = {};
  const reviews: Record<string, ReviewState> = {};
  for (const [name, data] of Object.entries(chunks)) {
    if (name.startsWith('algs-')) Object.assign(algs, data);
    if (name.startsWith('reviews-')) Object.assign(reviews, data);
  }
  return {
    pieces: (chunks.pieces ?? {}) as AppData['pieces'],
    pairs: (chunks.pairs ?? {}) as Record<string, PairEntry>,
    algs,
    reviews,
  };
}

/** 各エントリーの更新時刻 */
export function stampOf(chunk: string, v: unknown): number {
  if (!v || typeof v !== 'object') return 0;
  if (chunk.startsWith('reviews-')) return (v as ReviewState).lastReviewed ?? 0;
  if (chunk === 'pieces') return (v as PieceConfig).updatedAt ?? 0;
  return (v as AlgEntry | PairEntry).updatedAt ?? 0;
}

/** 1 件ずつ、更新時刻が新しい方を採用（同じなら a） */
export function mergeChunk(chunk: string, a: Record<string, unknown> = {}, b: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (!(k in out) || stampOf(chunk, v) > stampOf(chunk, out[k])) out[k] = v;
  }
  return out;
}

/** 安定した JSON（キー順をそろえる）。変更の有無の比較に使う */
export function stableJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stableJson).join(',')}]`;
  if (x && typeof x === 'object')
    return `{${Object.keys(x as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((x as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(x ?? null);
}
