export type Penalty = 'OK' | '+2' | 'DNF';

export interface Segment {
  /** 'corner' | 'edge' | 'parity' | 'flip' | 'twist' | 'ltct' | 'unknown' */
  kind: string;
  /** 表示用（例: たし、パリティ） */
  label: string;
  /** 3-style のときのケース（練習記録と結び付ける） */
  key?: string;
  moves: string;
  /** 前の手順が終わってから回し始めるまで（思い出していた時間） ms */
  pause: number;
  /** 回していた時間 ms */
  exec: number;
}

export interface Solve {
  id: string;
  session: string;
  date: number;
  scramble: string;
  /** 記憶時間 ms（区切らなかった場合は undefined） */
  memo?: number;
  /** 合計時間 ms */
  total: number;
  penalty: Penalty;
  /** スマートキューブで判定した DNF の内容 */
  dnfReason?: string;
  /** スマートキューブの記録: 回した手（持ち方から見た面）と、記憶開始からの時刻 ms */
  moves?: string;
  times?: number[];
  segments?: Segment[];
  updatedAt: number;
  /** 削除済み（同期用） */
  deleted?: boolean;
}
