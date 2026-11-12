// 行 = 1 文字目、列 = 2 文字目 の表（手順・レターペア共通）
import type { ReactNode } from 'react';
import type { Status } from '../data/store';
import { avgTime, type ReviewState } from '../data/srs';
import { usePersisted } from './shared';

export type Tone = Status | 'fast' | 'mid' | 'slow' | 'untested';
export type ColorMode = 'status' | 'time';

export interface Cell {
  text: string;
  tone: Tone;
  bad?: boolean;
  title?: string;
}

/** 想起時間で色分け（遅いとみなす秒数は練習画面の設定と共通） */
export function timeTone(r: ReviewState | undefined, slowSec: number): Tone {
  const t = avgTime(r);
  if (t === null) return 'untested';
  if (t <= (slowSec * 1000) / 2) return 'fast';
  if (t <= slowSec * 1000) return 'mid';
  return 'slow';
}

export function useTableOptions() {
  const [color, setColor] = usePersisted<ColorMode>('table.color', 'time');
  const [showText, setShowText] = usePersisted<boolean>('table.text', true);
  const [slowSec] = usePersisted<number>('practice.slow', 2);
  return { color, setColor, showText, setShowText, slowSec };
}

export function TableOptions({ opts }: { opts: ReturnType<typeof useTableOptions> }) {
  return (
    <div className="row wrap">
      <div className="segmented">
        <button className={opts.color === 'time' ? 'active' : ''} onClick={() => opts.setColor('time')}>
          想起時間で色分け
        </button>
        <button className={opts.color === 'status' ? 'active' : ''} onClick={() => opts.setColor('status')}>
          ステータスで色分け
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={opts.showText} onChange={(e) => opts.setShowText(e.target.checked)} />
        セルに中身を表示
      </label>
    </div>
  );
}

export function TableLegend({ mode, slowSec }: { mode: ColorMode; slowSec: number }) {
  const items: [Tone, string][] =
    mode === 'time'
      ? [
          ['fast', `速い（${slowSec / 2} 秒以内）`],
          ['mid', `普通（${slowSec} 秒以内）`],
          ['slow', `遅い（${slowSec} 秒より遅い）`],
          ['untested', '未練習'],
        ]
      : [
          ['none', '未着手'],
          ['learning', '練習中'],
          ['learned', '覚えた'],
          ['auto', '自動化'],
        ];
  return (
    <p className="legend small muted">
      {items.map(([t, l]) => (
        <span key={t} className="legend-item">
          <span className={`swatch tone-${t}`} /> {l}
        </span>
      ))}
      <span className="legend-item">「遅いとみなす秒数」は練習画面で変えられます</span>
    </p>
  );
}

export function PairTable({
  rows,
  cols,
  cell,
  onOpen,
  showText,
  corner = '1＼2',
}: {
  rows: { id: string; label: ReactNode }[];
  cols: { id: string; label: ReactNode }[];
  cell: (row: string, col: string) => Cell | null;
  onOpen: (row: string, col: string) => void;
  showText: boolean;
  corner?: string;
}) {
  return (
    <div className="grid-wrap">
      <table className={showText ? 'pair-table with-text' : 'pair-table'}>
        <thead>
          <tr>
            <th className="corner-cell">{corner}</th>
            {cols.map((c) => (
              <th key={c.id}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th>{r.label}</th>
              {cols.map((c) => {
                const v = cell(r.id, c.id);
                if (!v) return <td key={c.id} className="na" />;
                return (
                  <td key={c.id} className={`tone-${v.tone}${v.text ? '' : ' empty'}${v.bad ? ' bad' : ''}`}>
                    <button onClick={() => onOpen(r.id, c.id)} title={v.title}>
                      {v.bad ? '✗ ' : ''}
                      {showText ? v.text : v.text ? '●' : ''}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
