import { useMemo, useState } from 'react';
import { colors } from '../cube/cube';
import { cancel, flatten, flatToString, invertAlgText, moveCount, parseAlg } from '../cube/notation';
import { stickerName, type PieceType, type StickerId } from '../cube/pieces';
import { stateAfter } from '../cube/verify';
import { labelOf, pairReading, pairText } from '../data/labels';
import { algKey, algReviewKey, STATUSES, STATUS_LABEL, useStore, type AlgEntry, type Status } from '../data/store';
import { avgExecTime, avgTime, formatSec } from '../data/srs';
import { CubeNet } from './CubeNet';
import { useElliottTable, useSuggestions } from './suggestions';
import { ELLIOTT_NAME } from '../data/elliott';
import { cachedVerify, Modal, VerifyBadge } from './shared';

interface Props {
  pt: PieceType;
  a: StickerId;
  b: StickerId;
  onClose: () => void;
}

function expansion(text: string): { text: string; count: number } | null {
  try {
    const flat = cancel(flatten(parseAlg(text)));
    return { text: flatToString(flat), count: moveCount(text) };
  } catch {
    return null;
  }
}

function safeMoveCount(text: string): number | null {
  try {
    return moveCount(text);
  } catch {
    return null;
  }
}

function SuggestionList({
  pt,
  a,
  b,
  current,
  onPick,
}: {
  pt: PieceType;
  a: StickerId;
  b: StickerId;
  current: string[];
  onPick: (alg: string, asMain: boolean) => void;
}) {
  const cfg = useStore((s) => s.pieces[pt]);
  const table = useSuggestions(pt, cfg.size, cfg.buffer);
  const elliott = useElliottTable(pt, cfg.buffer);
  const [open, setOpen] = useState(true);
  const fromSheet = elliott?.[`${a}|${b}`];
  const generated = table?.[`${a}|${b}`] ?? [];
  const list: { alg: string; moves: number | null; source?: string }[] = [
    ...(fromSheet ? [{ alg: fromSheet, moves: safeMoveCount(fromSheet), source: ELLIOTT_NAME }] : []),
    ...generated.filter((g) => g.alg !== fromSheet),
  ];
  const have = new Set(current.map((x) => x.replace(/\s+/g, ' ').trim()));
  return (
    <div className="suggest">
      <button className="suggest-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="field-label">おすすめ手順</span>
        <span className="muted small">{open ? '閉じる' : '開く'}</span>
      </button>
      {open && (
        <>
          {!table && !fromSheet && <p className="muted small">候補を計算しています…（初回のみ数秒かかります）</p>}
          {table && list.length === 0 && (
            <p className="muted small">このケースは短い交換子では見つかりませんでした（9 手以上の特殊な手順が必要なケースです）。下の欄に手入力してください。</p>
          )}
          <ul className="suggest-list">
            {list.map((s) => {
              const added = have.has(s.alg);
              return (
                <li key={s.alg}>
                  <span className="suggest-alg">
                    {s.source && <span className="source-tag">{s.source}</span>}
                    {s.alg}
                  </span>
                  <span className="muted small">{s.moves !== null ? `${s.moves} 手` : ''}</span>
                  <span className="row">
                    <button className="btn small primary" disabled={added} onClick={() => onPick(s.alg, true)}>
                      {added ? '追加済み' : 'メインにする'}
                    </button>
                    {!added && (
                      <button className="btn small" onClick={() => onPick(s.alg, false)}>
                        候補に追加
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {list.length > 0 && (
            <p className="muted small">
              {fromSheet && 'Elliott の手順表（Full Floating & More）の手順を先頭に、'}
              自動生成の候補は手数と回しやすさ（R・U 中心か、B や S が少ないか）で並べています。
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function AlgEditor({ pt, a, b, onClose }: Props) {
  const cfg = useStore((s) => s.pieces[pt]);
  const key = algKey(pt, cfg.buffer, a, b);
  const entry = useStore((s) => s.algs[key]);
  const reverse = useStore((s) => s.algs[algKey(pt, cfg.buffer, b, a)]);
  const reviewState = useStore((s) => s.reviews[algReviewKey(key)]);
  const setAlg = useStore((s) => s.setAlg);
  const deleteAlg = useStore((s) => s.deleteAlg);
  const resetReview = useStore((s) => s.resetReview);

  const [algs, setAlgs] = useState<string[]>(entry?.algs.length ? entry.algs : ['']);
  const [main, setMain] = useState(entry?.main ?? 0);
  const [status, setStatus] = useState<Status>(entry?.status ?? 'none');
  const [memo, setMemo] = useState(entry?.memo ?? '');
  const [showAfter, setShowAfter] = useState(false);

  const pair = pairText(pt, cfg, a, b);
  const reading = pairReading(cfg, pair);
  const mainText = algs[main] ?? '';
  const after = useMemo(() => (showAfter ? stateAfter(mainText, cfg.size) : null), [showAfter, mainText, cfg.size]);

  const save = () => {
    const list = algs.map((s) => s.trim()).filter(Boolean);
    const mainIdx = Math.min(Math.max(0, list.indexOf(algs[main]?.trim() ?? '')), Math.max(0, list.length - 1));
    if (!list.length && !memo.trim() && status === 'none') {
      if (entry) deleteAlg(key);
    } else {
      const patch: Partial<AlgEntry> = { algs: list, main: mainIdx, status, memo };
      setAlg(key, patch);
    }
    onClose();
  };

  const reverseMain = reverse?.algs[reverse.main];

  return (
    <Modal
      wide
      title={
        <>
          <span className="pair-big">{pair}</span>
          {reading && <span className="reading">（{reading}）</span>}
        </>
      }
      onClose={save}
    >
      <p className="muted small">
        {stickerName(pt, cfg.buffer)}（バッファ）→ {stickerName(pt, a)}（{labelOf(pt, cfg, a)}）→ {stickerName(pt, b)}（{labelOf(pt, cfg, b)}） ・ {cfg.size}x{cfg.size} で確認
      </p>
      <div className="editor-grid">
        <div>
          <CubeNet
            n={cfg.size}
            pieceType={pt}
            labels={cfg.labels}
            colorOf={after ? colors(after, cfg.size) : undefined}
            marks={
              showAfter
                ? []
                : [
                    { id: cfg.buffer, kind: 'buffer' },
                    { id: a, kind: 'first' },
                    { id: b, kind: 'second' },
                  ]
            }
            dimOthers={!showAfter}
          />
          <label className="check">
            <input type="checkbox" checked={showAfter} onChange={(e) => setShowAfter(e.target.checked)} />
            メイン手順を揃った状態から回した結果を表示
          </label>
        </div>
        <div className="stack">
          <SuggestionList
            pt={pt}
            a={a}
            b={b}
            current={algs}
            onPick={(alg, asMain) => {
              const empty = algs.findIndex((x) => !x.trim());
              if (empty >= 0) {
                setAlgs(algs.map((x, j) => (j === empty ? alg : x)));
                if (asMain) setMain(empty);
              } else {
                setAlgs([...algs, alg]);
                if (asMain) setMain(algs.length);
              }
              if (status === 'none') setStatus('learning');
            }}
          />
          <div className="field-label">登録した手順（自分で書くこともできます）</div>
          {algs.map((text, i) => {
            const v = cachedVerify(pt, cfg, a, b, text);
            const ex = text.trim() ? expansion(text) : null;
            return (
              <div key={i} className={i === main ? 'alg-row main' : 'alg-row'}>
                <div className="alg-row-head">
                  <label className="radio">
                    <input type="radio" name="main" checked={i === main} onChange={() => setMain(i)} />
                    {i === main ? 'メイン' : '候補'}
                  </label>
                  <VerifyBadge result={v} />
                  {ex && <span className="muted small">{ex.count} 手</span>}
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
                  value={text}
                  rows={2}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  placeholder="例: [R U R', D]  /  [U': [R' D R, U2]]"
                  onChange={(e) => setAlgs(algs.map((s, j) => (j === i ? e.target.value : s)))}
                />
                {v.kind === 'error' && <p className="error small">{v.message}</p>}
                {v.kind === 'mismatch' && (
                  <p className="error small">
                    このケースの 3-cycle になっていません
                    {v.detected && `（実際は ${pairText(pt, cfg, v.detected[0], v.detected[1])} のケース）`}
                  </p>
                )}
                {ex && <p className="expansion">{ex.text}</p>}
              </div>
            );
          })}
          <div className="row wrap">
            <button className="btn" onClick={() => setAlgs([...algs, ''])}>
              ＋ 候補を追加
            </button>
            {reverseMain && (
              <button
                className="btn"
                onClick={() => {
                  try {
                    const inv = invertAlgText(reverseMain);
                    const empty = algs.findIndex((s) => !s.trim());
                    if (empty >= 0) setAlgs(algs.map((s, j) => (j === empty ? inv : s)));
                    else setAlgs([...algs, inv]);
                  } catch {
                    /* 逆ケースの手順が読めない */
                  }
                }}
              >
                逆ケース（{pairText(pt, cfg, b, a)}）を反転して追加
              </button>
            )}
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
            <span className="field-label">メモ（指使い・覚え方など）</span>
            <textarea value={memo} rows={2} onChange={(e) => setMemo(e.target.value)} />
          </label>
          {reviewState && reviewState.reps + reviewState.lapses > 0 && (
            <p className="muted small">
              練習 {reviewState.reps + reviewState.lapses} 回 ・ 平均想起 {formatSec(avgTime(reviewState))} 秒
              {avgExecTime(reviewState) !== null && ` ・ 平均実行 ${formatSec(avgExecTime(reviewState))} 秒`} ・ ミス {reviewState.lapses} 回{' '}
              <button className="link" onClick={() => resetReview(algReviewKey(key))}>
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
      </div>
    </Modal>
  );
}
