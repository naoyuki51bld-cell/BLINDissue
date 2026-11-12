import { stickerName, type PieceType, type StickerId } from '../cube/pieces';
import type { PieceConfig } from './store';
import { romajiToKana } from './schemes';

/** 1 文字目として使うときの文字 */
export function labelOf(pt: PieceType, cfg: PieceConfig, id: StickerId): string {
  return cfg.labels[id] || stickerName(pt, id);
}

/** 2 文字目として使うときの文字（2 セット使わない設定なら 1 文字目と同じ） */
export function secondLabelOf(pt: PieceType, cfg: PieceConfig, id: StickerId): string {
  if (cfg.dual) return cfg.labels2?.[id] || cfg.labels[id] || stickerName(pt, id);
  return labelOf(pt, cfg, id);
}

/** 2 つのセットを並べた表示（例: "K/A"） */
export function bothLabels(pt: PieceType, cfg: PieceConfig, id: StickerId): string {
  const a = labelOf(pt, cfg, id);
  const b = secondLabelOf(pt, cfg, id);
  return a === b ? a : `${a}/${b}`;
}

export function pairText(pt: PieceType, cfg: PieceConfig, a: StickerId, b: StickerId): string {
  return labelOf(pt, cfg, a) + secondLabelOf(pt, cfg, b);
}

export function pairReading(cfg: PieceConfig, text: string): string | null {
  if (!cfg.kana) return null;
  const k = romajiToKana(text);
  return k && k !== text ? k : null;
}
