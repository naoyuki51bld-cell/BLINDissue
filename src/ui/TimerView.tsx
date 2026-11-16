import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stickerName } from '../cube/pieces';
import { bufferOrder } from '../data/buffers';
import { pairText } from '../data/labels';
import { useStore } from '../data/store';
import { useSmartCube } from '../smartcube/connection';
import type { FaceTurn } from '../smartcube/tracker';
import { turnToString } from '../smartcube/tracker';
import { segmentSolve } from '../timer/analysis';
import { applyAlgColors, describeUnsolved, isSolvedColors, sameColors, solvedColors, toGrip, type Colors } from '../timer/cubeColors';
import { randomScramble } from '../timer/scramble';
import { averageOf, bestOf, bestSingle, current, formatTime, meanOf, successRate, value } from '../timer/stats';
import type { Penalty, Solve } from '../timer/types';
import { CubeNet } from './CubeNet';
import { Modal, usePersisted } from './shared';
import { SmartCubePanel } from './SmartPractice';
import { useImmersive } from './uiState';

type Phase = 'idle' | 'arming' | 'ready' | 'memo' | 'exec' | 'checking';
const HOLD_MS = 300;

/** 文字を入力中か（そのときはタイマーを操作しない） */
function isTyping(t: EventTarget | null): boolean {
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (t instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'range'].includes(t.type);
  return false;
}

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function Immersive() {
  useImmersive();
  return null;
}

