// 行 = 1 文字目、列 = 2 文字目 の表（手順・レターペア共通）
import type { ReactNode } from 'react';
import type { Status } from '../data/store';
import { avgExecTime, avgTime, type ReviewState } from '../data/srs';
import { usePersisted } from './shared';

export type Tone = Status | 'fast' | 'mid' | 'slow' | 'untested';
export type ColorMode = 'status' | 'time' | 'exec';

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

/** 実行時間で色分け（スマートキューブ練習で記録した時間） */
export function execTone(r: ReviewState | undefined, slowSec: number): Tone {
  const t = avgExecTime(r);
  if (t === null) return 'untested';
  if (t <= (slowSec * 1000) / 2) return 'fast';
  if (t <= slowSec * 1000) return 'mid';
  return 'slow';
}

export function useTableOptions(allowExec = true) {
  const [stored, setColor] = usePersisted<ColorMode>('table.color', 'time');
  const color: ColorMode = !allowExec && stored === 'exec' ? 'time' : stored;
  const [showText, setShowText] = usePersisted<boolean>('table.text', true);
  const [slowSec] = usePersisted<number>('practice.slow', 2);
  const [execSlowSec, setExecSlowSec] = usePersisted<number>('table.execSlow', 2);
  return { color, setColor, showText, setShowText, slowSec, execSlowSec, setExecSlowSec, allowExec };
}

/** 色分けに使う区分（想起・実行・ステータス） */
export function toneFor(opts: ReturnType<typeof useTableOptions>, r: ReviewState | undefined, status: Status, registered: boolean): Tone {
  if (opts.color === 'status') return status;
  if (!registered) return 'none';
  return opts.color === 'exec' ? execTone(r, opts.execSlowSec) : timeTone(r, opts.slowSec);
}

export function TableOptions({ opts }: { opts: ReturnType<typeof useTableOptions> }) {
  return (
    <div className="row wrap">
      <div className="segmented">
        <button className={opts.color === 'time' ? 'active' : ''} onClick={() => opts.setColor('time')}>
          想起時間
        </button>
        {opts.allowExec && (
          <button className={opts.color === 'exec' ? 'active' : ''} onClick={() => opts.setColor('exec')}>
            実行時間
          </button>
        )}
        <button className={opts.color === 'status' ? 'active' : ''} onClick={() => opts.setColor('status')}>
          ステータス
        </button>
      </div>
      {opts.color === 'exec' && (
        <label className="field inline">
          <span className="field-label">実行が遅いとみなす時間</span>
          <select value={opts.execSlowSec} onChange={(e) => opts.setExecSlowSec(Number(e.target.value))}>
            {[1, 1.5, 2, 2.5, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} 秒
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={opts.showText} onChange={(e) => opts.setShowText(e.target.checked)} />
        セルに中身を表示
      </label>
    </div>
  );
}

export function TableLegend({ mode, slowSec, execSlowSec = 2 }: { mode: ColorMode; slowSec: number; execSlowSec?: number }) {
  const sec = mode === 'exec' ? execSlowSec : slowSec;
  const items: [Tone, string][] =
    mode !== 'status'
      ? [
          ['fast', `速い（${sec / 2} 秒以内）`],
          ['mid', `普通（${sec} 秒以内）`],
          ['slow', `遅い（${sec} 秒より遅い）`],
          ['untested', mode === 'exec' ? '実行の記録なし（スマートキューブ練習で記録）' : '未練習'],
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
      {mode === 'time' && <span className="legend-item">想起の「遅いとみなす秒数」は練習画面で変えられます</span>}
      {mode === 'exec' && <span className="legend-item">実行時間はスマートキューブ練習の記録（直近 5 回の平均）です</span>}
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
