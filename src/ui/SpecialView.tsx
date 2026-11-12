import { useEffect, useMemo, useState } from 'react';
import { moveCount } from '../cube/notation';
import { stickerName, type StickerId } from '../cube/pieces';
import {
  checkSpecial,
  describeAlg,
  flipCases,
  ltctCases,
  orderEdges,
  parityCases,
  pieceRefId,
  SPECIAL_LABEL,
  specialKey,
  TWIST_LABEL,
  type SpecialCase,
  type SpecialCheck,
  type SpecialKind,
} from '../cube/special';
import { elliottFlips, elliottParity, ELLIOTT_NAME, loadElliott } from '../data/elliott';
import { labelOf } from '../data/labels';
import { algReviewKey, STATUSES, STATUS_LABEL, useStore, type AlgEntry, type PieceConfig, type Status } from '../data/store';
import { avgTime, formatSec } from '../data/srs';
import { Modal, StatusBadge } from './shared';

const checkCache = new Map<string, SpecialCheck>();
export function cachedSpecialCheck(c: SpecialCase, alg: string): SpecialCheck {
  const k = `${specialKey(c)}|${alg}`;
  let r = checkCache.get(k);
  if (!r) {
    r = checkSpecial(c, alg);
    if (checkCache.size > 5000) checkCache.clear();
    checkCache.set(k, r);
  }
  return r;
}

export function specialCasesFor(kind: SpecialKind, cornerBuffer: StickerId): SpecialCase[] {
  if (kind === 'parity') return parityCases(cornerBuffer);
  if (kind === 'flip') return flipCases();
  return ltctCases(cornerBuffer);
}

/** ケースの見出し（ユーザーの文字）と補足（位置名） */
export function specialTitle(c: SpecialCase, corner: PieceConfig, edge: PieceConfig): { title: string; sub: string } {
  if (c.kind === 'parity')
    return { title: labelOf('corner', corner, c.target), sub: `最後のターゲット ${stickerName('corner', c.target)}` };
  if (c.kind === 'flip')
    return {
      title: `${labelOf('edge', edge, c.a)}・${labelOf('edge', edge, c.b)}`,
      sub: `${stickerName('edge', c.a)} と ${stickerName('edge', c.b)} のフリップ`,
    };
  return {
    title: `${labelOf('corner', corner, c.target)} ${c.dir === 'cw' ? '↻' : '↺'}${labelOf('corner', corner, c.twisted)}`,
    sub: `最後のターゲット ${stickerName('corner', c.target)}・${stickerName('corner', c.twisted)} が${TWIST_LABEL[c.dir]}にねじれ`,
  };
}

/** Elliott の表にある手順（パリティ・フリップのみ） */
export function useElliottSpecials(): { parity: Record<string, string>; flip: Record<string, string> } | null {
  const [v, setV] = useState<{ parity: Record<string, string>; flip: Record<string, string> } | null>(null);
  useEffect(() => {
    let alive = true;
    loadElliott().then((d) => alive && setV({ parity: elliottParity(d), flip: elliottFlips(d, (id) => pieceRefId('edge', id), orderEdges) }));
    return () => {
      alive = false;
    };
  }, []);
  return v;
}

export function elliottFor(c: SpecialCase, t: ReturnType<typeof useElliottSpecials>): string | undefined {
  if (!t) return undefined;
  if (c.kind === 'parity') return t.parity[`${c.buffer}|${c.target}`];
  if (c.kind === 'flip') return t.flip[`${c.a}|${c.b}`];
  return undefined;
}

const KIND_HELP: Record<SpecialKind, string> = {
  parity: 'コーナーのターゲットが奇数個のときに、最後のターゲットとバッファを交換し、エッジ 2 つも入れ替える手順です。どのエッジが入れ替わるかは手順から自動で判定して表示します。',
  flip: '2 つのエッジをその場で反転させる手順です。',
  ltct: 'Last Target Corner Twist。パリティの最後のターゲットと、ねじれたコーナー 1 つを同時に解く手順です。「時計回りにねじれ」は白・黄の色が時計回り側の面にある状態です。',
};

