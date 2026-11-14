import { useMemo, useState } from 'react';
import { casesFor, samePiece, STICKER_IDS, stickerName, type PieceType, type StickerId } from '../cube/pieces';
import { bufferOrder } from '../data/buffers';
import { bothLabels } from '../data/labels';
import { useStore } from '../data/store';

/** バッファの順番を決める（例: エッジ UF → UB → UR）。後ろのバッファでは前のバッファのパーツをターゲットから外す */
export function BufferOrderEditor({ pt }: { pt: PieceType }) {
  const cfg = useStore((s) => s.pieces[pt]);
  const setPiece = useStore((s) => s.setPiece);
  const order = bufferOrder(cfg);
  const [adding, setAdding] = useState('');
  const counts = useMemo(() => order.map((b, i) => casesFor(pt, b, order.slice(0, i)).length), [pt, order.join(',')]);
  const save = (next: StickerId[]) => setPiece(pt, { bufferOrder: next });
  const candidates = STICKER_IDS.filter((id) => !order.some((b) => samePiece(pt, b, id)));

  return (
    <div className="stack buffer-order">
      <ol className="order-list">
        {order.map((b, i) => (
          <li key={b} className={b === cfg.buffer ? 'current' : undefined}>
            <span className="order-rank">{i + 1}</span>
            <button className="plain order-name" title="このバッファの手順表を表示・練習する" onClick={() => setPiece(pt, { buffer: b })}>
              <b>{stickerName(pt, b)}</b>（{bothLabels(pt, cfg, b)}）
            </button>
            <span className="muted small">{counts[i]} ケース</span>
            <span className="spacer" />
            <button className="icon-btn small" aria-label="上へ" disabled={i === 0} onClick={() => save(order.map((x, j) => (j === i - 1 ? b : j === i ? order[i - 1] : x)))}>
              ↑
            </button>
            <button
              className="icon-btn small"
              aria-label="下へ"
              disabled={i === order.length - 1}
              onClick={() => save(order.map((x, j) => (j === i + 1 ? b : j === i ? order[i + 1] : x)))}
            >
              ↓
            </button>
            <button className="icon-btn small" aria-label="外す" disabled={order.length === 1} onClick={() => save(order.filter((x) => x !== b))}>
              ✕
            </button>
          </li>
        ))}
      </ol>
      <div className="row wrap">
        <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="追加するバッファ">
          <option value="">バッファを追加…</option>
          {candidates.map((id) => (
            <option key={id} value={id}>
              {stickerName(pt, id)}（{bothLabels(pt, cfg, id)}）
            </option>
          ))}
        </select>
        <button
          className="btn small"
          disabled={!adding}
          onClick={() => {
            save([...order, adding]);
            setAdding('');
          }}
        >
          追加
        </button>
      </div>
      <p className="muted small">
        1 番目がメインのバッファです。2 番目以降のバッファでは、それより前のバッファのパーツ（例: UB バッファでは UF・FU）はターゲットにならないので、そのぶんケースが少なくなります。名前を押すと、そのバッファの手順表を表示・練習します。
      </p>
    </div>
  );
}
