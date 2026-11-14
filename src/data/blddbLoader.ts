// BLDDB のデータを読み込んで端末に保存する（初回だけダウンロード、以降は保存したものを使う）
import { useEffect, useState } from 'react';
import { del, get, set } from 'idb-keyval';
import type { BlddbCategory, BlddbTable } from './blddb';
import type { PieceType } from '../cube/pieces';
import type { SpecialKind } from '../cube/special';

const VERSION = 1;
const cacheKey = (c: BlddbCategory) => `blddb:v${VERSION}:${c}`;

interface Cached {
  fetchedAt: number;
  table: BlddbTable;
  total: number;
  assigned: number;
}

const memory = new Map<BlddbCategory, Promise<Cached>>();
const listeners = new Set<() => void>();
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (c: Cached) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./blddb.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; table?: BlddbTable; total?: number; assigned?: number; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error || !e.data.table) p.reject(new Error(e.data.error ?? '読み込めませんでした'));
      else p.resolve({ fetchedAt: Date.now(), table: e.data.table, total: e.data.total ?? 0, assigned: e.data.assigned ?? 0 });
    };
  }
  return worker;
}

function download(category: BlddbCategory): Promise<Cached> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, category });
  });
}

export function loadBlddb(category: BlddbCategory, force = false): Promise<Cached> {
  if (!force) {
    const m = memory.get(category);
    if (m) return m;
  }
  const p = (async () => {
    if (!force) {
      try {
        const c = await get<Cached>(cacheKey(category));
        if (c) return c;
      } catch {
        /* 保存領域が使えなくても続ける */
      }
    }
    const c = await download(category);
    try {
      await set(cacheKey(category), c);
    } catch {
      /* 保存できなくても使える */
    }
    return c;
  })();
  memory.set(category, p);
  p.then(() => listeners.forEach((fn) => fn())).catch(() => memory.delete(category));
  return p;
}

export async function cachedInfo(category: BlddbCategory): Promise<{ fetchedAt: number; cases: number; total: number; assigned: number } | null> {
  try {
    const c = await get<Cached>(cacheKey(category));
    return c ? { fetchedAt: c.fetchedAt, cases: Object.keys(c.table).length, total: c.total, assigned: c.assigned } : null;
  } catch {
    return null;
  }
}

export async function clearBlddb(category: BlddbCategory) {
  memory.delete(category);
  await del(cacheKey(category)).catch(() => undefined);
  listeners.forEach((fn) => fn());
}

export function blddbCategoryFor(kind: PieceType | SpecialKind, size?: number): BlddbCategory {
  if (kind === 'edge' && size === 5) return 'midge';
  return kind as BlddbCategory;
}

export interface BlddbState {
  table: BlddbTable | null;
  status: 'loading' | 'ready' | 'error';
  error: string;
}

export function useBlddb(category: BlddbCategory | null): BlddbState {
  const [state, setState] = useState<BlddbState>({ table: null, status: 'loading', error: '' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    if (!category) {
      setState({ table: null, status: 'ready', error: '' });
      return;
    }
    setState((s) => ({ ...s, status: s.table ? s.status : 'loading' }));
    loadBlddb(category)
      .then((c) => alive && setState({ table: c.table, status: 'ready', error: '' }))
      .catch((e) => alive && setState({ table: null, status: 'error', error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [category, tick]);
  return state;
}

/** 表に出てくる選手と、使っているケースの数 */
export function playersOf(table: BlddbTable | null): { name: string; count: number }[] {
  if (!table) return [];
  const m = new Map<string, number>();
  for (const list of Object.values(table)) {
    const seen = new Set<string>();
    for (const a of list) for (const u of a.users) if (!seen.has(u)) (seen.add(u), m.set(u, (m.get(u) ?? 0) + 1));
  }
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** そのケースで選手が使っている手順（いなければ undefined） */
export function algOfPlayer(table: BlddbTable | null, key: string, player: string): string | undefined {
  return table?.[key]?.find((a) => a.users.includes(player))?.alg;
}
