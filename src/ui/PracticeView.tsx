import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { casesFor, PIECE_LABEL, stickerName, type PieceType, type StickerId } from '../cube/pieces';
import { labelOf, pairReading, pairText } from '../data/labels';
import { algKey, algReviewKey, pairReviewKey, STATUSES, STATUS_LABEL, useStore, type Status } from '../data/store';
import { avgTime, formatSec, isDue, isNew, type Grade, type ReviewState } from '../data/srs';
import { PieceTabs, usePersisted, useTargets } from './shared';
import { SmartCubePanel, SmartSession, smartDebug } from './SmartPractice';
import { useSmartCube } from '../smartcube/connection';
import { SPECIAL_LABEL, specialKey, type SpecialCase, type SpecialKind } from '../cube/special';
import { specialCasesFor, specialTitle } from './SpecialView';

type Content = 'alg' | 'pair' | SpecialKind;
const SPECIAL_CONTENT: SpecialKind[] = ['parity', 'flip', 'ltct'];
type Scope = 'due' | 'all' | 'weak' | 'new';

export interface Card {
  reviewKey: string;
  /** 手順カードのとき: スマートキューブで判定するためのケース */
  target?: { pt: PieceType; buffer: StickerId; a: StickerId; b: StickerId };
  /** パリティ・フリップ・LTCT のとき */
  special?: SpecialCase;
  prompt: string;
  reading: string | null;
  sub: string;
  answer: string[];
  memo: string;
}

export interface Result {
  card: Card;
  time: number;
  grade: Grade;
  /** スマートキューブ練習での実行時間 */
  exec?: number;
}

export const GRADES: { g: Grade; label: string; key: string }[] = [
  { g: 0, label: 'もう一度', key: '1' },
  { g: 1, label: '難しい', key: '2' },
  { g: 2, label: '普通', key: '3' },
  { g: 3, label: '簡単', key: '4' },
];

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isWeak(r: ReviewState | undefined, slowMs: number) {
  if (!r) return false;
  const t = avgTime(r);
  return (r.lastGrade !== undefined && r.lastGrade <= 1) || (t !== null && t > slowMs);
}

