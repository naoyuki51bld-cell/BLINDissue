import { useMemo, useState } from 'react';
import { PIECE_EVENTS, PIECE_LABEL, PIECE_TYPES, STICKER_IDS, stickerName, type PieceType, type StickerId } from '../cube/pieces';
import { bothLabels, labelOf, pairReading, pairText, secondLabelOf } from '../data/labels';
import { algKey, algReviewKey, STATUSES, STATUS_LABEL, useStore, type AlgEntry, type Status } from '../data/store';
import { loadSuggestions, useElliottBuffers, useElliottTable } from './suggestions';
import { avgTime, formatSec } from '../data/srs';
import { AlgEditor } from './AlgEditor';
import { cachedVerify, StatusBadge, useCases, usePersisted, useTargets, VerifyBadge } from './shared';
import { SpecialView } from './SpecialView';
import { SPECIAL_LABEL, type SpecialKind } from '../cube/special';
import { PairTable, TableLegend, TableOptions, timeTone, useTableOptions } from './PairTable';

type Filter = 'all' | 'missing' | 'ng' | Status;

type AlgTab = PieceType | SpecialKind;
const SPECIAL_KINDS: SpecialKind[] = ['parity', 'flip', 'ltct'];

export function AlgsView() {
  const [tab, setTab] = usePersisted<AlgTab>('algs.tab', 'corner');
  const isSpecial = SPECIAL_KINDS.includes(tab as SpecialKind);
  return (
    <div className="page">
      <div className="chips" role="tablist" aria-label="種類">
        {[...PIECE_TYPES, ...SPECIAL_KINDS].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`${tab === t ? 'chip active' : 'chip'}${SPECIAL_KINDS.includes(t as SpecialKind) ? ' special' : ''}`}
            onClick={() => setTab(t)}
          >
            {PIECE_LABEL[t as PieceType] ?? SPECIAL_LABEL[t as SpecialKind]}
          </button>
        ))}
      </div>
      {isSpecial ? <SpecialView kind={tab as SpecialKind} /> : <PieceAlgs key={tab} pt={tab as PieceType} />}
    </div>
  );
}

function PieceAlgs({ pt }: { pt: PieceType }) {
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
    <>
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
          {PIECE_EVENTS[pt]}・
          {STATUSES.map((s) => `${STATUS_LABEL[s]} ${stats.byStatus[s]}`).join(' / ')}
        </div>
        <ProgressBar counts={STATUSES.map((s) => stats.byStatus[s])} />
        <BufferPicker pt={pt} />
        <BulkFill key={`${pt}-${cfg.buffer}`} pt={pt} cases={cases} />
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
    </>
  );
}

