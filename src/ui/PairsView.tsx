import { useMemo, useState } from 'react';
import { PIECE_LABEL, type PieceType } from '../cube/pieces';
import { labelOf, pairReading, pairText } from '../data/labels';
import { pairReviewKey, STATUSES, STATUS_LABEL, useStore, type Status } from '../data/store';
import { avgTime, formatSec } from '../data/srs';
import { Modal, PieceTabs, StatusBadge, useCases, usePersisted, useTargets } from './shared';

/** そのパーツの文字の割り振りで現れるレターペアの一覧 */
export function usePairList(pt: PieceType) {
  const cfg = useStore((s) => s.pieces[pt]);
  const cases = useCases(pt, cfg.buffer);
  return useMemo(() => {
    const seen = new Set<string>();
    const out: { pair: string; first: string }[] = [];
    for (const [a, b] of cases) {
      const pair = pairText(pt, cfg, a, b);
      if (seen.has(pair)) continue;
      seen.add(pair);
      out.push({ pair, first: labelOf(pt, cfg, a) });
    }
    return out;
  }, [cases, pt, cfg]);
}

type Filter = 'all' | 'missing' | Status;

export function PairsView() {
  const [pt, setPt] = usePersisted<PieceType>('pairs.pt', 'corner');
  const [first, setFirst] = useState<string>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const cfg = useStore((s) => s.pieces[pt]);
  const pairs = useStore((s) => s.pairs);
  const reviews = useStore((s) => s.reviews);
  const setPair = useStore((s) => s.setPair);
  const list = usePairList(pt);
  const targets = useTargets(pt, cfg.buffer);
  const firsts = useMemo(() => [...new Set(targets.map((t) => labelOf(pt, cfg, t)))], [targets, pt, cfg]);

  const registered = list.filter((p) => pairs[p.pair]?.word).length;
  const q = query.trim().toLowerCase();
  const visible = list.filter((p) => {
    const e = pairs[p.pair];
    if (first !== 'all' && p.first !== first) return false;
    if (filter === 'missing' && e?.word) return false;
    if (STATUSES.includes(filter as Status) && (e?.status ?? 'none') !== filter) return false;
    if (q && !p.pair.toLowerCase().includes(q) && !(e?.word ?? '').toLowerCase().includes(q) && !(e?.memo ?? '').toLowerCase().includes(q))
      return false;
    return true;
  });

  return (
    <div className="page">
      <PieceTabs value={pt} onChange={(p) => { setPt(p); setFirst('all'); }} />
      <div className="summary">
        <div>
          <strong>{registered}</strong> / {list.length} ペアにイメージ登録
        </div>
        <div className="muted small">
          {PIECE_LABEL[pt]}の文字の割り振りで作られるペアです。同じ文字を使うパーツ同士ではイメージが共有されます。
        </div>
      </div>
      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="絞り込み">
          <option value="all">すべて</option>
          <option value="missing">イメージ未登録</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input className="search" type="search" placeholder="ペア・イメージで検索" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="chips scroll" aria-label="1 文字目">
        <button className={first === 'all' ? 'chip small active' : 'chip small'} onClick={() => setFirst('all')}>
          全部
        </button>
        {firsts.map((f) => (
          <button key={f} className={first === f ? 'chip small active' : 'chip small'} onClick={() => setFirst(f)}>
            {f}
          </button>
        ))}
      </div>
      <ul className="case-list">
        {visible.map((p) => {
          const e = pairs[p.pair];
          const reading = pairReading(cfg, p.pair);
          const t = avgTime(reviews[pairReviewKey(p.pair)]);
          return (
            <li key={p.pair} className="pair-row">
              <span className="case-pair">
                {p.pair}
                {reading && <small>{reading}</small>}
              </span>
              <input
                className="pair-word"
                defaultValue={e?.word ?? ''}
                key={`${p.pair}:${e?.updatedAt ?? 0}`}
                placeholder="イメージ（単語・人物など）"
                onBlur={(ev) => {
                  const v = ev.target.value.trim();
                  if (v !== (e?.word ?? '')) setPair(p.pair, { word: v, status: e?.status ?? (v ? 'learning' : 'none') });
                }}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
                }}
              />
              <span className="case-meta">
                {t !== null && <span className="muted small">{formatSec(t)}s</span>}
                <button className="plain" onClick={() => setEditing(p.pair)} aria-label={`${p.pair} の詳細`}>
                  <StatusBadge status={e?.status ?? 'none'} />
                </button>
              </span>
            </li>
          );
        })}
        {visible.length === 0 && <li className="muted empty">該当するペアはありません</li>}
      </ul>
      {editing && <PairEditor pair={editing} reading={pairReading(cfg, editing)} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PairEditor({ pair, reading, onClose }: { pair: string; reading: string | null; onClose: () => void }) {
  const entry = useStore((s) => s.pairs[pair]);
  const setPair = useStore((s) => s.setPair);
  const resetReview = useStore((s) => s.resetReview);
  const rv = useStore((s) => s.reviews[pairReviewKey(pair)]);
  const [word, setWord] = useState(entry?.word ?? '');
  const [memo, setMemo] = useState(entry?.memo ?? '');
  const [status, setStatus] = useState<Status>(entry?.status ?? 'none');
  const save = () => {
    setPair(pair, { word: word.trim(), memo, status });
    onClose();
  };
  return (
    <Modal
      title={
        <>
          <span className="pair-big">{pair}</span>
          {reading && <span className="reading">（{reading}）</span>}
        </>
      }
      onClose={save}
    >
      <div className="stack">
        <label className="field">
          <span className="field-label">イメージ</span>
          <input value={word} onChange={(e) => setWord(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">メモ（由来・似ているペアとの区別など）</span>
          <textarea rows={3} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
        <div>
          <div className="field-label">ステータス</div>
          <div className="segmented">
            {STATUSES.map((s) => (
              <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        {rv && (
          <p className="muted small">
            練習 {rv.reps + rv.lapses} 回 ・ 平均想起 {formatSec(avgTime(rv))} 秒 ・ ミス {rv.lapses} 回{' '}
            <button className="link" onClick={() => resetReview(pairReviewKey(pair))}>
              記録をリセット
            </button>
          </p>
        )}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>
            変更を破棄
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </Modal>
  );
}
