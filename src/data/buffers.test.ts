import { describe, expect, it } from 'vitest';
import { casesFor, targetsFor } from '../cube/pieces';
import { bufferOrder, bufferRank, earlierBuffers } from './buffers';
import { defaultData } from './store';

describe('buffer order', () => {
  // エッジ: UF = U2, UB = U0, UR = U1
  const cfg = { ...defaultData().pieces.edge, buffer: 'U0', bufferOrder: ['U2', 'U0', 'U1'] };
  it('excludes pieces of earlier buffers', () => {
    expect(bufferOrder(cfg)).toEqual(['U2', 'U0', 'U1']);
    expect(earlierBuffers('edge', cfg, 'U2')).toEqual([]);
    expect(earlierBuffers('edge', cfg, 'U0')).toEqual(['U2']);
    expect(earlierBuffers('edge', cfg, 'B0')).toEqual(['U2']); // BU は UB と同じパーツ
    expect(casesFor('edge', 'U2', earlierBuffers('edge', cfg, 'U2'))).toHaveLength(440);
    expect(casesFor('edge', 'U0', earlierBuffers('edge', cfg, 'U0'))).toHaveLength(360); // 20 × 18
    expect(casesFor('edge', 'U1', earlierBuffers('edge', cfg, 'U1'))).toHaveLength(288); // 18 × 16
    // UB バッファでは UF・FU はターゲットにならない
    const t = targetsFor('edge', 'U0', ['U2']);
    expect(t).not.toContain('U2');
    expect(t).not.toContain('F0');
    expect(bufferRank('edge', cfg, 'U1')).toBe(3);
  });
  it('corners: UFR → UFL', () => {
    const c = { ...defaultData().pieces.corner, bufferOrder: ['U2', 'U3'] };
    expect(casesFor('corner', 'U3', earlierBuffers('corner', c, 'U3'))).toHaveLength(18 * 15);
  });
  it('without an order, nothing is excluded', () => {
    const c = defaultData().pieces.edge;
    expect(earlierBuffers('edge', c, 'U0')).toEqual([]);
  });
});
