import { useMemo } from 'react';
import { casesFor, PIECE_EVENTS, PIECE_LABEL, PIECE_TYPES } from '../cube/pieces';
import { pairText } from '../data/labels';
import { algKey, algReviewKey, pairReviewKey, STATUSES, useStore } from '../data/store';
import { avgTime, formatSec, isDue, isNew } from '../data/srs';
import { ProgressBar } from './AlgsView';
import { earlierBuffers } from '../data/buffers';

export type Tab = 'home' | 'algs' | 'pairs' | 'practice' | 'settings';

export function HomeView({ go }: { go: (t: Tab) => void }) {
  const pieces = useStore((s) => s.pieces);
  const algs = useStore((s) => s.algs);
  const pairs = useStore((s) => s.pairs);
  const reviews = useStore((s) => s.reviews);

  const rows = useMemo(() => {
    const now = Date.now();
    return PIECE_TYPES.map((pt) => {
      const cfg = pieces[pt];
      const cases = casesFor(pt, cfg.buffer, earlierBuffers(pt, cfg, cfg.buffer));
      let registered = 0;
      let due = 0;
      let times: number[] = [];
      const counts = STATUSES.map(() => 0);
      const pairSet = new Set<string>();
      let pairsDone = 0;
      for (const [a, b] of cases) {
        const key = algKey(pt, cfg.buffer, a, b);
        const e = algs[key];
        counts[STATUSES.indexOf(e?.status ?? 'none')]++;
        if (e?.algs.length) {
          registered++;
          const r = reviews[algReviewKey(key)];
          if (isNew(r) || isDue(r, now)) due++;
          const t = avgTime(r);
          if (t !== null) times.push(t);
        }
        const p = pairText(pt, cfg, a, b);
        if (!pairSet.has(p)) {
          pairSet.add(p);
          if (pairs[p]?.word) pairsDone++;
        }
      }
      const avg = times.length ? times.reduce((x, y) => x + y, 0) / times.length : null;
      return { pt, total: cases.length, registered, due, counts, avg, pairsTotal: pairSet.size, pairsDone };
    });
  }, [pieces, algs, pairs, reviews]);

  const pairDue = useMemo(() => {
    const now = Date.now();
    return Object.entries(pairs).filter(([p, e]) => e.word && (isNew(reviews[pairReviewKey(p)]) || isDue(reviews[pairReviewKey(p)], now))).length;
  }, [pairs, reviews]);

  const empty = rows.every((r) => r.registered === 0) && Object.keys(pairs).length === 0;

  return (
    <div className="page">
      {empty && (
        <section className="card stack">
          <h2>はじめに</h2>
          <ol className="steps">
            <li>
              <b>設定</b>で、コーナー・エッジなどの文字の割り振りとバッファを自分のものに合わせます（エッジの「奇数＝子音／偶数＝母音」もまとめて入力できます）。
            </li>
            <li>
              <b>設定 → スプレッドシートから取り込む</b>で、今使っている Excel やスプレッドシートの手順表を読み込みます。手順は 3-cycle になっているか自動でチェックされます。
            </li>
            <li>
              <b>練習</b>で、ペアを見て手順やイメージを思い出す練習をします。想起時間を記録し、苦手なものほど頻繁に出題します。
            </li>
          </ol>
          <div className="row wrap">
            <button className="btn primary" onClick={() => go('settings')}>
              設定を開く
            </button>
          </div>
        </section>
      )}

      <section className="card stack">
        <div className="card-head">
          <h2>今日の復習</h2>
          <button className="btn primary" onClick={() => go('practice')}>
            練習する
          </button>
        </div>
        <div className="stats">
          <div>
            <strong>{rows.reduce((a, r) => a + r.due, 0)}</strong>
            <span>手順</span>
          </div>
          <div>
            <strong>{pairDue}</strong>
            <span>レターペア</span>
          </div>
        </div>
      </section>

      <div className="home-grid">
        {rows.map((r) => (
          <section key={r.pt} className="card stack">
            <div className="card-head">
              <h2>{PIECE_LABEL[r.pt]}</h2>
              <span className="muted small">{PIECE_EVENTS[r.pt]}</span>
            </div>
            <div className="stats compact">
              <div>
                <strong>
                  {r.registered}
                  <small>/{r.total}</small>
                </strong>
                <span>手順登録</span>
              </div>
              <div>
                <strong>{r.due}</strong>
                <span>復習</span>
              </div>
              <div>
                <strong>{formatSec(r.avg)}</strong>
                <span>平均想起</span>
              </div>
              <div>
                <strong>
                  {r.pairsDone}
                  <small>/{r.pairsTotal}</small>
                </strong>
                <span>ペア</span>
              </div>
            </div>
            <ProgressBar counts={r.counts} />
          </section>
        ))}
      </div>
      <p className="muted small legend">
        <span className="dot seg-none" /> 未着手 <span className="dot seg-learning" /> 練習中 <span className="dot seg-learned" /> 覚えた <span className="dot seg-auto" /> 自動化
      </p>
    </div>
  );
}
