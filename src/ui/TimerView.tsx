import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stickerName } from '../cube/pieces';
import { bufferOrder } from '../data/buffers';
import { pairText } from '../data/labels';
import { useStore } from '../data/store';
import { useSmartCube } from '../smartcube/connection';
import type { FaceTurn } from '../smartcube/tracker';
import { turnToString } from '../smartcube/tracker';
import { segmentSolve } from '../timer/analysis';
import { applyAlgColors, describeUnsolved, fromGrip, isSolvedColors, sameColors, solvedColors, toGrip, type Colors } from '../timer/cubeColors';
import { randomScramble } from '../timer/scramble';
import { makeScramble, SCRAMBLE_TYPES, type ScrambleType } from '../timer/scrambleGen';
import { judgeSegments, type Verdict } from '../timer/memo';
import { memoSettingsFrom } from '../timer/memoSettings';
import { isDone, parseScramble, startProgress, stepProgress, type ScrambleProgress } from '../timer/scrambleTracker';
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
  const [scrType, setScrTypeState] = usePersisted<ScrambleType>('timer.scrambleType', 'normal');
  const [scramble, setScrambleState] = useState(() => (scrType === 'normal' ? randomScramble() : ''));
  const scrSeq = useRef(0);
  const setScramble = (s: string) => {
    scrSeq.current++;
    setScrambleState(s);
  };
  const newScramble = (type: ScrambleType = scrType) => {
    const id = ++scrSeq.current;
    if (type !== 'normal') setScrambleState('');
    makeScramble(type).then((s) => id === scrSeq.current && setScrambleState(s));
  };
  const setScrType = (t: ScrambleType) => {
    setScrTypeState(t);
    newScramble(t);
  };
  useEffect(() => {
    if (!scramble) newScramble();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
        // アプリが追っている状態とキューブが報告する状態のどちらかで揃っていれば成功（片方のずれで誤って DNF にしない）
        const st = useSmartCube.getState();
        const local = st.colors;
        let ok = !!local && isSolvedColors(local);
        let unsolved = local && !ok ? local : null;
        if (!ok && manual) {
          const reported = await st.requestState();
          if (reported && isSolvedColors(reported)) ok = true;
          else if (reported) unsolved = unsolved ?? reported;
        }
        if (!ok && unsolved) {
          penalty = 'DNF';
          dnfReason = describeUnsolved(toGrip(unsolved, st.grip));
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
        scrambleOk: scrambleOkRef.current,
        scrambleType: scrType !== 'normal' ? scrType : undefined,
        updatedAt: Date.now(),
      };
      addSolve(s);
      setLast(s);
      setNow(total);
      newScramble();
      setPhase('idle');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cubeOn, pieces, session, scramble, addSolve, scrType],
  );

  const scrambleOkRef = useRef<boolean | undefined>(undefined);
  const start = () => {
    // スマートキューブ: スタート時の状態がスクランブルどおりか（分析の前提）
    const st = useSmartCube.getState();
    scrambleOkRef.current = cubeOn && st.colors ? sameColors(toGrip(st.colors, st.grip), applyAlgColors(solvedColors(), scramble)) : undefined;
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
    if (ph !== 'idle' || !scramble) return;
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
          onNew={() => newScramble()}
          onSet={setScramble}
          type={scrType}
          setType={setScrType}
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
  type,
  setType,
}: {
  scramble: string;
  onNew: () => void;
  onSet: (s: string) => void;
  type: ScrambleType;
  setType: (t: ScrambleType) => void;
  cubeOn: boolean;
  showCube: boolean;
  setShowCube: (v: boolean) => void;
}) {
  const tokens = scramble ? scramble.split(' ') : [];
  const prefixes = useMemo(() => {
    const out: Colors[] = [solvedColors()];
    for (const t of tokens) out.push(applyAlgColors(out[out.length - 1], t));
    return out;
  }, [scramble]);
  const cube = useSmartCube();
  const turnsList = useMemo(() => parseScramble(scramble), [scramble]);
  const [prog, setProgState] = useState<ScrambleProgress>(startProgress);
  const progRef = useRef(prog);
  const setProg = (p: ScrambleProgress) => {
    progRef.current = p;
    setProgState(p);
  };

  useEffect(() => setProg(startProgress()), [scramble]);

  // 色の状態がスクランブルの途中と一致すれば、それを正とする（キューブの状態が正しいとき）
  useEffect(() => {
    if (!cubeOn || !cube.colors) return;
    const c = toGrip(cube.colors, cube.grip);
    const i = prefixes.findIndex((p) => sameColors(p, c));
    if (i >= 0 && (i !== progRef.current.pos || progRef.current.off.length || progRef.current.partial)) setProg({ pos: i, partial: 0, off: [] });
  }, [cubeOn, cube.colors, cube.grip, prefixes]);

  // 回した手の順番でも進める（キューブ内部の状態がずれていても反応する）
  useEffect(() => {
    if (!cubeOn) return;
    return cube.subscribe((e) => {
      const next = stepProgress(progRef.current, turnsList, e.turn);
      setProg(next);
      if (isDone(next, turnsList)) {
        // 手の順番では完了したのに状態が一致しないときは、アプリ側の状態をスクランブル後に合わせる
        const st = useSmartCube.getState();
        const target = prefixes[prefixes.length - 1];
        if (!st.colors || !sameColors(toGrip(st.colors, st.grip), target)) useSmartCube.setState({ colors: fromGrip(target, st.grip) });
      }
    });
  }, [cubeOn, cube.subscribe, turnsList, prefixes]);

  const done = isDone(prog, turnsList);
  const off = prog.off;
  return (
    <section className="card stack scramble-card">
      <div className="chips" role="radiogroup" aria-label="スクランブルの種類">
        {SCRAMBLE_TYPES.map((t) => (
          <button key={t.id} role="radio" aria-checked={type === t.id} className={type === t.id ? 'chip small active' : 'chip small'} onClick={() => setType(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="scramble-text" aria-label="スクランブル">
        {!scramble && <span className="muted">作成中…</span>}
        {tokens.map((t, i) => (
          <span key={i} className={cubeOn && i < prog.pos ? 'sc done' : cubeOn && i === prog.pos ? (prog.partial ? 'sc next half' : 'sc next') : 'sc'}>
            {t}
          </span>
        ))}
      </div>
      {cubeOn && scramble && (
        <p className={done ? 'notice small' : off.length ? 'warn small' : 'muted small'}>
          {done && '✓ スクランブル完了。長押しして離すと記憶開始'}
          {!done && off.length > 0 && `ずれています。戻す: ${off.slice().reverse().map(inverseTurn).map(turnToString).join(' ')}`}
          {!done && !off.length && `${prog.pos} / ${tokens.length} 手${prog.partial ? '（2 回転の 1 回目）' : ''}。揃った状態から回してください`}
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

const VERDICT_LABEL: Record<Verdict, string> = { ok: '正解', memo: '記憶ミス', exec: '実行ミス', order: '順番違い', extra: '余計な手順' };
const VERDICT_MARK: Record<Verdict, string> = { ok: '✓', memo: '記憶ミス', exec: '実行ミス', order: '順番', extra: '余計' };

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
  const pieces = useStore((s) => s.pieces);
  const algs = useStore((s) => s.algs);
  // 正解の解き方と、手順ごとの判定（今の設定・登録手順で計算）
  const diag = useMemo(() => {
    if (!segs.length) return null;
    try {
      return judgeSegments(solve.scramble, segs, memoSettingsFrom(pieces, algs));
    } catch {
      return null;
    }
  }, [solve.scramble, segs, pieces, algs]);
  const firstMistake = diag?.judged.findIndex((j) => j.verdict === 'memo' || j.verdict === 'exec' || j.verdict === 'extra') ?? -1;
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
      <p className="scramble-small">
        {solve.scrambleType && <span className="badge">{solve.scrambleType === 'edges' ? 'エッジのみ' : 'コーナーのみ'}</span>} {solve.scramble}
      </p>
      {solve.scrambleOk === false && <p className="warn small">スタート時のキューブがスクランブルと違う状態でした（スクランブルの回し間違いの可能性）。下の分析は正しくないかもしれません。</p>}
      {diag && (
        <div className={firstMistake >= 0 ? 'diag-summary ng' : 'diag-summary ok'}>
          {firstMistake >= 0 ? (
            <>
              <b>
                {firstMistake + 1} 番目の手順で{VERDICT_LABEL[diag.judged[firstMistake].verdict]}
              </b>
              ：{diag.judged[firstMistake].message}
            </>
          ) : (
            <b>手順はすべて正しく選べています{solve.penalty === 'DNF' ? '（DNF の原因は最後のツイストやパリティ、または回し方の可能性）' : ''}</b>
          )}
        </div>
      )}
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
                {diag && <th>判定</th>}
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
                  {diag && (
                    <td className={`verdict v-${diag.judged[i]?.verdict ?? 'ok'}`}>
                      {VERDICT_MARK[diag.judged[i]?.verdict ?? 'ok']}
                      {diag.judged[i]?.message && <div className="verdict-msg">{diag.judged[i].message}</div>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">赤い行は時間がかかった上位 3 つです。「区切れなかった手」は、手順の途中で間違えたか、前後の手順の手がまとまって回された部分です。判定はサイクルブレイクの選び方が違っても、正しければ ✓ にしています。</p>
        </div>
      )}
      {diag && (
        <details>
          <summary className="field-label">正解の解き方（{diag.expected.steps.length} 手順）</summary>
          <ol className="expected-list">
            {diag.expected.steps.map((st, i) => (
              <li key={i}>
                <b>{st.label}</b>
                <span className="mono small">{st.alg ?? (st.kind === 'twist' ? '' : '（手順未登録）')}</span>
              </li>
            ))}
          </ol>
          {diag.expected.paritySwap && <p className="muted small">パリティのため、エッジは {diag.expected.paritySwap.replace(/^エッジ\s*/, '')} が入れ替わった状態になるようにメモしています。</p>}
          {diag.expected.notes.map((n, i) => (
            <p key={i} className="muted small">
              {n}
            </p>
          ))}
          <p className="muted small">解く順番: エッジ → フリップ → コーナー → LTCT／パリティ → ツイスト。サイクルブレイクは番号の若いステッカーを選んでいます。</p>
        </details>
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
