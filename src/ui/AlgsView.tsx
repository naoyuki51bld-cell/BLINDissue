import { useMemo, useState } from 'react';
import { PIECE_EVENTS, stickerName, type PieceType, type StickerId } from '../cube/pieces';
import { labelOf, pairReading, pairText } from '../data/labels';
import { algKey, algReviewKey, STATUSES, STATUS_LABEL, useStore, type AlgEntry, type Status } from '../data/store';
import { loadSuggestions } from './suggestions';
import { avgTime, formatSec } from '../data/srs';
import { AlgEditor } from './AlgEditor';
import { cachedVerify, PieceTabs, StatusBadge, useCases, usePersisted, useTargets, VerifyBadge } from './shared';

type Filter = 'all' | 'missing' | 'ng' | Status;

export function AlgsView() {
  const [pt, setPt] = usePersisted<PieceType>('algs.pt', 'corner');
  const [view, setView] = usePersisted<'list' | 'grid'>('algs.view', 'list');
  const [first, setFirst] = useState<StickerId | 'all'>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<[StickerId, StickerId] | null>(null);
  const cfg = useStore((s) => s.pieces[pt]);
  const algs = useStore((s) => s.algs);
  const reviews = useStore((s) => s.reviews);
  const cases = useCases(pt, cfg.buffer);
  const targets = useTargets(pt, cfg.buffer);

  const rows = useMemo(
    () =>
      cases.map(([a, b]) => {
        const key = algKey(pt, cfg.buffer, a, b);
        const entry = algs[key];
        const main = entry?.algs[entry.main] ?? '';
        const verify = main ? cachedVerify(pt, cfg, a, b, main) : null;
        return { a, b, key, entry, main, verify, pair: pairText(pt, cfg, a, b) };
      }),
    [cases, algs, pt, cfg],
  );

  const stats = useMemo(() => {
    const registered = rows.filter((r) => r.main).length;
    const ng = rows.filter((r) => r.verify && r.verify.kind !== 'ok').length;
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => (r.entry?.status ?? 'none') === s).length]));
    return { registered, ng, byStatus };
  }, [rows]);

  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (first !== 'all' && r.a !== first) return false;
    const st = r.entry?.status ?? 'none';
    if (filter === 'missing' && r.main) return false;
    if (filter === 'ng' && !(r.verify && r.verify.kind !== 'ok')) return false;
    if (STATUSES.includes(filter as Status) && st !== filter) return false;
    if (q && !r.pair.toLowerCase().includes(q) && !r.main.toLowerCase().includes(q) && !(r.entry?.memo ?? '').toLowerCase().includes(q))
      return false;
    return true;
  });

  return (
    <div className="page">
      <PieceTabs value={pt} onChange={(p) => { setPt(p); setFirst('all'); }} />
      <div className="summary">
        <div>
          <strong>{stats.registered}</strong> / {rows.length} ケース登録
          {stats.ng > 0 && (
            <button className="link danger" onClick={() => setFilter('ng')}>
              ・要確認 {stats.ng}
            </button>
          )}
        </div>
        <div className="muted small">
          バッファ {stickerName(pt, cfg.buffer)}（{labelOf(pt, cfg, cfg.buffer)}）・{PIECE_EVENTS[pt]}・
          {STATUSES.map((s) => `${STATUS_LABEL[s]} ${stats.byStatus[s]}`).join(' / ')}
        </div>
        <ProgressBar counts={STATUSES.map((s) => stats.byStatus[s])} />
        <BulkFill key={`${pt}-${cfg.buffer}`} pt={pt} missing={rows.filter((r) => !r.main).map((r) => [r.a, r.b] as [StickerId, StickerId])} />
      </div>

      <div className="toolbar">
        <div className="segmented">
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            一覧
          </button>
          <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>
            表
          </button>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="絞り込み">
          <option value="all">すべて</option>
          <option value="missing">手順が未登録</option>
          <option value="ng">要確認（✗・記号エラー）</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input className="search" type="search" placeholder="ペア・手順・メモで検索" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {view === 'list' && (
        <div className="chips scroll" aria-label="1 文字目">
          <button className={first === 'all' ? 'chip small active' : 'chip small'} onClick={() => setFirst('all')}>
            全部
          </button>
          {targets.map((t) => (
            <button key={t} className={first === t ? 'chip small active' : 'chip small'} onClick={() => setFirst(t)}>
              {labelOf(pt, cfg, t)}
            </button>
          ))}
        </div>
      )}

      {view === 'list' ? (
        <ul className="case-list">
          {visible.map((r) => {
            const reading = pairReading(cfg, r.pair);
            const t = avgTime(reviews[algReviewKey(r.key)]);
            return (
              <li key={r.key}>
                <button className="case-row" onClick={() => setEditing([r.a, r.b])}>
                  <span className="case-pair">
                    {r.pair}
                    {reading && <small>{reading}</small>}
                  </span>
                  <span className="case-alg">{r.main || <span className="muted">未登録</span>}</span>
                  <span className="case-meta">
                    <VerifyBadge result={r.verify} />
                    {r.entry && r.entry.algs.length > 1 && <span className="muted small">+{r.entry.algs.length - 1}</span>}
                    {t !== null && <span className="muted small">{formatSec(t)}s</span>}
                    <StatusBadge status={r.entry?.status ?? 'none'} />
                  </span>
                </button>
              </li>
            );
          })}
          {visible.length === 0 && <li className="muted empty">該当するケースはありません</li>}
        </ul>
      ) : (
        <AlgGrid pt={pt} targets={targets} rows={visible} onOpen={(a, b) => setEditing([a, b])} />
      )}

      {editing && <AlgEditor pt={pt} a={editing[0]} b={editing[1]} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BulkFill({ pt, missing }: { pt: PieceType; missing: [StickerId, StickerId][] }) {
  const cfg = useStore((s) => s.pieces[pt]);
  const setAlgsBulk = useStore((s) => s.setAlgsBulk);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (missing.length === 0 && !message) return null;
  return (
    <div className="row wrap">
      {missing.length > 0 && <button
        className="btn small"
        disabled={busy}
        onClick={async () => {
          if (!confirm(`手順が未登録の ${missing.length} ケースに、おすすめ手順の 1 番目をまとめて登録します。あとから 1 つずつ選び直せます。よろしいですか？`)) return;
          setBusy(true);
          const table = await loadSuggestions(pt, cfg.size, cfg.buffer);
          const patch: Record<string, Partial<AlgEntry>> = {};
          for (const [a, b] of missing) {
            const top = table[`${a}|${b}`]?.[0];
            if (top) patch[algKey(pt, cfg.buffer, a, b)] = { algs: [top.alg], main: 0 };
          }
          setAlgsBulk(patch);
          setBusy(false);
          const n = Object.keys(patch).length;
          setMessage(`${n} ケースに登録しました${n < missing.length ? `（${missing.length - n} ケースは候補が見つからず未登録のままです）` : ''}。`);
        }}
      >
        {busy ? '計算中…' : `未登録の ${missing.length} ケースにおすすめ手順を一括登録`}
      </button>}
      {message && <span className="muted small">{message}</span>}
    </div>
  );
}

export function ProgressBar({ counts }: { counts: number[] }) {
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="progress" aria-hidden>
      {counts.map((c, i) => (
        <span key={i} className={`seg seg-${STATUSES[i]}`} style={{ width: `${(c / total) * 100}%` }} />
      ))}
    </div>
  );
}

function AlgGrid({
  pt,
  targets,
  rows,
  onOpen,
}: {
  pt: PieceType;
  targets: StickerId[];
  rows: { a: StickerId; b: StickerId; main: string; entry?: { status: Status }; verify: ReturnType<typeof cachedVerify> | null }[];
  onOpen: (a: StickerId, b: StickerId) => void;
}) {
  const cfg = useStore((s) => s.pieces[pt]);
  const map = new Map(rows.map((r) => [`${r.a}|${r.b}`, r]));
  return (
    <div className="grid-wrap">
      <table className="alg-grid">
        <thead>
          <tr>
            <th className="corner-cell">1＼2</th>
            {targets.map((t) => (
              <th key={t}>{labelOf(pt, cfg, t)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {targets.map((a) => (
            <tr key={a}>
              <th>{labelOf(pt, cfg, a)}</th>
              {targets.map((b) => {
                const r = map.get(`${a}|${b}`);
                if (!r) return <td key={b} className="na" />;
                const st = r.entry?.status ?? 'none';
                const bad = r.verify && r.verify.kind !== 'ok';
                return (
                  <td key={b} className={`gc st-${st}${r.main ? '' : ' empty'}${bad ? ' bad' : ''}`}>
                    <button onClick={() => onOpen(a, b)} title={`${labelOf(pt, cfg, a)}${labelOf(pt, cfg, b)}: ${r.main || '未登録'}`}>
                      {bad ? '✗' : r.main ? '●' : ''}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">● 登録済み（色はステータス）・ ✗ 要確認 ・ セルを押すと編集</p>
    </div>
  );
}
