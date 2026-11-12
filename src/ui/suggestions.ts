import { useEffect, useState } from 'react';
import { generateSuggestions, suggestionsToObject, type SuggestionTable } from '../cube/generator';
import type { PieceType, StickerId } from '../cube/pieces';
import { elliottBuffers, elliottTable, loadElliott } from '../data/elliott';

const cache = new Map<string, Promise<SuggestionTable>>();
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (t: SuggestionTable) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../cube/generator.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; table: SuggestionTable }>) => {
      pending.get(e.data.id)?.(e.data.table);
      pending.delete(e.data.id);
    };
    return worker;
  } catch {
    return null;
  }
}

/** おすすめ手順の表（キー "A|B"）。計算はバックグラウンドで 1 回だけ */
export function loadSuggestions(pt: PieceType, n: number, buffer: StickerId): Promise<SuggestionTable> {
  const key = `${pt}|${n}|${buffer}`;
  let p = cache.get(key);
  if (!p) {
    const w = getWorker();
    p = w
      ? new Promise<SuggestionTable>((resolve) => {
          const id = ++seq;
          pending.set(id, resolve);
          w.postMessage({ id, pt, n, buffer });
        })
      : new Promise<SuggestionTable>((resolve) => setTimeout(() => resolve(suggestionsToObject(generateSuggestions(pt, n, buffer))), 0));
    cache.set(key, p);
  }
  return p;
}

export function useSuggestions(pt: PieceType, n: number, buffer: StickerId): SuggestionTable | null {
  const [table, setTable] = useState<SuggestionTable | null>(null);
  useEffect(() => {
    let alive = true;
    setTable(null);
    loadSuggestions(pt, n, buffer).then((t) => alive && setTable(t));
    return () => {
      alive = false;
    };
  }, [pt, n, buffer]);
  return table;
}

/** Elliott の手順表（そのパーツ・バッファの表が無ければ null、読み込み中は undefined） */
export function useElliottTable(pt: PieceType, buffer: StickerId): Record<string, string> | null | undefined {
  const [table, setTable] = useState<Record<string, string> | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setTable(undefined);
    if (pt !== 'corner' && pt !== 'edge') {
      setTable(null);
      return;
    }
    loadElliott().then((d) => alive && setTable(elliottTable(d, pt, buffer)));
    return () => {
      alive = false;
    };
  }, [pt, buffer]);
  return table;
}

export function useElliottBuffers(pt: PieceType): StickerId[] {
  const [list, setList] = useState<StickerId[]>([]);
  useEffect(() => {
    let alive = true;
    loadElliott().then((d) => alive && setList(elliottBuffers(d, pt)));
    return () => {
      alive = false;
    };
  }, [pt]);
  return list;
}