export function TimerView() {
  const [session, setSession] = usePersisted<string>('timer.session', '3BLD');
  const [splitMemo, setSplitMemo] = usePersisted<boolean>('timer.splitMemo', true);
  const [autoStop, setAutoStop] = usePersisted<boolean>('timer.autoStop', true);
  const [useCube, setUseCube] = usePersisted<boolean>('timer.useCube', true);
  const [scramble, setScramble] = useState(() => randomScramble());
  const [phase, setPhase] = useState<Phase>('idle');
  const [now, setNow] = useState(0);
  const [last, setLast] = useState<Solve | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [showCube, setShowCube] = useState(false);

  const solvesMap = useStore((s) => s.solves);
  const addSolve = useStore((s) => s.addSolve);
  const pieces = useStore((s) => s.pieces);
  const cube = useSmartCube();
  const cubeOn = useCube && (cube.status === 'connected' || /[?&]debug\b/.test(window.location.search));

  const startRef = useRef(0);
  const memoEndRef = useRef<number | null>(null);
  const turnsRef = useRef<FaceTurn[]>([]);
  const timesRef = useRef<number[]>([]);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const solves = useMemo(
    () =>
      Object.values(solvesMap)
        .filter((s) => !s.deleted && s.session === session)
        .sort((a, b) => b.date - a.date),
    [solvesMap, session],
  );
  const sessions = useMemo(() => {
    const set = new Set<string>([session, '3BLD']);
    Object.values(solvesMap).forEach((s) => !s.deleted && set.add(s.session));
    return [...set];
  }, [solvesMap, session]);

  // 計測中の表示
  useEffect(() => {
    if (phase !== 'memo' && phase !== 'exec') return;
    let raf = 0;
    const tick = () => {
      setNow(performance.now() - startRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const finish = useCallback(
    async (manual: boolean) => {
      const end = performance.now();
      const total = end - startRef.current;
      setPhase('checking');
      let penalty: Penalty = 'OK';
      let dnfReason: string | undefined;
      let segments: Solve['segments'];
      if (cubeOn) {
        // 止めたときはキューブに状態を問い合わせて確かめる（手の取りこぼし対策）
        const core = manual ? await useSmartCube.getState().requestState() : useSmartCube.getState().colors;
        if (core) {
          const c = toGrip(core, useSmartCube.getState().grip);
          if (!isSolvedColors(c)) {
            penalty = 'DNF';
            dnfReason = describeUnsolved(c);
          }
        }
        const memoEnd = memoEndRef.current ?? total;
        if (turnsRef.current.length)
          segments = segmentSolve(turnsRef.current, timesRef.current, memoEnd, {
            cornerBuffers: bufferOrder(pieces.corner),
            edgeBuffers: bufferOrder(pieces.edge),
            label: (pt, buf, a, b) => {
              const cfg = pieces[pt];
              const main = bufferOrder(cfg)[0];
              return `${pairText(pt, cfg, a, b)}${buf !== main ? `（${stickerName(pt, buf)}）` : ''}`;
            },
          });
      }
      const s: Solve = {
        id: newId(),
        session,
        date: Date.now(),
        scramble,
        memo: memoEndRef.current ?? undefined,
        total,
        penalty,
        dnfReason,
        moves: turnsRef.current.length ? turnsRef.current.map(turnToString).join(' ') : undefined,
        times: timesRef.current.length ? timesRef.current.map((t) => Math.round(t)) : undefined,
        segments,
        updatedAt: Date.now(),
      };
      addSolve(s);
      setLast(s);
      setNow(total);
      setScramble(randomScramble());
      setPhase('idle');
    },
    [cubeOn, pieces, session, scramble, addSolve],
  );

  const start = () => {
    startRef.current = performance.now();
    memoEndRef.current = null;
    turnsRef.current = [];
    timesRef.current = [];
    setLast(null);
    setNow(0);
    setPhase('memo');
  };

  /** 計測中のタップ / キー */
  const tapWhileRunning = () => {
    const ph = phaseRef.current;
    if (ph === 'memo' && !cubeOn && splitMemo) {
      memoEndRef.current = performance.now() - startRef.current;
      setPhase('exec');
      return;
    }
    if (ph === 'memo' || ph === 'exec') finish(true);
  };

  // スマートキューブの回転
  useEffect(() => {
    if (!cubeOn) return;
    return cube.subscribe((e) => {
      const ph = phaseRef.current;
      if (ph !== 'memo' && ph !== 'exec') return;
      const t = performance.now() - startRef.current;
      if (ph === 'memo') {
        memoEndRef.current = t;
        setPhase('exec');
      }
      turnsRef.current.push(e.turn);
      timesRef.current.push(t);
      if (autoStop) {
        // 色の状態は回転を受け取った直後に更新されている
        setTimeout(() => {
          const core = useSmartCube.getState().colors;
          if (core && isSolvedColors(core) && (phaseRef.current === 'exec' || phaseRef.current === 'memo')) finish(false);
        }, 0);
      }
    });
  }, [cubeOn, cube.subscribe, autoStop, finish]);

  // csTimer と同じ操作: 長押しで緑 → 離してスタート、計測中は押すと止まる
  const press = () => {
    const ph = phaseRef.current;
    if (ph === 'memo' || ph === 'exec') {
      tapWhileRunning();
      return;
    }
    if (ph !== 'idle') return;
    setPhase('arming');
    armTimer.current = setTimeout(() => phaseRef.current === 'arming' && setPhase('ready'), HOLD_MS);
  };
  const release = () => {
    if (armTimer.current) clearTimeout(armTimer.current);
    const ph = phaseRef.current;
    if (ph === 'ready') start();
    else if (ph === 'arming') setPhase('idle');
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (detail) return;
      // チェックボックスなどにフォーカスがあってもスペースでタイマーを操作する
      if (e.key === ' ' && e.target instanceof HTMLElement && e.target !== document.body) e.target.blur();
      const running = phaseRef.current === 'memo' || phaseRef.current === 'exec';
      if (e.key === ' ' || running) {
        e.preventDefault();
        if (!e.repeat) press();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === ' ') {
        e.preventDefault();
        release();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  const running = phase === 'memo' || phase === 'exec' || phase === 'arming' || phase === 'ready' || phase === 'checking';
  const display = phase === 'memo' || phase === 'exec' ? now : last ? value(last) : 0;

  return (
    <div className={running ? 'page timer-page running' : 'page timer-page'}>
      {running && <Immersive />}
      {!running && (
        <ScramblePanel
          scramble={scramble}
          onNew={() => setScramble(randomScramble())}
          onSet={setScramble}
          cubeOn={cubeOn}
          showCube={showCube}
          setShowCube={setShowCube}
        />
      )}
      <div
        className={`timer-area phase-${phase}`}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.preventDefault();
          press();
        }}
        onPointerUp={() => release()}
        onPointerCancel={() => release()}
        role="button"
        aria-label="タイマー（長押しして離すとスタート、計測中はタップで止める）"
      >
        <div className="timer-big">{phase === 'checking' ? '…' : last && !running && last.penalty === 'DNF' ? `DNF(${formatTime(last.total)})` : formatTime(display)}</div>
        {(phase === 'exec' || (!running && last?.memo !== undefined)) && (
          <div className="timer-split">
            記憶 {formatTime(phase === 'exec' ? memoEndRef.current : last?.memo)}
            {!running && last?.memo !== undefined && `　実行 ${formatTime(last.total - last.memo)}`}
          </div>
        )}
        <div className="timer-hint">
          {phase === 'idle' && (cubeOn ? '長押し → 離して記憶開始。最初の 1 手で記憶時間を区切り、揃うと止まります（タップでも止められます）' : `長押し → 離してスタート。${splitMemo ? '1 回目のタップで記憶終了、2 回目で止める' : 'タップで止める'}`)}
          {phase === 'arming' && '…'}
          {phase === 'ready' && '離すとスタート'}
          {phase === 'memo' && (cubeOn ? '記憶中（回し始めると実行へ）・タップで止める' : splitMemo ? '記憶中・タップで記憶終了' : 'タップで止める')}
          {phase === 'exec' && 'タップで止める'}
          {phase === 'checking' && 'キューブの状態を確認しています…'}
        </div>
        {!running && last?.dnfReason && <div className="timer-dnf">DNF: {last.dnfReason}</div>}
        {!running && last?.segments && last.segments.length > 0 && (
          <button className="link" onClick={() => setDetail(last.id)}>
            手順ごとの分析を見る（{last.segments.length} 手順）
          </button>
        )}
      </div>

      {!running && (
        <>
          <Stats solves={solves} />
          <section className="card stack">
            <div className="card-head">
              <h2>記録</h2>
              <div className="row wrap">
                <select value={session} onChange={(e) => setSession(e.target.value)} aria-label="セッション">
                  {sessions.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <button
                  className="btn small"
                  onClick={() => {
                    const name = prompt('新しいセッションの名前（例: 3BLD 大会前、エッジのみ）');
                    if (name?.trim()) setSession(name.trim());
                  }}
                >
                  ＋ セッション
                </button>
              </div>
            </div>
            <TimeList solves={solves} onOpen={setDetail} />
          </section>
          <details className="card">
            <summary>タイマーの設定・スマートキューブ</summary>
            <div className="stack" style={{ marginTop: 10 }}>
              <label className="check">
                <input type="checkbox" checked={useCube} onChange={(e) => setUseCube(e.target.checked)} />
                スマートキューブを使う（最初の 1 手で記憶時間を区切り、手順ごとに分析）
              </label>
              <label className="check">
                <input type="checkbox" checked={autoStop} onChange={(e) => setAutoStop(e.target.checked)} />
                キューブが揃ったら自動で止める
              </label>
              <label className="check">
                <input type="checkbox" checked={splitMemo} onChange={(e) => setSplitMemo(e.target.checked)} />
                スマートキューブなしのとき、1 回目のタップで記憶時間を区切る
              </label>
              {useCube && <SmartCubePanel />}
              {useCube && cube.status === 'connected' && (
                <div className="row wrap">
                  <button className="btn small" onClick={() => cube.requestState()}>
                    キューブの状態を読み直す
                  </button>
                  <button className="btn small ghost" onClick={() => cube.assumeSolved()}>
                    今の状態を「揃っている」にする
                  </button>
                </div>
              )}
            </div>
          </details>
        </>
      )}
      {detail && solvesMap[detail] && <SolveDetail solve={solvesMap[detail]} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ---- スクランブル（スマートキューブなら進み具合も表示） ----

const inverseTurn = (t: FaceTurn): FaceTurn => ({ face: t.face, amount: -t.amount });

function ScramblePanel({
  scramble,
  onNew,
  onSet,
  cubeOn,
  showCube,
  setShowCube,
}: {
  scramble: string;
  onNew: () => void;
  onSet: (s: string) => void;
  cubeOn: boolean;
  showCube: boolean;
  setShowCube: (v: boolean) => void;
}) {
  const tokens = scramble.split(' ');
  const prefixes = useMemo(() => {
    const out: Colors[] = [solvedColors()];
    for (const t of tokens) out.push(applyAlgColors(out[out.length - 1], t));
    return out;
  }, [scramble]);
  const cube = useSmartCube();
  const [off, setOff] = useState<FaceTurn[]>([]);
  const [progress, setProgress] = useState<number | null>(null);

  // 回すたびに、スクランブルのどこまで進んだか・ずれた手を調べる
  useEffect(() => {
    setOff([]);
    setProgress(null);
  }, [scramble]);
  useEffect(() => {
    if (!cubeOn || !cube.colors) {
      setProgress(null);
      return;
    }
    const c = toGrip(cube.colors, cube.grip);
    const i = prefixes.findIndex((p) => sameColors(p, c));
    if (i >= 0) {
      setProgress(i);
      setOff([]);
    }
  }, [cubeOn, cube.colors, cube.grip, prefixes]);
  useEffect(() => {
    if (!cubeOn) return;
    return cube.subscribe((e) => {
      const core = useSmartCube.getState().colors;
      if (!core) return;
      const c = toGrip(core, useSmartCube.getState().grip);
      if (prefixes.some((p) => sameColors(p, c))) return;
      setOff((o) => {
        const lastT = o[o.length - 1];
        if (lastT && lastT.face === e.turn.face) {
          const a = (((lastT.amount + e.turn.amount) % 4) + 4) % 4;
          const rest = o.slice(0, -1);
          return a === 0 ? rest : [...rest, { face: lastT.face, amount: a === 3 ? -1 : a }];
        }
        return [...o, e.turn];
      });
    });
  }, [cubeOn, cube.subscribe, prefixes]);

  const done = progress === tokens.length;
  return (
    <section className="card stack scramble-card">
      <div className="scramble-text" aria-label="スクランブル">
        {tokens.map((t, i) => (
          <span key={i} className={progress !== null && i < progress ? 'sc done' : progress === i ? 'sc next' : 'sc'}>
            {t}
          </span>
        ))}
      </div>
      {cubeOn && (
        <p className={done ? 'notice small' : off.length ? 'warn small' : 'muted small'}>
          {!cube.colors && 'キューブの状態が分かりません。揃えてから下の設定の「今の状態を『揃っている』にする」を押してください。'}
          {cube.colors && done && '✓ スクランブル完了。長押しして離すと記憶開始'}
          {cube.colors && !done && off.length > 0 && `ずれています。戻す: ${off.slice().reverse().map(inverseTurn).map(turnToString).join(' ')}`}
          {cube.colors && !done && !off.length && progress === null && 'キューブが揃っていないか、スクランブルと違う状態です（揃えてから回してください）'}
          {cube.colors && !done && !off.length && progress !== null && `${progress} / ${tokens.length} 手`}
        </p>
      )}
      <div className="row wrap">
        <button className="btn small" onClick={onNew}>
          次のスクランブル
        </button>
        <button
          className="btn small ghost"
          onClick={() => {
            const s = prompt('スクランブルを入力（大会のスクランブルなど）', scramble);
            if (s?.trim()) onSet(s.trim().replace(/\s+/g, ' '));
          }}
        >
          入力
        </button>
        <button className="btn small ghost" onClick={() => setShowCube(!showCube)}>
          {showCube ? '展開図を隠す' : '展開図'}
        </button>
      </div>
      {showCube && <CubeNet n={3} colorOf={prefixes[prefixes.length - 1]} maxWidth={260} />}
    </section>
  );
}

// ---- 統計 ----

function Stats({ solves }: { solves: Solve[] }) {
  const rows: [string, number | null, number | null][] = [
    ['単発', solves[0] ? value(solves[0]) : null, bestSingle(solves)],
    ['mo3', current(solves, 3, meanOf), bestOf(solves, 3, meanOf)],
    ['ao5', current(solves, 5, averageOf), bestOf(solves, 5, averageOf)],
    ['ao12', current(solves, 12, averageOf), bestOf(solves, 12, averageOf)],
  ];
  const rate = successRate(solves);
  const ok = solves.filter((s) => s.penalty !== 'DNF');
  const memoAvg = ok.filter((s) => s.memo !== undefined);
  return (
    <section className="card">
      <table className="stats-table">
        <thead>
          <tr>
            <th />
            <th>現在</th>
            <th>ベスト</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, cur, best]) => (
            <tr key={name}>
              <th>{name}</th>
              <td>{formatTime(cur)}</td>
              <td>{formatTime(best)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        成功 {ok.length} / {solves.length}（{rate === null ? '-' : `${Math.round(rate * 100)}%`}）
        {memoAvg.length > 0 &&
          `・成功時の平均 記憶 ${formatTime(memoAvg.reduce((a, s) => a + (s.memo ?? 0), 0) / memoAvg.length)} / 実行 ${formatTime(
            memoAvg.reduce((a, s) => a + (s.total - (s.memo ?? 0)), 0) / memoAvg.length,
          )}`}
      </p>
    </section>
  );
}

function TimeList({ solves, onOpen }: { solves: Solve[]; onOpen: (id: string) => void }) {
  if (!solves.length) return <p className="muted small">まだ記録がありません。</p>;
  return (
    <ol className="time-list" reversed>
      {solves.map((s, i) => (
        <li key={s.id}>
          <button className="time-row" onClick={() => onOpen(s.id)}>
            <span className="muted small">{solves.length - i}</span>
            <span className={s.penalty === 'DNF' ? 'time-main dnf' : 'time-main'}>
              {s.penalty === 'DNF' ? `DNF(${formatTime(s.total)})` : formatTime(value(s))}
              {s.penalty === '+2' && '+'}
            </span>
            <span className="muted small">{s.memo !== undefined ? `記憶 ${formatTime(s.memo)} / 実行 ${formatTime(s.total - s.memo)}` : ''}</span>
            {s.segments && <span className="muted small">📊</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}

// ---- 1 回分の詳細（手順ごとの分析） ----

function SolveDetail({ solve, onClose }: { solve: Solve; onClose: () => void }) {
  const updateSolve = useStore((s) => s.updateSolve);
  const deleteSolve = useStore((s) => s.deleteSolve);
  const segs = solve.segments ?? [];
  const slowest = new Set(
    segs
      .map((s, i) => ({ i, t: s.pause + s.exec }))
      .sort((a, b) => b.t - a.t)
      .slice(0, segs.length > 3 ? 3 : 0)
      .map((x) => x.i),
  );
  const moveCount = solve.moves ? solve.moves.split(' ').length : 0;
  const exec = solve.memo !== undefined ? solve.total - solve.memo : null;
  return (
    <Modal wide title={<>{solve.penalty === 'DNF' ? `DNF(${formatTime(solve.total)})` : formatTime(value(solve))}</>} onClose={onClose}>
      <p className="muted small">
        {new Date(solve.date).toLocaleString()}・セッション {solve.session}
      </p>
      <div className="stats">
        <div>
          <strong>{formatTime(solve.memo)}</strong>
          <span>記憶</span>
        </div>
        <div>
          <strong>{formatTime(exec)}</strong>
          <span>実行</span>
        </div>
        {moveCount > 0 && exec && (
          <div>
            <strong>{(moveCount / (exec / 1000)).toFixed(2)}</strong>
            <span>TPS（{moveCount} 手）</span>
          </div>
        )}
      </div>
      <div className="segmented">
        {(['OK', '+2', 'DNF'] as Penalty[]).map((p) => (
          <button key={p} className={solve.penalty === p ? 'active' : ''} onClick={() => updateSolve(solve.id, { penalty: p })}>
            {p}
          </button>
        ))}
      </div>
      {solve.dnfReason && <p className="warn small">止めたときの状態: {solve.dnfReason}</p>}
      <p className="scramble-small">{solve.scramble}</p>
      {segs.length > 0 && (
        <div className="stack">
          <div className="field-label">手順ごとの分析（止まり = 前の手順を回し終えてから回し始めるまで）</div>
          <table className="seg-table">
            <thead>
              <tr>
                <th>#</th>
                <th>手順</th>
                <th>止まり</th>
                <th>実行</th>
              </tr>
            </thead>
            <tbody>
              {segs.map((s, i) => (
                <tr key={i} className={slowest.has(i) ? 'slow' : s.kind === 'unknown' ? 'unknown' : undefined}>
                  <td>{i + 1}</td>
                  <td>
                    <b>{s.label}</b>
                    <div className="seg-moves">{s.moves}</div>
                  </td>
                  <td>{formatTime(s.pause)}</td>
                  <td>{formatTime(s.exec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">赤い行は時間がかかった上位 3 つです。「区切れなかった手」は、手順の途中で間違えたか、前後の手順の手がまとまって回された部分です。</p>
        </div>
      )}
      <div className="row end">
        <button
          className="btn danger small"
          onClick={() => {
            if (confirm('この記録を削除しますか？')) {
              deleteSolve(solve.id);
              onClose();
            }
          }}
        >
          削除
        </button>
        <button className="btn primary" onClick={onClose}>
          閉じる
        </button>
      </div>
    </Modal>
  );
}
