import { generateSuggestions, suggestionsToObject } from './generator';
import type { PieceType } from './pieces';

self.onmessage = (e: MessageEvent<{ id: number; pt: PieceType; n: number; buffer: string }>) => {
  const { id, pt, n, buffer } = e.data;
  const table = suggestionsToObject(generateSuggestions(pt, n, buffer));
  (self as unknown as Worker).postMessage({ id, table });
};
