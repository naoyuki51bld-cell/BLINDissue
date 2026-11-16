import type { Solve } from './types';

export function value(s: Solve): number {
  if (s.penalty === 'DNF') return Infinity;
  return s.total + (s.penalty === '+2' ? 2000 : 0);
}

export function formatTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-';
  if (!isFinite(ms)) return 'DNF';
  const cs = Math.floor(ms / 10);
  const sec = Math.floor(cs / 100);
  const m = Math.floor(sec / 60);
  const rest = `${String(sec % 60).padStart(m ? 2 : 1, '0')}.${String(cs % 100).padStart(2, '0')}`;
  return m ? `${m}:${rest}` : rest;
}

/** 平均（mo3 など、DNF があれば DNF） */
export function meanOf(list: Solve[]): number | null {
  if (!list.length) return null;
  const v = list.map(value);
  if (v.some((x) => !isFinite(x))) return Infinity;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** ao5・ao12（最良と最悪を 1 つずつ除く。DNF が 2 つ以上なら DNF） */
export function averageOf(list: Solve[]): number | null {
  if (list.length < 3) return null;
  const v = list.map(value).sort((a, b) => a - b);
  const trim = Math.max(1, Math.ceil(list.length * 0.05));
  const mid = v.slice(trim, v.length - trim);
  if (mid.some((x) => !isFinite(x))) return Infinity;
  return mid.reduce((a, b) => a + b, 0) / mid.length;
}

/** 新しい順の記録から、直近 n 回の値（足りなければ null） */
export function current(list: Solve[], n: number, fn: (l: Solve[]) => number | null): number | null {
  return list.length >= n ? fn(list.slice(0, n)) : null;
}

/** 区間の最良（新しい順の記録） */
export function bestOf(list: Solve[], n: number, fn: (l: Solve[]) => number | null): number | null {
  let best: number | null = null;
  for (let i = 0; i + n <= list.length; i++) {
    const v = fn(list.slice(i, i + n));
    if (v !== null && (best === null || v < best)) best = v;
  }
  return best;
}

export function bestSingle(list: Solve[]): number | null {
  const v = list.map(value).filter(isFinite);
  return v.length ? Math.min(...v) : null;
}

export function successRate(list: Solve[]): number | null {
  if (!list.length) return null;
  return list.filter((s) => s.penalty !== 'DNF').length / list.length;
}
