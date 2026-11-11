// 間隔反復（SM-2 を簡略化したもの）と想起時間の記録
export type Grade = 0 | 1 | 2 | 3; // もう一度 / 難しい / 普通 / 簡単

export interface ReviewState {
  ease: number;
  interval: number; // 日
  due: number; // ms
  reps: number;
  lapses: number;
  times: number[]; // 直近の想起時間 ms（最大 10）
  execTimes?: number[]; // 直近の実行時間 ms（スマートキューブ練習のみ、最大 10）
  lastGrade?: Grade;
  lastReviewed?: number;
}

export const DAY = 24 * 60 * 60 * 1000;

export function newReview(): ReviewState {
  return { ease: 2.5, interval: 0, due: 0, reps: 0, lapses: 0, times: [] };
}

export function review(prev: ReviewState | undefined, grade: Grade, timeMs: number, now = Date.now(), execMs?: number): ReviewState {
  const r = { ...(prev ?? newReview()) };
  r.times = [...r.times, Math.round(timeMs)].slice(-10);
  if (execMs !== undefined) r.execTimes = [...(r.execTimes ?? []), Math.round(execMs)].slice(-10);
  r.lastGrade = grade;
  r.lastReviewed = now;
  if (grade === 0) {
    r.lapses += 1;
    r.reps = 0;
    r.interval = 0;
    r.ease = Math.max(1.3, r.ease - 0.2);
    r.due = now + 60 * 1000; // 同じセッション中にもう一度
    return r;
  }
  r.reps += 1;
  r.ease = Math.max(1.3, r.ease + [0, -0.15, 0, 0.15][grade]);
  if (r.reps === 1) r.interval = grade === 3 ? 3 : 1;
  else if (r.reps === 2) r.interval = grade === 1 ? 2 : grade === 3 ? 7 : 4;
  else r.interval = Math.round(r.interval * (grade === 1 ? 1.2 : grade === 3 ? r.ease * 1.3 : r.ease));
  r.interval = Math.max(1, r.interval);
  r.due = now + r.interval * DAY;
  return r;
}

export function avgTime(r: ReviewState | undefined): number | null {
  if (!r || r.times.length === 0) return null;
  const recent = r.times.slice(-5);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

export function avgExecTime(r: ReviewState | undefined): number | null {
  const t = r?.execTimes;
  if (!t || t.length === 0) return null;
  const recent = t.slice(-5);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

export function isDue(r: ReviewState | undefined, now = Date.now()): boolean {
  return !!r && r.reps + r.lapses > 0 && r.due <= now;
}

export function formatSec(ms: number | null): string {
  return ms === null ? '—' : (ms / 1000).toFixed(2);
}