export function PracticeView() {
  const [content, setContent] = usePersisted<Content>('practice.content', 'alg');
  const [pt, setPt] = usePersisted<PieceType>('practice.pt', 'corner');
  const [scope, setScope] = usePersisted<Scope>('practice.scope', 'due');
  const [statuses, setStatuses] = usePersisted<Status[]>('practice.statuses', []);
  const [firsts, setFirsts] = useState<StickerId[]>([]);
  const [limit, setLimit] = usePersisted<number>('practice.limit', 30);
  const [slowSec, setSlowSec] = usePersisted<number>('practice.slow', 2);
  const [session, setSessionState] = useState<{ id: number; cards: Card[] } | null>(null);
  // 練習を始めるたびに画面を作り直す（「苦手をもう一度」で前の練習の状態が残らないように）
  const setSession = (cards: Card[] | null) => setSessionState(cards ? { id: Date.now(), cards } : null);
  const [bufferChoice, setBufferChoice] = usePersisted<Record<string, string>>('practice.buffers', {});
  const [smart, setSmart] = usePersisted<boolean>('practice.smart', false);
  const isSpecial = SPECIAL_CONTENT.includes(content as SpecialKind);
  const smartAvailable = isSpecial || (content === 'alg' && (pt === 'corner' || pt === 'edge'));
  const useSmart = smart && smartAvailable;

  const smartStatus = useSmartCube((s) => s.status);
  const cfg = useStore((s) => s.pieces[pt]);
  const cornerCfg = useStore((s) => s.pieces.corner);
  const edgeCfg = useStore((s) => s.pieces.edge);
  const algs = useStore((s) => s.algs);
  const pairs = useStore((s) => s.pairs);
  const reviews = useStore((s) => s.reviews);
  // 手順を登録してあるバッファ（多い順）
  const buffersWithAlgs = useMemo(() => {
    const m = new Map<StickerId, number>();
    for (const [k, e] of Object.entries(algs)) {
      if (!k.startsWith(`${pt}|`) || !e.algs.length) continue;
      const b = k.split('|')[1];
      m.set(b, (m.get(b) ?? 0) + 1);
    }
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [algs, pt]);
  const choice = bufferChoice[pt] ?? 'current';
  const selectedBuffers: StickerId[] =
    content !== 'alg' || choice === 'current'
      ? [cfg.buffer]
      : choice === 'all'
        ? buffersWithAlgs.map(([b]) => b)
        : [choice];
  const multiBuffer = selectedBuffers.length > 1 || selectedBuffers[0] !== cfg.buffer;
  const cases = useMemo(
    () => selectedBuffers.flatMap((buffer) => casesFor(pt, buffer).map(([a, b]) => ({ buffer, a, b }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pt, selectedBuffers.join(',')],
  );
  const targets = useTargets(pt, selectedBuffers[0] ?? cfg.buffer);

  const pool = useMemo(() => {
    const cards: (Card & { review?: ReviewState; status: Status })[] = [];
    if (isSpecial) {
      for (const c of specialCasesFor(content as SpecialKind, cornerCfg.buffer)) {
        const key = specialKey(c);
        const e = algs[key];
        if (!e || !e.algs.length) continue;
        const rk = algReviewKey(key);
        const { title, sub } = specialTitle(c, cornerCfg, edgeCfg);
        cards.push({ reviewKey: rk, special: c, prompt: title, reading: null, sub, answer: [e.algs[e.main], ...e.algs.filter((_, i) => i !== e.main)], memo: e.memo, review: reviews[rk], status: e.status });
      }
      return cards;
    }
    const seenPairs = new Set<string>();
    for (const { buffer, a, b } of cases) {
      if (firsts.length && !firsts.includes(a)) continue;
      const pair = pairText(pt, cfg, a, b);
      const reading = pairReading(cfg, pair);
      const sub = `${multiBuffer ? `バッファ ${stickerName(pt, buffer)}・` : ''}${stickerName(pt, a)} → ${stickerName(pt, b)}`;
      if (content === 'alg') {
        const key = algKey(pt, buffer, a, b);
        const e = algs[key];
        if (!e || !e.algs.length) continue;
        const rk = algReviewKey(key);
        cards.push({ reviewKey: rk, target: { pt, buffer, a, b }, prompt: pair, reading, sub, answer: [e.algs[e.main], ...e.algs.filter((_, i) => i !== e.main)], memo: e.memo, review: reviews[rk], status: e.status });
      } else {
        if (seenPairs.has(pair)) continue;
        seenPairs.add(pair);
        const e = pairs[pair];
        if (!e?.word) continue;
        const rk = pairReviewKey(pair);
        cards.push({ reviewKey: rk, prompt: pair, reading, sub: '', answer: [e.word], memo: e.memo, review: reviews[rk], status: e.status });
      }
    }
    return cards;
  }, [cases, firsts, pt, cfg, content, algs, pairs, reviews, isSpecial, cornerCfg, edgeCfg, multiBuffer]);

  const filtered = useMemo(() => {
    const now = Date.now();
    return pool.filter((c) => {
      if (statuses.length && !statuses.includes(c.status)) return false;
      if (scope === 'due') return isNew(c.review) || isDue(c.review, now);
      if (scope === 'weak') return isWeak(c.review, slowSec * 1000);
      if (scope === 'new') return isNew(c.review);
      return true;
    });
  }, [pool, statuses, scope, slowSec]);

  const start = (cards: Card[]) => {
    setSession(shuffle(cards).slice(0, limit > 0 ? limit : undefined));
  };

  if (session && useSmart)
    return (
      <SmartSession
        key={session.id}
        cards={session.cards}
        slowMs={slowSec * 1000}
        title={`${isSpecial ? SPECIAL_LABEL[content as SpecialKind] : PIECE_LABEL[pt]}・スマートキューブ`}
        onExit={() => setSession(null)}
        onRetry={(cards) => setSession(shuffle(cards))}
      />
    );

  if (session)
    return (
      <Session
        key={session.id}
        cards={session.cards}
        slowMs={slowSec * 1000}
        title={isSpecial ? SPECIAL_LABEL[content as SpecialKind] : `${PIECE_LABEL[pt]}・${content === 'alg' ? '手順' : 'レターペア'}`}
        onExit={() => setSession(null)}
        onRetry={(cards) => setSession(shuffle(cards))}
      />
    );

  const smartReady = smartStatus === 'connected' || smartDebug();
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="page">
      <div className="segmented big wrap">
        {(['alg', 'pair', ...SPECIAL_CONTENT] as Content[]).map((c) => (
          <button key={c} className={content === c ? 'active' : ''} onClick={() => setContent(c)}>
            {c === 'alg' ? '手順' : c === 'pair' ? 'レターペア' : SPECIAL_LABEL[c as SpecialKind]}
          </button>
        ))}
      </div>
      {!isSpecial && <PieceTabs value={pt} onChange={(p) => { setPt(p); setFirsts([]); }} />}

      <section className="card stack">
        {content === 'alg' && (
          <label className="field inline">
            <span className="field-label">バッファ</span>
            <select
              value={choice}
              onChange={(e) => {
                setBufferChoice({ ...bufferChoice, [pt]: e.target.value });
                setFirsts([]);
              }}
            >
              <option value="current">今のバッファ（{stickerName(pt, cfg.buffer)}）</option>
              {buffersWithAlgs
                .filter(([b]) => b !== cfg.buffer)
                .map(([b, n]) => (
                  <option key={b} value={b}>
                    {stickerName(pt, b)}（{n} ケース登録）
                  </option>
                ))}
              {buffersWithAlgs.length > 1 && <option value="all">すべてのバッファ（{buffersWithAlgs.length} 個）</option>}
            </select>
          </label>
        )}
        <div>
          <div className="field-label">出題範囲</div>
          <div className="segmented">
            {(
              [
                ['due', '復習期限'],
                ['weak', '苦手'],
                ['new', '未練習'],
                ['all', 'すべて'],
              ] as [Scope, string][]
            ).map(([s, l]) => (
              <button key={s} className={scope === s ? 'active' : ''} onClick={() => setScope(s)}>
                {l}
              </button>
            ))}
          </div>
          <p className="muted small">
            {scope === 'due' && '期限が来たものと未練習のものを出題します（間隔反復）。'}
            {scope === 'weak' && `直近で「もう一度・難しい」を付けたか、平均想起時間が ${slowSec} 秒より遅いものを出題します。`}
            {scope === 'new' && 'まだ一度も練習していないものを出題します。'}
            {scope === 'all' && '条件に合うものすべてから出題します。'}
          </p>
        </div>
        <div>
          <div className="field-label">ステータス（未選択なら全部）</div>
          <div className="chips">
            {STATUSES.map((s) => (
              <button key={s} className={statuses.includes(s) ? 'chip small active' : 'chip small'} onClick={() => setStatuses(toggle(statuses, s))}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        {!isSpecial && <div>
          <div className="field-label">1 文字目（未選択なら全部）</div>
          <div className="chips">
            {targets.map((t) => (
              <button key={t} className={firsts.includes(t) ? 'chip small active' : 'chip small'} onClick={() => setFirsts(toggle(firsts, t))}>
                {labelOf(pt, cfg, t)}
              </button>
            ))}
          </div>
        </div>}
        <div className="row wrap">
          <label className="field inline">
            <span className="field-label">出題数</span>
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[10, 20, 30, 50, 100, 0].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? '全部' : `${n} 問`}
                </option>
              ))}
            </select>
          </label>
          <label className="field inline">
            <span className="field-label">遅いとみなす時間</span>
            <select value={slowSec} onChange={(e) => setSlowSec(Number(e.target.value))}>
              {[0.5, 1, 1.5, 2, 3, 5].map((n) => (
                <option key={n} value={n}>
                  {n} 秒
                </option>
              ))}
            </select>
          </label>
        </div>
        {content !== 'pair' && (
          <div className="stack">
            <label className="check">
              <input type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} disabled={!smartAvailable} />
              スマートキューブで回して答える（自動で正誤判定・実行時間を計測）
            </label>
            {!smartAvailable && smart && <p className="muted small">スマートキューブは 3x3 なので、コーナー・エッジ・パリティ・フリップ・LTCT で使えます。</p>}
            {useSmart && <SmartCubePanel />}
          </div>
        )}
        <button className="btn primary big" disabled={filtered.length === 0 || (useSmart && !smartReady)} onClick={() => start(filtered)}>
          {filtered.length === 0 ? '出題できるものがありません' : `練習を始める（${Math.min(filtered.length, limit || filtered.length)} / ${filtered.length}）`}
        </button>
        {pool.length === 0 && (
          <p className="muted small">
            {content === 'pair' ? '「ペア」タブでイメージを登録してください。' : '「手順」タブで手順を登録するか、「設定」からスプレッドシートを取り込んでください。'}
          </p>
        )}
      </section>
    </div>
  );
}