function BulkFill({ pt, cases }: { pt: PieceType; cases: [StickerId, StickerId][] }) {
  const cfg = useStore((s) => s.pieces[pt]);
  const algs = useStore((s) => s.algs);
  const setAlgsBulk = useStore((s) => s.setAlgsBulk);
  const elliott = useElliottTable(pt, cfg.buffer);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const missing = cases.filter(([a, b]) => !algs[algKey(pt, cfg.buffer, a, b)]?.algs.length);
  const elliottCount = elliott ? cases.filter(([a, b]) => elliott[`${a}|${b}`]).length : 0;
  const notMain = elliott
    ? cases.filter(([a, b]) => {
        const alg = elliott[`${a}|${b}`];
        const e = algs[algKey(pt, cfg.buffer, a, b)];
        return alg && (!e || e.algs[e.main] !== alg);
      })
    : [];

  const fillMissing = async () => {
    const src = elliott ? 'Elliott の手順表（無いケースは自動生成の候補）' : 'おすすめ手順の 1 番目';
    if (!confirm(`手順が未登録の ${missing.length} ケースに、${src}をまとめて登録します。あとから 1 つずつ選び直せます。よろしいですか？`)) return;
    setBusy(true);
    const table = await loadSuggestions(pt, cfg.size, cfg.buffer);
    const patch: Record<string, Partial<AlgEntry>> = {};
    let fromElliott = 0;
    for (const [a, b] of missing) {
      const e = elliott?.[`${a}|${b}`];
      const top = e ?? table[`${a}|${b}`]?.[0]?.alg;
      if (e) fromElliott++;
      if (top) patch[algKey(pt, cfg.buffer, a, b)] = { algs: [top], main: 0 };
    }
    setAlgsBulk(patch);
    setBusy(false);
    const n = Object.keys(patch).length;
    setMessage(
      `${n} ケースに登録しました${elliott ? `（Elliott ${fromElliott}・自動生成 ${n - fromElliott}）` : ''}` +
        `${n < missing.length ? `。${missing.length - n} ケースは候補が見つからず未登録のままです` : ''}。`,
    );
  };

  const useElliott = () => {
    if (!elliott) return;
    if (!confirm(`${notMain.length} ケースのメイン手順を Elliott の手順表のものにします。今の手順は消さずに「候補」として残します。よろしいですか？`)) return;
    const patch: Record<string, Partial<AlgEntry>> = {};
    for (const [a, b] of notMain) {
      const key = algKey(pt, cfg.buffer, a, b);
      const alg = elliott[`${a}|${b}`];
      const cur = algs[key]?.algs ?? [];
      patch[key] = { algs: [alg, ...cur.filter((x) => x !== alg)], main: 0 };
    }
    setAlgsBulk(patch);
    setMessage(`${notMain.length} ケースのメイン手順を Elliott の手順にしました。`);
  };

  if (missing.length === 0 && notMain.length === 0 && !message && !elliott) return null;
  return (
    <div className="stack">
      {elliott && (
        <p className="muted small">
          このバッファには Elliott の手順表があります（{elliottCount} ケース）。
        </p>
      )}
      <div className="row wrap">
        {missing.length > 0 && (
          <button className="btn small" disabled={busy} onClick={fillMissing}>
            {busy ? '計算中…' : `未登録の ${missing.length} ケースにおすすめ手順を一括登録`}
          </button>
        )}
        {elliott && notMain.length > 0 && (
          <button className="btn small" onClick={useElliott}>
            Elliott の手順をメインにする（{notMain.length} ケース）
          </button>
        )}
      </div>
      {message && <span className="muted small">{message}</span>}
    </div>
  );
}

function BufferPicker({ pt }: { pt: PieceType }) {
  const cfg = useStore((s) => s.pieces[pt]);
  const setPiece = useStore((s) => s.setPiece);
  const withSheet = useElliottBuffers(pt);
  return (
    <label className="field inline">
      <span className="field-label">バッファ</span>
      <select value={cfg.buffer} onChange={(e) => setPiece(pt, { buffer: e.target.value })}>
        {STICKER_IDS.map((id) => (
          <option key={id} value={id}>
            {stickerName(pt, id)}（{bothLabels(pt, cfg, id)}）{withSheet.includes(id) ? ' ・Elliott 表あり' : ''}
          </option>
        ))}
      </select>
    </label>
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
  rows: { a: StickerId; b: StickerId; key: string; main: string; entry?: { status: Status }; verify: ReturnType<typeof cachedVerify> | null }[];
  onOpen: (a: StickerId, b: StickerId) => void;
}) {
  const cfg = useStore((s) => s.pieces[pt]);
  const reviews = useStore((s) => s.reviews);
  const opts = useTableOptions();
  const map = new Map(rows.map((r) => [`${r.a}|${r.b}`, r]));
  const rowHeads = targets.map((t) => ({ id: t, label: labelOf(pt, cfg, t) }));
  const colHeads = targets.map((t) => ({ id: t, label: secondLabelOf(pt, cfg, t) }));
  return (
    <div className="stack">
      <TableOptions opts={opts} />
      <PairTable
        rows={rowHeads}
        cols={colHeads}
        showText={opts.showText}
        onOpen={(a, b) => onOpen(a, b)}
        cell={(a, b) => {
          const r = map.get(`${a}|${b}`);
          if (!r) return null;
          const rv = reviews[algReviewKey(r.key)];
          const tone = opts.color === 'time' ? (r.main ? timeTone(rv, opts.slowSec) : 'none') : r.entry?.status ?? 'none';
          const t = avgTime(rv);
          return {
            text: r.main,
            tone,
            bad: !!r.verify && r.verify.kind !== 'ok',
            title: `${pairText(pt, cfg, a, b)}: ${r.main || '未登録'}${t !== null ? `（平均 ${formatSec(t)} 秒）` : ''}`,
          };
        }}
      />
      <TableLegend mode={opts.color} slowSec={opts.slowSec} />
    </div>
  );
}
