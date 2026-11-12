import { FACES } from '../cube/cube';
import { slotRC, STICKER_IDS, type PieceType, type StickerId, parseStickerId } from '../cube/pieces';

const FACE_POS: Record<string, [number, number]> = {
  U: [1, 0],
  L: [0, 1],
  F: [1, 1],
  R: [2, 1],
  B: [3, 1],
  D: [1, 2],
};

export const FACE_COLOR_VAR = ['var(--cube-u)', 'var(--cube-l)', 'var(--cube-f)', 'var(--cube-r)', 'var(--cube-b)', 'var(--cube-d)'];

export interface NetMark {
  id: StickerId;
  kind: 'buffer' | 'first' | 'second' | 'selected';
}

interface Props {
  n: number;
  pieceType?: PieceType;
  labels?: Record<StickerId, string>;
  /** 各ステッカーの色（面番号）。省略時は解いた状態 */
  colorOf?: Uint8Array;
  marks?: NetMark[];
  dimOthers?: boolean;
  onSlotClick?: (id: StickerId) => void;
  maxWidth?: number;
  title?: string;
  /** 表示するスロット（それ以外は薄く・文字なし） */
  visibleSlots?: Set<StickerId>;
  /** 文字が空のスロットに番号を薄く表示 */
  showNumbers?: boolean;
  /** その場で文字を編集しているスロット */
  editingId?: StickerId | null;
  onEditDone?: (id: StickerId, value: string, go: 'next' | 'prev' | 'stay') => void;
}

export function CubeNet({
  n,
  pieceType,
  labels,
  colorOf,
  marks = [],
  dimOthers,
  onSlotClick,
  maxWidth = 360,
  title,
  visibleSlots,
  showNumbers,
  editingId,
  onEditDone,
}: Props) {
  const cell = 10;
  const gap = 3;
  const faceSize = n * cell;
  const W = 4 * faceSize + 3 * gap + 2;
  const H = 3 * faceSize + 2 * gap + 2;
  const slotAt = new Map<number, StickerId>();
  if (pieceType)
    for (const id of STICKER_IDS) {
      const { face, slot } = parseStickerId(id);
      const [r, c] = slotRC(pieceType, slot, n);
      slotAt.set(FACES.indexOf(face) * n * n + r * n + c, id);
    }
  const markOf = new Map(marks.map((m) => [m.id, m.kind]));
  const rects = [];
  const texts = [];
  const slotPos = new Map<StickerId, { x: number; y: number }>();
  for (let f = 0; f < 6; f++) {
    const [fx, fy] = FACE_POS[FACES[f]];
    const ox = 1 + fx * (faceSize + gap);
    const oy = 1 + fy * (faceSize + gap);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const idx = f * n * n + r * n + c;
        const color = colorOf ? colorOf[idx] : f;
        const slotAll = slotAt.get(idx);
        const hidden = !!slotAll && !!visibleSlots && !visibleSlots.has(slotAll);
        const slot = hidden ? undefined : slotAll;
        const mark = slot ? markOf.get(slot) : undefined;
        const x = ox + c * cell;
        const y = oy + r * cell;
        if (slot) slotPos.set(slot, { x, y });
        const dim = (dimOthers && !mark) || hidden;
        rects.push(
          <rect
            key={idx}
            x={x + 0.4}
            y={y + 0.4}
            width={cell - 0.8}
            height={cell - 0.8}
            rx={1.2}
            fill={FACE_COLOR_VAR[color]}
            opacity={dim ? 0.35 : 1}
            stroke={mark ? 'var(--mark-stroke)' : 'var(--net-stroke)'}
            strokeWidth={mark ? 1.2 : 0.5}
            style={slot && onSlotClick ? { cursor: 'pointer' } : undefined}
            onClick={slot && onSlotClick ? () => onSlotClick(slot) : undefined}
          >
            {slot && <title>{labels?.[slot] || slot}</title>}
          </rect>,
        );
        const number = slot ? String(STICKER_IDS.indexOf(slot) + 1) : '';
        if (slot && (labels?.[slot] || mark || showNumbers)) {
          const label = labels?.[slot] ?? '';
          const text = mark === 'buffer' ? '★' : mark === 'first' ? '1' : mark === 'second' ? '2' : label || number;
          const len = Array.from(text).length;
          const fs = len <= 1 ? 6 : len === 2 ? 4.4 : 3.4;
          if (showNumbers && label && !mark)
            texts.push(
              <text key={`n${idx}`} x={x + 1.1} y={y + 2.6} fontSize={2.2} className="net-number" pointerEvents="none">
                {number}
              </text>,
            );
          texts.push(
            <text
              key={`t${idx}`}
              x={x + cell / 2}
              y={y + cell / 2 + fs * 0.36}
              fontSize={fs}
              textAnchor="middle"
              className={mark ? 'net-label net-label-mark' : label ? 'net-label' : 'net-label net-number'}
              pointerEvents="none"
            >
              {text}
            </text>,
          );
        }
      }
  }
  const svg = (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} role="img" aria-label={title ?? 'キューブの展開図'}>
      {rects}
      {texts}
    </svg>
  );
  const editPos = editingId ? slotPos.get(editingId) : undefined;
  return (
    <div className="net-wrap" style={{ maxWidth }}>
      {svg}
      {editingId && editPos && onEditDone && (
        <input
          key={editingId}
          className="net-edit"
          autoFocus
          defaultValue={labels?.[editingId] ?? ''}
          aria-label={`${editingId} の文字`}
          style={{
            left: `${((editPos.x - cell * 0.6) / W) * 100}%`,
            top: `${((editPos.y - cell * 0.25) / H) * 100}%`,
            width: `${((cell * 2.2) / W) * 100}%`,
          }}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            const v = (e.target as HTMLInputElement).value;
            if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
              e.preventDefault();
              onEditDone(editingId, v, 'next');
            } else if (e.key === 'Tab' && e.shiftKey) {
              e.preventDefault();
              onEditDone(editingId, v, 'prev');
            } else if (e.key === 'Escape') {
              onEditDone(editingId, labels?.[editingId] ?? '', 'stay');
            }
          }}
          onBlur={(e) => onEditDone(editingId, e.target.value, 'stay')}
        />
      )}
    </div>
  );
}