function Session({
  cards: initialCards,
  slowMs,
  title,
  onExit,
  onRetry,
}: {
  cards: Card[];
  slowMs: number;
  title: string;
  onExit: () => void;
  onRetry: (cards: Card[]) => void;
}) {
  const recordReview = useStore((s) => s.recordReview);
  // 「もう一度」を付けたカードは最後にもう一度出す
  const [cards, setCards] = useState(initialCards);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const startRef = useRef(performance.now());
  const timeRef = useRef(0);
  const card = cards[index];
  const done = index >= cards.length;

  useEffect(() => {
    startRef.current = performance.now();
    setElapsed(0);
  }, [index]);

  useEffect(() => {
    if (done || revealed) return;
    const id = setInterval(() => setElapsed(performance.now() - startRef.current), 50);
    return () => clearInterval(id);
  }, [done, revealed]);

  const reveal = useCallback(() => {
    if (revealed || done) return;
    timeRef.current = performance.now() - startRef.current;
    setElapsed(timeRef.current);
    setRevealed(true);
  }, [revealed, done]);

  const grade = useCallback(
    (g: Grade) => {
      if (!revealed || done) return;
      recordReview(card.reviewKey, g, timeRef.current);
      setResults((r) => [...r, { card, time: timeRef.current, grade: g }]);
      if (g === 0) setCards((c) => [...c, card]);
      setRevealed(false);
      setIndex((i) => i + 1);
    },
    [revealed, done, card, recordReview],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!revealed) reveal();
        else grade(2);
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) grade((Number(e.key) - 1) as Grade);
      else if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, reveal, grade, onExit]);

  if (done) return <Summary results={results} slowMs={slowMs} onExit={onExit} onRetry={onRetry} />;

  const slow = elapsed > slowMs;
  return (
    <div className="page practice">
      <div className="row">
        <button className="btn ghost" onClick={onExit}>
          ← 終了
        </button>
        <span className="muted">{title}</span>
        <span className="spacer" />
        <span className="muted">
          {index + 1} / {cards.length}
        </span>
      </div>
      <div className="progress thin">
        <span className="seg seg-learned" style={{ width: `${(index / cards.length) * 100}%` }} />
      </div>
      <NextCard card={cards[index + 1]} />
      <button className="flashcard" onClick={revealed ? undefined : reveal} aria-live="polite">
        <span className="prompt">{card.prompt}</span>
        {card.reading && <span className="reading">{card.reading}</span>}
        {card.sub && <span className="muted small">{card.sub}</span>}
        <span className={slow ? 'timer slow' : 'timer'}>{formatSec(elapsed)}</span>
        {!revealed && <span className="hint">思い出したらタップ（スペースキー）</span>}
        {revealed && (
          <span className="answer">
            <span className="answer-main">{card.answer[0]}</span>
            {card.answer.slice(1).map((a, i) => (
              <span key={i} className="answer-alt">
                {a}
              </span>
            ))}
            {card.memo && <span className="answer-memo">{card.memo}</span>}
          </span>
        )}
      </button>
      {revealed ? (
        <div className="grades">
          {GRADES.map(({ g, label, key }) => (
            <button key={g} className={`btn grade g${g}`} onClick={() => grade(g)}>
              {label}
              <kbd>{key}</kbd>
            </button>
          ))}
        </div>
      ) : (
        <button className="btn primary big" onClick={reveal}>
          答えを見る
        </button>
      )}
    </div>
  );
}

const avgOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function Summary({ results, slowMs, onExit, onRetry }: { results: Result[]; slowMs: number; onExit: () => void; onRetry: (cards: Card[]) => void }) {
  const avg = results.length ? results.reduce((a, r) => a + r.time, 0) / results.length : null;
  const weak = [...new Map(results.filter((r) => r.grade <= 1 || r.time > slowMs).map((r) => [r.card.reviewKey, r])).values()];
  const sorted = results.slice().sort((a, b) => b.time - a.time);
  return (
    <div className="page">
      <section className="card stack">
        <h2>練習結果</h2>
        <div className="stats">
          <div>
            <strong>{results.length}</strong>
            <span>問</span>
          </div>
          <div>
            <strong>{formatSec(avg)}</strong>
            <span>{results.some((r) => r.exec !== undefined) ? '平均想起（秒）' : '平均（秒）'}</span>
          </div>
          {results.some((r) => r.exec !== undefined) && (
            <div>
              <strong>{formatSec(avgOf(results.filter((r) => r.exec !== undefined).map((r) => r.exec!)))}</strong>
              <span>平均実行（秒）</span>
            </div>
          )}
          <div>
            <strong>{results.filter((r) => r.grade === 0).length}</strong>
            <span>もう一度</span>
          </div>
          <div>
            <strong>{weak.length}</strong>
            <span>苦手</span>
          </div>
        </div>
        <div className="row wrap">
          {weak.length > 0 && (
            <button className="btn primary" onClick={() => onRetry(weak.map((w) => w.card))}>
              苦手だった {weak.length} 問をもう一度
            </button>
          )}
          <button className="btn" onClick={onExit}>
            終了
          </button>
        </div>
      </section>
      <ul className="case-list">
        {sorted.map((r, i) => (
          <li key={i} className="result-row">
            <span className="case-pair">
              {r.card.prompt}
              {r.card.reading && <small>{r.card.reading}</small>}
            </span>
            <span className="case-alg">{r.card.answer[0]}</span>
            <span className="case-meta">
              <span className={r.time > slowMs ? 'time slow' : 'time'}>{formatSec(r.time)}s</span>
              {r.exec !== undefined && <span className="time muted">+{formatSec(r.exec)}s</span>}
              <span className={`gtag g${r.grade}`}>{GRADES[r.grade].label}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 次に出てくる問題を小さく表示 */
export function NextCard({ card }: { card?: Card }) {
  return (
    <p className="next-card" aria-label="次の問題">
      次: {card ? <b>{card.prompt}</b> : <span className="muted">（これが最後）</span>}
      {card?.reading && <span className="muted"> {card.reading}</span>}
    </p>
  );
}
