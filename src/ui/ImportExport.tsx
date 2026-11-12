import { useMemo, useState } from 'react';
import { PIECE_LABEL, PIECE_TYPES, stickerName, targetsFor, type PieceType } from '../cube/pieces';
import { labelOf, pairText } from '../data/labels';
import { algKey, defaultData, exportData, isAppData, useStore, type AlgEntry, type PairEntry } from '../data/store';
import { importAlgTable, importPairTable } from '../io/importer';
import { download, parseDelimited, readExcel, toCsv, writeExcel, type Table } from '../io/table';
import { usePersisted, PieceTabs, Section } from './shared';

type Policy = 'overwrite' | 'fill' | 'append';

export function ImportPanel() {
  const [pt, setPt] = usePersisted<PieceType>('import.pt', 'corner');
  const [content, setContent] = useState<'alg' | 'pair'>('alg');
  const [table, setTable] = useState<Table | null>(null);
  const [source, setSource] = useState('');
  const [sheets, setSheets] = useState<{ names: string[]; read: (s: string) => Promise<Table> } | null>(null);
  const [sheet, setSheet] = useState('');
  const [paste, setPaste] = useState('');
  const [policy, setPolicy] = useState<Policy>('fill');
  const [message, setMessage] = useState('');
  const cfg = useStore((s) => s.pieces[pt]);
  const algs = useStore((s) => s.algs);
  const pairs = useStore((s) => s.pairs);
  const setAlgsBulk = useStore((s) => s.setAlgsBulk);
  const setPairsBulk = useStore((s) => s.setPairsBulk);

  const algResult = useMemo(() => (table && content === 'alg' ? importAlgTable(pt, cfg, table) : null), [table, content, pt, cfg]);
  const pairResult = useMemo(
    () => (table && content === 'pair' ? importPairTable(table, Object.values(cfg.labels).filter(Boolean)) : null),
    [table, content, cfg],
  );

  const onFile = async (file: File) => {
    setMessage('');
    setSource(file.name);
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const x = await readExcel(file);
        setSheets({ names: x.sheets, read: x.read });
        setSheet(x.sheets[0]);
        setTable(await x.read(x.sheets[0]));
      } else if (/\.xls$/i.test(file.name)) {
        setMessage('古い .xls 形式は読めません。Excel で .xlsx か CSV として保存し直してください。');
      } else {
        setSheets(null);
        setTable(parseDelimited(await file.text()));
      }
    } catch (e) {
      setMessage(`読み込めませんでした: ${String(e)}`);
    }
  };

  const applyAlgs = () => {
    if (!algResult) return;
    const patch: Record<string, Partial<AlgEntry>> = {};
    let n = 0;
    for (const e of algResult.entries) {
      const key = algKey(pt, cfg.buffer, e.a, e.b);
      const cur = algs[key];
      if (cur?.algs.length && policy === 'fill') continue;
      if (cur?.algs.length && policy === 'append') {
        const merged = [...cur.algs, ...e.algs.filter((x) => !cur.algs.includes(x))];
        patch[key] = { algs: merged };
      } else {
        patch[key] = { algs: e.algs, main: 0, ...(e.memo ? { memo: e.memo } : {}), status: cur?.status && cur.status !== 'none' ? cur.status : 'learning' };
      }
      n++;
    }
    setAlgsBulk(patch);
    setMessage(`${n} ケースを取り込みました。`);
    setTable(null);
  };

  const applyPairs = () => {
    if (!pairResult) return;
    const patch: Record<string, Partial<PairEntry>> = {};
    let n = 0;
    for (const e of pairResult.entries) {
      const cur = pairs[e.pair];
      if (cur?.word && policy !== 'overwrite') continue;
      patch[e.pair] = { word: e.word, ...(e.memo ? { memo: e.memo } : {}), status: cur?.status && cur.status !== 'none' ? cur.status : 'learning' };
      n++;
    }
    setPairsBulk(patch);
    setMessage(`${n} ペアを取り込みました。`);
    setTable(null);
  };

  return (
    <Section title="スプレッドシートから取り込む">
      <p className="muted small">
        Excel（.xlsx）・CSV のファイル、またはスプレッドシートからコピーした範囲を貼り付けて取り込めます。
        <br />
        形式は自動で判別します。<b>表形式</b>（1 行目に 2 文字目、1 列目に 1 文字目、セルに手順）と<b>リスト形式</b>（「ペア ｜ 手順 ｜ メモ」または「1 文字目 ｜ 2 文字目 ｜ 手順」）に対応。文字は下の「文字の割り振り」で設定したもの、または UFR のような位置名で照合します。セル内の改行で区切った手順は候補として取り込みます。
      </p>
      <div className="segmented">
        <button className={content === 'alg' ? 'active' : ''} onClick={() => setContent('alg')}>
          手順
        </button>
        <button className={content === 'pair' ? 'active' : ''} onClick={() => setContent('pair')}>
          レターペア
        </button>
      </div>
      <PieceTabs value={pt} onChange={setPt} />
      <p className="muted small">
        取り込み先: {PIECE_LABEL[pt]}
        {content === 'alg' && `（バッファ ${stickerName(pt, cfg.buffer)}・${labelOf(pt, cfg, cfg.buffer)}）`}
      </p>
      <div className="row wrap">
        <label className="btn">
          ファイルを選ぶ
          <input type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {sheets && sheets.names.length > 1 && (
          <select
            value={sheet}
            onChange={async (e) => {
              setSheet(e.target.value);
              setTable(await sheets.read(e.target.value));
            }}
            aria-label="シート"
          >
            {sheets.names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        )}
        {source && <span className="muted small">{source}</span>}
      </div>
      <textarea
        rows={3}
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        placeholder="またはスプレッドシートのセル範囲をコピーしてここに貼り付け"
      />
      <button
        className="btn"
        disabled={!paste.trim()}
        onClick={() => {
          setSource('貼り付け');
          setSheets(null);
          setTable(parseDelimited(paste));
        }}
      >
        貼り付けた内容を読む
      </button>

      {algResult && (
        <div className="preview stack">
          <p>
            <b>{algResult.mode === 'matrix' ? '表形式' : 'リスト形式'}</b>として {algResult.entries.length} ケースを読み取りました。
            {algResult.transposed && '（手順を検証した結果、上の行を 1 文字目・左の列を 2 文字目として読みました）'}
          </p>
          {algResult.unmatched.length > 0 && (
            <p className="warn small">文字の割り振りと一致しなかった見出し: {algResult.unmatched.slice(0, 30).join('、')}{algResult.unmatched.length > 30 ? ' …' : ''}</p>
          )}
          {algResult.skippedInvalid.length > 0 && (
            <p className="muted small">バッファと同じパーツ・同じパーツ同士のため飛ばしたもの: {algResult.skippedInvalid.length} 件</p>
          )}
          <ul className="preview-list">
            {algResult.entries.slice(0, 8).map((e, i) => (
              <li key={i}>
                <b>{pairText(pt, cfg, e.a, e.b)}</b> {e.algs.join(' ／ ')}
              </li>
            ))}
          </ul>
          <PolicyPicker policy={policy} setPolicy={setPolicy} allowAppend />
          <button className="btn primary" disabled={!algResult.entries.length} onClick={applyAlgs}>
            取り込む
          </button>
        </div>
      )}
      {pairResult && (
        <div className="preview stack">
          <p>
            <b>{pairResult.mode === 'matrix' ? '表形式' : 'リスト形式'}</b>として {pairResult.entries.length} ペアを読み取りました。
          </p>
          <ul className="preview-list">
            {pairResult.entries.slice(0, 8).map((e, i) => (
              <li key={i}>
                <b>{e.pair}</b> {e.word}
              </li>
            ))}
          </ul>
          <PolicyPicker policy={policy} setPolicy={setPolicy} />
          <button className="btn primary" disabled={!pairResult.entries.length} onClick={applyPairs}>
            取り込む
          </button>
        </div>
      )}
      {message && <p className="notice">{message}</p>}
    </Section>
  );
}

