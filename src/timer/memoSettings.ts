import { stickerName, type StickerId } from '../cube/pieces';
import { bufferOrder } from '../data/buffers';
import { labelOf, pairText } from '../data/labels';
import type { AppData } from '../data/store';
import type { MemoSettings } from './memo';

/** 今の設定（バッファの順番・文字の割り振り・登録した手順）から、正解のメモを作る設定を作る */
export function memoSettingsFrom(pieces: AppData['pieces'], algs: AppData['algs']): MemoSettings {
  const buffersWithAlgs = new Set<string>();
  for (const [k, e] of Object.entries(algs)) {
    if (!e.algs.length) continue;
    const [pt, buf] = k.split('|');
    buffersWithAlgs.add(`${pt}|${buf}`);
  }
  return {
    cornerBuffers: bufferOrder(pieces.corner),
    edgeBuffers: bufferOrder(pieces.edge),
    algOf: (key) => {
      const e = algs[key];
      return e?.algs.length ? e.algs[e.main] : undefined;
    },
    hasBuffer: (pt, b) => buffersWithAlgs.has(`${pt}|${b}`),
    label: (pt, buf, a, b) => {
      const cfg = pieces[pt];
      const main = bufferOrder(cfg)[0];
      return `${pairText(pt, cfg, a, b)}${buf !== main ? `（${stickerName(pt, buf)}）` : ''}`;
    },
    single: (pt, id: StickerId) => labelOf(pt, pieces[pt], id),
  };
}
