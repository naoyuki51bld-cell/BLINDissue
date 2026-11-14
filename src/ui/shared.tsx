import { useMemo, useState, type ReactNode } from 'react';
import { casesFor, PIECE_LABEL, PIECE_TYPES, targetsFor, type PieceType, type StickerId } from '../cube/pieces';
import { verifyAlg, type VerifyResult } from '../cube/verify';
import { useStore, type PieceConfig, type Status, STATUS_LABEL } from '../data/store';
import { labelOf } from '../data/labels';
import { earlierBuffers } from '../data/buffers';

const verifyCache = new Map<string, VerifyResult>();

export function cachedVerify(pt: PieceType, cfg: PieceConfig, a: StickerId, b: StickerId, text: string): VerifyResult {
  const k = `${pt}|${cfg.size}|${cfg.buffer}|${a}|${b}|${text}`;
  let r = verifyCache.get(k);
  if (!r) {
    r = verifyAlg(pt, cfg.size, text, cfg.buffer, a, b);
    if (verifyCache.size > 20000) verifyCache.clear();
    verifyCache.set(k, r);
  }
  return r;
}

/** そのバッファのケース（バッファの順番で前にあるバッファのパーツは除く） */
export function useCases(pt: PieceType, buffer: StickerId) {
  const cfg = useStore((s) => s.pieces[pt]);
  const ex = earlierBuffers(pt, cfg, buffer);
  return useMemo(() => casesFor(pt, buffer, ex), [pt, buffer, ex.join(',')]);
}

export function useTargets(pt: PieceType, buffer: StickerId) {
  const cfg = useStore((s) => s.pieces[pt]);
  const ex = earlierBuffers(pt, cfg, buffer);
  return useMemo(() => targetsFor(pt, buffer, ex), [pt, buffer, ex.join(',')]);
}

export function PieceTabs({ value, onChange }: { value: PieceType; onChange: (pt: PieceType) => void }) {
  return (
    <div className="chips" role="tablist" aria-label="パーツの種類">
      {PIECE_TYPES.map((pt) => (
        <button
          key={pt}
          role="tab"
          aria-selected={value === pt}
          className={value === pt ? 'chip active' : 'chip'}
          onClick={() => onChange(pt)}
        >
          {PIECE_LABEL[pt]}
        </button>
      ))}
    </div>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function VerifyBadge({ result }: { result: VerifyResult | null }) {
  if (!result || result.kind === 'empty') return null;
  if (result.kind === 'ok')
    return (
      <span className="vbadge ok" title={result.rotation ? '持ち替えが残りますが正しい 3-cycle です' : '正しい 3-cycle です'}>
        ✓{result.rotation ? '持' : ''}
      </span>
    );
  if (result.kind === 'error')
    return (
      <span className="vbadge err" title={result.message}>
        記号?
      </span>
    );
  return (
    <span className="vbadge ng" title="このケースの 3-cycle になっていません">
      ✗
    </span>
  );
}

export function usePiece(pt: PieceType) {
  return useStore((s) => s.pieces[pt]);
}

export function TargetLabel({ pt, cfg, id }: { pt: PieceType; cfg: PieceConfig; id: StickerId }) {
  return <>{labelOf(pt, cfg, id)}</>;
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Section({ title, children, actions }: { title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** localStorage に覚えておく画面設定（使えない環境では普通の state として動く） */
export function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`ui.${key}`);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const update = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(`ui.${key}`, JSON.stringify(v));
    } catch {
      /* 保存できなくても動作は続ける */
    }
  };
  return [value, update];
}