export function SpecialView({ kind }: { kind: SpecialKind }) {
  const corner = useStore((s) => s.pieces.corner);
  const edge = useStore((s) => s.pieces.edge);
  const algs = useStore((s) => s.algs);
  const reviews = useStore((s) => s.reviews);
  const setAlgsBulk = useStore((s) => s.setAlgsBulk);
  const elliott = useElliottSpecials();
  const [editing, setEditing] = useState<SpecialCase | null>(null);
  const [group, setGroup] = useState<string>('all');
  const [message, setMessage] = useState('');
  const cases = useMemo(() => specialCasesFor(kind, corner.buffer), [kind, corner.buffer]);

  const rows = cases.map((c) => {
    const key = specialKey(c);
    const e = algs[key];
    const main = e?.algs[e.main] ?? '';
    const check = main ? cachedSpecialCheck(c, main) : null;
    return { c, key, e, main, check, ...specialTitle(c, corner, edge) };
  });
  const registered = rows.filter((r) => r.main).length;
  const fromSheet = rows.filter((r) => !r.main && elliottFor(r.c, elliott));
  const groups = kind === 'ltct' ? [...new Set(cases.map((c) => (c.kind === 'ltct' ? c.target : '')))] : [];
  const visible = rows.filter((r) => group === 'all' || (r.c.kind === 'ltct' && r.c.target === group));

  return (
    <div className="stack">
      <div className="summary">
        <div>
          <strong>{registered}</strong> / {rows.length} ケース登録
          {kind !== 'flip' && <span className="muted small">（コーナーのバッファ {stickerName('corner', corner.buffer)}）</span>}
        </div>
        <p className="muted small">{KIND_HELP[kind]}</p>
        {fromSheet.length > 0 && (
          <div className="row wrap">
            <button
              className="btn small"
              onClick={() => {
                const patch: Record<string, Partial<AlgEntry>> = {};
                for (const r of fromSheet) patch[r.key] = { algs: [elliottFor(r.c, elliott)!], main: 0 };
                setAlgsBulk(patch);
                setMessage(`${fromSheet.length} ケースに Elliott の手順を登録しました。`);
              }}
            >
              未登録の {fromSheet.length} ケースに Elliott の手順を登録
            </button>
          </div>
        )}
        {kind === 'ltct' && <p className="muted small">LTCT の手順表は内蔵していないので、手入力してください（入力した手順は自動でチェックします）。</p>}
        {message && <p className="muted small">{message}</p>}
      </div>
      {kind === 'ltct' && (
        <div className="chips scroll" aria-label="最後のターゲット">
          <button className={group === 'all' ? 'chip small active' : 'chip small'} onClick={() => setGroup('all')}>
            全部
          </button>
          {groups.map((g) => (
            <button key={g} className={group === g ? 'chip small active' : 'chip small'} onClick={() => setGroup(g)}>
              {labelOf('corner', corner, g)}
            </button>
          ))}
        </div>
      )}
      <ul className="case-list">
        {visible.map((r) => {
          const t = avgTime(reviews[algReviewKey(r.key)]);
          return (
            <li key={r.key}>
              <button className="case-row special" onClick={() => setEditing(r.c)}>
                <span className="case-pair">
                  {r.title}
                  <small>{r.sub}</small>
                </span>
                <span className="case-alg">
                  {r.main || <span className="muted">未登録</span>}
                  {r.check?.ok && r.check.swap && <small className="muted"> （{r.check.swap}）</small>}
                </span>
                <span className="case-meta">
                  {r.check && <span className={r.check.ok ? 'vbadge ok' : 'vbadge ng'}>{r.check.ok ? '✓' : '✗'}</span>}
                  {t !== null && <span className="muted small">{formatSec(t)}s</span>}
                  <StatusBadge status={r.e?.status ?? 'none'} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {editing && <SpecialEditor c={editing} elliott={elliottFor(editing, elliott)} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SpecialEditor({ c, elliott, onClose }: { c: SpecialCase; elliott?: string; onClose: () => void }) {
  const corner = useStore((s) => s.pieces.corner);
  const edge = useStore((s) => s.pieces.edge);
  const key = specialKey(c);
  const entry = useStore((s) => s.algs[key]);
  const setAlg = useStore((s) => s.setAlg);
  const deleteAlg = useStore((s) => s.deleteAlg);
  const [algs, setAlgs] = useState<string[]>(entry?.algs.length ? entry.algs : ['']);
  const [main, setMain] = useState(entry?.main ?? 0);
  const [status, setStatus] = useState<Status>(entry?.status ?? 'none');
  const [memo, setMemo] = useState(entry?.memo ?? '');
  const { title, sub } = specialTitle(c, corner, edge);

  const save = () => {
    const list = algs.map((x) => x.trim()).filter(Boolean);
    const mainIdx = Math.min(Math.max(0, list.indexOf(algs[main]?.trim() ?? '')), Math.max(0, list.length - 1));
    if (!list.length && !memo.trim() && status === 'none') {
      if (entry) deleteAlg(key);
    } else setAlg(key, { algs: list, main: mainIdx, status, memo });
    onClose();
  };
  const pick = (alg: string) => {
    const empty = algs.findIndex((x) => !x.trim());
    if (empty >= 0) {
      setAlgs(algs.map((x, j) => (j === empty ? alg : x)));
      setMain(empty);
    } else {
      setAlgs([...algs, alg]);
      setMain(algs.length);
    }
    if (status === 'none') setStatus('learning');
  };

  return (
    <Modal
      title={
        <>
          <span className="muted small">{SPECIAL_LABEL[c.kind]}</span> <span className="pair-big">{title}</span>
        </>
      }
      onClose={save}
    >
      <p className="muted small">{sub}</p>
      {elliott && (
        <div className="suggest">
          <div className="field-label">おすすめ手順</div>
          <ul className="suggest-list">
            <li>
              <span className="suggest-alg">
                <span className="source-tag">{ELLIOTT_NAME}</span>
                {elliott}
              </span>
              <span className="muted small">{safeCount(elliott)} 手</span>
              <span className="row">
                <button className="btn small primary" disabled={algs.includes(elliott)} onClick={() => pick(elliott)}>
                  {algs.includes(elliott) ? '追加済み' : 'メインにする'}
                </button>
              </span>
            </li>
          </ul>
        </div>
      )}
      <div className="field-label">登録した手順（自分で書くこともできます）</div>
      {algs.map((text, i) => {
        const r = text.trim() ? cachedSpecialCheck(c, text) : null;
        return (
          <div key={i} className={i === main ? 'alg-row main' : 'alg-row'}>
            <div className="alg-row-head">
              <label className="radio">
                <input type="radio" name="main" checked={i === main} onChange={() => setMain(i)} />
                {i === main ? 'メイン' : '候補'}
              </label>
              {r && <span className={r.ok ? 'vbadge ok' : 'vbadge ng'}>{r.ok ? '✓' : '✗'}</span>}
              {r?.ok && r.swap && <span className="muted small">エッジ {r.swap}</span>}
              <span className="spacer" />
              {algs.length > 1 && (
                <button
                  className="link danger"
                  onClick={() => {
                    setAlgs(algs.filter((_, j) => j !== i));
                    if (main >= i && main > 0) setMain(main - 1);
                  }}
                >
                  削除
                </button>
              )}
            </div>
            <textarea
              className="alg-input"
              rows={2}
              value={text}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(e) => setAlgs(algs.map((x, j) => (j === i ? e.target.value : x)))}
            />
            {r && !r.ok && <p className="error small">{r.message}</p>}
          </div>
        );
      })}
      <div className="row wrap">
        <button className="btn" onClick={() => setAlgs([...algs, ''])}>
          ＋ 候補を追加
        </button>
      </div>
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
      <label className="field">
        <span className="field-label">メモ</span>
        <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} />
      </label>
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>
          変更を破棄
        </button>
        <button className="btn primary" onClick={save}>
          保存
        </button>
      </div>
    </Modal>
  );
}

function safeCount(t: string) {
  try {
    return moveCount(t);
  } catch {
    return '?';
  }
}

export { describeAlg };
