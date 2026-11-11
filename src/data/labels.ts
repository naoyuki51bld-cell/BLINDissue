import { stickerName, type PieceType, type StickerId } from '../cube/pieces';
import type { PieceConfig } from './store';
import { romajiToKana } from './schemes';

export function labelOf(pt: PieceType, cfg: PieceConfig, id: StickerId): string {
  return cfg.labels[id] || stickerName(pt, id);
}

export function pairText(pt: PieceType, cfg: PieceConfig, a: StickerId, b: StickerId): string {
  return labelOf(pt, cfg, a) + labelOf(pt, cfg, b);
}

export function pairReading(cfg: PieceConfig, text: string): string | null {
  if (!cfg.kana) return null;
  const k = romajiToKana(text);
  return k && k !== text ? k : null;
}
