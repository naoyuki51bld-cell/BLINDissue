import { usePersisted } from './shared';

export interface SuggestEntry {
  alg: string;
  moves: number | null;
  source?: string;
  users?: string[];
  note?: string;
}

/** BLDDB で「この選手の手順」を優先するための選手名（端末ごと） */
export function useFavoritePlayer() {
  return usePersisted<string>('blddb.player', '');
}

export function SuggestItem({ s, added, onPick }: { s: SuggestEntry; added: boolean; onPick: (alg: string, asMain: boolean) => void }) {
  const [favorite] = useFavoritePlayer();
  const users = s.users ?? [];
  const fav = !!favorite && users.includes(favorite);
  return (
    <li className={fav ? 'fav' : undefined}>
      <span className="suggest-alg">
        {s.source && <span className={`source-tag src-${s.source.toLowerCase()}`}>{s.source}</span>}
        {s.alg}
      </span>
      <span className="muted small">{s.moves !== null ? `${s.moves} 手` : ''}</span>
      {(users.length > 0 || s.note) && (
        <span className="suggest-users small">
          {s.note && <span className="muted">{s.note}　</span>}
          {users.length > 0 && (
            <details>
              <summary>
                <b>{users.length} 人</b>が使用{fav && <span className="fav-mark">（★ {favorite}）</span>}：
                <span className="muted"> {users.slice(0, 3).join('、')}{users.length > 3 ? ' …' : ''}</span>
              </summary>
              <span className="muted">{users.join('、')}</span>
            </details>
          )}
        </span>
      )}
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
}
