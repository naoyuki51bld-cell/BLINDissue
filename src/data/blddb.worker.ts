import { BLDDB_FILES, BLDDB_SOURCES, processBlddb, type BlddbCategory } from './blddb';

self.onmessage = async (e: MessageEvent<{ id: number; category: BlddbCategory }>) => {
  const { id, category } = e.data;
  let lastError = '';
  for (const base of BLDDB_SOURCES) {
    try {
      const res = await fetch(base + BLDDB_FILES[category]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const r = processBlddb(category, json);
      (self as unknown as Worker).postMessage({ id, table: r.table, total: r.total, assigned: r.assigned });
      return;
    } catch (err) {
      lastError = String(err);
    }
  }
  (self as unknown as Worker).postMessage({ id, error: lastError || '読み込めませんでした' });
};
