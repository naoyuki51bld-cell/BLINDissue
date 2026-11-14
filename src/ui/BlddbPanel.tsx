import { useEffect, useState } from 'react';
import type { BlddbCategory } from '../data/blddb';
import { cachedInfo, clearBlddb, loadBlddb } from '../data/blddbLoader';
import { Section } from './shared';

const CATS: [BlddbCategory, string][] = [
  ['corner', 'コーナー'],
  ['edge', 'エッジ'],
  ['parity', 'パリティ'],
  ['flip', 'フリップ'],
  ['ltct', 'LTCT'],
  ['wing', 'ウイング'],
  ['xcenter', 'Xセンター'],
  ['tcenter', '+センター'],
  ['midge', 'ミッジ（5BLD のエッジ）'],
];

type Info = Awaited<ReturnType<typeof cachedInfo>>;

export function BlddbPanel() {
  const [infos, setInfos] = useState<Record<string, Info>>({});
  const [busy, setBusy] = useState<string>('');
  const [message, setMessage] = useState('');
  const refresh = async () => {
    const out: Record<string, Info> = {};
    for (const [c] of CATS) out[c] = await cachedInfo(c);
    setInfos(out);
  };
  useEffect(() => {
    refresh();
  }, []);

  const reload = async (c: BlddbCategory, force: boolean) => {
    setBusy(c);
    setMessage('');
    try {
      if (force) await clearBlddb(c);
      await loadBlddb(c, force);
    } catch (e) {
      setMessage(`読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy('');
    refresh();
  };

  return (
    <Section title="BLDDB の手順">
      <p className="muted small">
        <a href="https://blddb.net/" target="_blank" rel="noreferrer">
          BLDDB
        </a>
        （世界のトップ選手が使っている手順のデータベース、作成: nbwzx ほか、データは GPL-3.0）の手順を、おすすめ手順と一括登録に使います。データはアプリに含めず、必要になったときにこの端末が GitHub から直接読み込んで保存します（1 種類あたり数 MB）。手順は 1 つずつシミュレーターで回して、正しいケースに割り当てています。
      </p>
      <ul className="blddb-list">
        {CATS.map(([c, label]) => {
          const info = infos[c];
          return (
            <li key={c}>
              <span>{label}</span>
              <span className="muted small">
                {info ? `${info.cases} ケース・${new Date(info.fetchedAt).toLocaleDateString()} 取得` : '未取得'}
              </span>
              <button className="btn small" disabled={!!busy} onClick={() => reload(c, !!info)}>
                {busy === c ? '読み込み中…' : info ? '最新版に更新' : '読み込む'}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="row wrap">
        <button
          className="btn small"
          disabled={!!busy}
          onClick={async () => {
            for (const [c] of CATS) if (!infos[c]) await reload(c, false);
          }}
        >
          まだのものをすべて読み込む（オフライン用）
        </button>
      </div>
      {message && <p className="error small">{message}</p>}
    </Section>
  );
}
