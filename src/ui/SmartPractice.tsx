import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FACES, type Face } from '../cube/cube';
import { useStore } from '../data/store';
import { formatSec, type Grade } from '../data/srs';
import { bluetoothSupport, useSmartCube } from '../smartcube/connection';
import { AttemptTracker, COLOR_NAMES, turnToString, validFronts } from '../smartcube/tracker';
import { GRADES, NextCard, Summary, type Card, type Result } from './PracticeView';
import { checkSpecialState } from '../cube/special';

export function smartDebug(): boolean {
  return typeof window !== 'undefined' && /[?&]debug\b/.test(window.location.search);
}

export function SmartCubePanel() {
  const { status, deviceName, battery, error, grip, connect, disconnect, setGrip } = useSmartCube();
  const support = bluetoothSupport();
  return (
    <div className="smart-panel stack">
      <div className="row wrap">
        <span className={`conn-dot ${status}`} aria-hidden />
        <span>
          {status === 'connected' && <>接続中: {deviceName}{battery !== null && `（電池 ${battery}%）`}</>}
          {status === 'connecting' && '接続しています…'}
          {status === 'disconnected' && '未接続'}
        </span>
        <span className="spacer" />
        {status === 'connected' ? (
          <button className="btn small" onClick={disconnect}>
            切断
          </button>
        ) : (
          <button className="btn small primary" onClick={connect} disabled={status === 'connecting' || !support.ok}>
            スマートキューブに接続
          </button>
        )}
      </div>
      {!support.ok && <p className="warn small">{support.message}</p>}
      {error && <p className="error small">{error}</p>}
      <div className="row wrap">
        <label className="field inline">
          <span className="field-label">上の色</span>
          <select
            value={grip.top}
            onChange={(e) => {
              const top = e.target.value as Face;
              setGrip({ top, front: validFronts(top).includes(grip.front) ? grip.front : validFronts(top)[0] });
            }}
          >
            {FACES.map((f) => (
              <option key={f} value={f}>
                {COLOR_NAMES[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span className="field-label">前の色</span>
          <select value={grip.front} onChange={(e) => setGrip({ ...grip, front: e.target.value as Face })}>
            {validFronts(grip.top).map((f) => (
              <option key={f} value={f}>
                {COLOR_NAMES[f]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small">
        手順を回し始めるときの持ち方に合わせてください。キューブは揃っていなくても大丈夫です（出題してからの変化だけで判定します）。対応機種: GAN356 i Carry / i Carry S / i Carry 2、GAN12 ui、GAN356 i3 などの GAN 製スマートキューブ。
      </p>
    </div>
  );
}

type Phase = 'waiting' | 'solving' | 'failed';

interface Last {
  card: Card;
  ok: boolean;
  recall: number;
  exec?: number;
}

export function SmartSession({
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
  const status = useSmartCube((s) => s.status);
  const subscribe = useSmartCube((s) => s.subscribe);
  const connect = useSmartCube((s) => s.connect);
  const [cards, setCards] = useState(initialCards);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [moves, setMoves] = useState<string[]>([]);
  const [diverged, setDiverged] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [last, setLast] = useState<Last | null>(null);
  const startRef = useRef(performance.now());
  const firstMoveRef = useRef<number | null>(null);
  const done = index >= cards.length;
  const card = cards[index];

  const tracker = useMemo(() => {
    if (card?.special) {
      const sc = card.special;
      return new AttemptTracker((st) => checkSpecialState(sc, st).ok, card.answer[0]);
    }
    if (!card?.target) return null;
    const t = card.target;
    return AttemptTracker.forCase(t.pt, t.buffer, t.a, t.b, card.answer[0]);
    // 同じカードが再出題されたときも新しく作る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, index]);

  // 新しいカード
  useEffect(() => {
    startRef.current = performance.now();
    firstMoveRef.current = null;
    setPhase('waiting');
    setMoves([]);
    setDiverged(null);
    setElapsed(0);
  }, [index]);

  useEffect(() => {
    if (done || phase === 'failed') return;
    const id = setInterval(() => setElapsed(performance.now() - startRef.current), 50);
    return () => clearInterval(id);
  }, [done, phase]);

  const finish = useCallback(
    (ok: boolean, at: number) => {
      if (!card) return;
      const first = firstMoveRef.current;
      const recall = (first ?? at) - startRef.current;
      const exec = ok && first !== null ? at - first : undefined;
      const grade: Grade = !ok ? 0 : recall <= slowMs / 2 ? 3 : recall <= slowMs ? 2 : 1;
      recordReview(card.reviewKey, grade, recall, exec);
      setResults((r) => [...r, { card, time: recall, grade, exec }]);
      setLast({ card, ok, recall, exec });
      if (ok) setIndex((i) => i + 1);
      else {
        setCards((c) => [...c, card]);
        setPhase('failed');
      }
    },
    [card, slowMs, recordReview],
  );

  // キューブの回転を受け取る
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    return subscribe((e) => {
      if (!tracker || phaseRef.current === 'failed') return;
      if (firstMoveRef.current === null) {
        firstMoveRef.current = e.time;
        setPhase('solving');
      }
      const solved = tracker.push(e.turn);
      setMoves(tracker.moves.map(turnToString));
      setDiverged(tracker.divergence());
      if (solved) finish(true, e.time);
    });
  }, [subscribe, tracker, finish]);

  const giveUp = useCallback(() => {
    if (phase !== 'failed') finish(false, performance.now());
  }, [phase, finish]);
  const next = useCallback(() => setIndex((i) => i + 1), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (phase === 'failed') next();
        else giveUp();
      } else if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, next, giveUp, onExit]);

  if (done) return <Summary results={results} slowMs={slowMs} onExit={onExit} onRetry={onRetry} />;

  const recallLive = firstMoveRef.current !== null ? firstMoveRef.current - startRef.current : elapsed;
  const shown = phase === 'failed';
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
      {status !== 'connected' && !smartDebug() && (
        <p className="warn small">
          キューブとの接続が切れました。{' '}
          <button className="link" onClick={connect}>
            再接続
          </button>
        </p>
      )}
      {last && !shown && (
        <p className={last.ok ? 'last-result ok' : 'last-result ng'}>
          {last.ok ? '✓' : '✗'} {last.card.prompt}　想起 {formatSec(last.recall)}s{last.exec !== undefined && `　実行 ${formatSec(last.exec)}s`}
        </p>
      )}
      <div className="flashcard smart" aria-live="polite">
        <span className="prompt">{card.prompt}</span>
        {card.reading && <span className="reading">{card.reading}</span>}
        {card.sub && <span className="muted small">{card.sub}</span>}
        <span className={recallLive > slowMs ? 'timer slow' : 'timer'}>
          {phase === 'waiting' ? formatSec(elapsed) : `${formatSec(recallLive)} + ${formatSec(Math.max(0, elapsed - recallLive))}`}
        </span>
        <span className="hint">
          {phase === 'waiting' && '手順を回してください（正しく回せたら自動で次へ）'}
          {phase === 'solving' && '回しています…'}
          {phase === 'failed' && '答え'}
        </span>
        <span className="moves">
          {moves.map((m, i) => (
            <span key={i} className={diverged !== null && i >= diverged ? 'mv off' : 'mv'}>
              {m}
            </span>
          ))}
        </span>
        {diverged !== null && phase !== 'failed' && <span className="error small">{diverged + 1} 手目から登録した手順とずれています</span>}
        {shown && (
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
      </div>
      {shown ? (
        <button className="btn primary big" onClick={next}>
          次へ（キューブを戻してから）
        </button>
      ) : (
        <div className="row">
          <button
            className="btn big"
            disabled={moves.length === 0}
            onClick={() => {
              tracker?.reset();
              setMoves([]);
              setDiverged(null);
            }}
            title="回した分を手で戻したときなど、ここから数え直します"
          >
            数え直す
          </button>
          <button className="btn big grow" onClick={giveUp}>
            わからない／間違えた
          </button>
        </div>
      )}
      {smartDebug() && <DebugInput />}
      <p className="muted small">評価は自動です: 想起 {formatSec(slowMs / 2)} 秒以内 → {GRADES[3].label}、{formatSec(slowMs)} 秒以内 → {GRADES[2].label}、それより遅い → {GRADES[1].label}、間違い → {GRADES[0].label}</p>
    </div>
  );
}

function DebugInput() {
  const emitRaw = useSmartCube((s) => s.emitRaw);
  const [text, setText] = useState('');
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        emitRaw(text);
        setText('');
      }}
    >
      <input aria-label="仮想キューブ入力" value={text} onChange={(e) => setText(e.target.value)} placeholder="（動作確認用）R U R' …" />
      <button className="btn">送る</button>
    </form>
  );
}