function PolicyPicker({ policy, setPolicy, allowAppend }: { policy: Policy; setPolicy: (p: Policy) => void; allowAppend?: boolean }) {
  return (
    <div>
      <div className="field-label">すでに登録があるとき</div>
      <div className="segmented">
        <button className={policy === 'fill' ? 'active' : ''} onClick={() => setPolicy('fill')}>
          そのまま残す
        </button>
        <button className={policy === 'overwrite' ? 'active' : ''} onClick={() => setPolicy('overwrite')}>
          上書き
        </button>
        {allowAppend && (
          <button className={policy === 'append' ? 'active' : ''} onClick={() => setPolicy('append')}>
            候補に追加
          </button>
        )}
      </div>
    </div>
  );
}

function algMatrix(pt: PieceType): Table {
  const s = useStore.getState();
  const cfg = s.pieces[pt];
  const targets = targetsFor(pt, cfg.buffer);
  const header = ['', ...targets.map((t) => labelOf(pt, cfg, t))];
  const rows = targets.map((a) => [
    labelOf(pt, cfg, a),
    ...targets.map((b) => {
      const e = s.algs[algKey(pt, cfg.buffer, a, b)];
      if (!e?.algs.length) return '';
      return [e.algs[e.main], ...e.algs.filter((_, i) => i !== e.main)].join('\n');
    }),
  ]);
  return [header, ...rows];
}

