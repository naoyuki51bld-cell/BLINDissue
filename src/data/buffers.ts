// バッファの順番（フローティングバッファ）
import { samePiece, type PieceType, type StickerId } from '../cube/pieces';
import type { PieceConfig } from './store';

/** バッファの順番（1 番目がメイン）。未設定なら今のバッファだけ */
export function bufferOrder(cfg: PieceConfig): StickerId[] {
  return cfg.bufferOrder?.length ? cfg.bufferOrder : [cfg.buffer];
}

/** そのバッファより前に使うバッファ（そのパーツはターゲットにならない）。順番に無いバッファなら空 */
export function earlierBuffers(pt: PieceType, cfg: PieceConfig, buffer: StickerId): StickerId[] {
  const order = bufferOrder(cfg);
  const i = order.findIndex((b) => samePiece(pt, b, buffer));
  return i > 0 ? order.slice(0, i) : [];
}

/** 順番の中での位置（1 始まり、無ければ null） */
export function bufferRank(pt: PieceType, cfg: PieceConfig, buffer: StickerId): number | null {
  const i = bufferOrder(cfg).findIndex((b) => samePiece(pt, b, buffer));
  return i >= 0 ? i + 1 : null;
}
