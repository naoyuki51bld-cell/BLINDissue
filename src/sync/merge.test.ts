import { describe, expect, it } from 'vitest';
import { defaultData } from '../data/store';
import { joinChunks, mergeChunk, splitChunks, stableJson } from './merge';

describe('sync merge', () => {
  it('splits and joins without loss', () => {
    const d = defaultData();
    d.algs['corner|U2|U0|U1'] = { algs: ['R'], main: 0, status: 'none', memo: '', updatedAt: 1 };
    d.algs['parity|U2|U1'] = { algs: ['R'], main: 0, status: 'none', memo: '', updatedAt: 1 };
    d.reviews['a|corner|U2|U0|U1'] = { ease: 2.5, interval: 1, due: 0, reps: 1, lapses: 0, times: [500], lastReviewed: 5 };
    d.reviews['p|あい'] = { ease: 2.5, interval: 1, due: 0, reps: 1, lapses: 0, times: [500], lastReviewed: 5 };
    const chunks = splitChunks(d);
    expect(Object.keys(chunks).sort()).toEqual(['algs-corner', 'algs-parity', 'pairs', 'pieces', 'reviews-corner', 'reviews-pairs']);
    const back = joinChunks(chunks);
    expect(stableJson(back.algs)).toBe(stableJson(d.algs));
    expect(stableJson(back.reviews)).toBe(stableJson(d.reviews));
  });
  it('keeps the newer entry of each key', () => {
    const a = { x: { algs: ['A'], updatedAt: 10 }, y: { algs: ['Y'], updatedAt: 1 } };
    const b = { x: { algs: ['B'], updatedAt: 5 }, y: { algs: ['Y2'], updatedAt: 7 }, z: { algs: ['Z'], updatedAt: 3 } };
    const m = mergeChunk('algs-corner', a, b) as Record<string, { algs: string[] }>;
    expect(m.x.algs).toEqual(['A']);
    expect(m.y.algs).toEqual(['Y2']);
    expect(m.z.algs).toEqual(['Z']);
  });
  it('deletions win when they are newer (tombstones)', () => {
    const local = { x: { algs: [], updatedAt: 20 } };
    const remote = { x: { algs: ['R'], updatedAt: 10 } };
    expect((mergeChunk('algs-edge', local, remote).x as { algs: string[] }).algs).toEqual([]);
  });
});