function pairListTable(): Table {
  const s = useStore.getState();
  return [['ペア', 'イメージ', 'メモ'], ...Object.entries(s.pairs).filter(([, e]) => e.word || e.memo).sort(([a], [b]) => a.localeCompare(b, 'ja')).map(([p, e]) => [p, e.word, e.memo])];
}

export function ExportPanel() {
  const [pt, setPt] = usePersisted<PieceType>('export.pt', 'corner');
  const replaceAll = useStore((s) => s.replaceAll);
  const [message, setMessage] = useState('');
  const date = new Date().toISOString().slice(0, 10);

  return (
    <Section title="書き出し・バックアップ">
      <p className="muted small">
        データはこの端末のブラウザ内に保存されています。スマホとパソコンの間で移すときや、念のための保存には「バックアップ」を使ってください。
      </p>
      <div className="row wrap">
        <button
          className="btn primary"
          onClick={() => download(`bld-backup-${date}.json`, JSON.stringify(exportData()), 'application/json')}
        >
          バックアップを保存（.json）
        </button>
        <label className="btn">
          バックアップから復元
          <input
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const data = JSON.parse(await f.text());
                if (!isAppData(data)) throw new Error('形式が違います');
                if (confirm('今のデータをバックアップの内容で置き換えます。よろしいですか？')) {
                  replaceAll(data);
                  setMessage('復元しました。');
                }
              } catch (err) {
                setMessage(`復元できませんでした: ${String(err)}`);
              }
              e.target.value = '';
            }}
          />
        </label>
      </div>
      <div className="row wrap">
        <button
          className="btn"
          onClick={() =>
            writeExcel(`bld-${date}.xlsx`, [
              ...PIECE_TYPES.map((p) => ({ name: PIECE_LABEL[p], rows: algMatrix(p) })),
              { name: 'レターペア', rows: pairListTable() },
            ])
          }
        >
          Excel に書き出す（全パーツ＋レターペア）
        </button>
      </div>
      <div className="row wrap">
        <PieceTabs value={pt} onChange={setPt} />
        <button className="btn small" onClick={() => download(`bld-${pt}-${date}.csv`, '﻿' + toCsv(algMatrix(pt)), 'text/csv')}>
          {PIECE_LABEL[pt]}の手順表を CSV で
        </button>
        <button className="btn small" onClick={() => download(`bld-pairs-${date}.csv`, '﻿' + toCsv(pairListTable()), 'text/csv')}>
          レターペアを CSV で
        </button>
      </div>
      <details>
        <summary className="muted small">データを初期化する</summary>
        <button
          className="btn danger small"
          onClick={() => {
            if (confirm('すべての手順・レターペア・練習記録・設定を消します。元に戻せません。よろしいですか？')) {
              replaceAll(defaultData());
              setMessage('初期化しました。');
            }
          }}
        >
          すべて消去
        </button>
      </details>
      {message && <p className="notice">{message}</p>}
    </Section>
  );
}
