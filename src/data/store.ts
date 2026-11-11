import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { del, get, set } from 'idb-keyval';
import { DEFAULT_SIZE, PIECE_TYPES, type PieceType, type StickerId } from '../cube/pieces';
import { labelsFromList, PRESETS, type Labels } from './schemes';
import { review, type Grade, type ReviewState } from './srs';

export type Status = 'none' | 'learning' | 'learned' | 'auto';
export const STATUS_LABEL: Record<Status, string> = {
  none: '未着手',
  learning: '練習中',
  learned: '覚えた',
  auto: '自動化',
};
export const STATUSES: Status[] = ['none', 'learning', 'learned', 'auto'];

export interface PieceConfig {
  labels: Labels;
  buffer: StickerId;
  size: number;
  /** ペアをローマ字→かな読みで併記する */
  kana: boolean;
}

export interface AlgEntry {
  algs: string[];
  main: number;
  status: Status;
  memo: string;
  updatedAt: number;
}

export interface PairEntry {
  word: string;
  memo: string;
  status: Status;
  updatedAt: number;
}

export interface AppData {
  version: 1;
  pieces: Record<PieceType, PieceConfig>;
  algs: Record<string, AlgEntry>;
  pairs: Record<string, PairEntry>;
  reviews: Record<string, ReviewState>;
}

export const algKey = (pt: PieceType, buffer: StickerId, a: StickerId, b: StickerId) => `${pt}|${buffer}|${a}|${b}`;
export const algReviewKey = (k: string) => `a|${k}`;
export const pairReviewKey = (pair: string) => `p|${pair}`;

export function parseAlgKey(k: string) {
  const [pt, buffer, a, b] = k.split('|');
  return { pt: pt as PieceType, buffer, a, b };
}

const DEFAULT_BUFFER: Record<PieceType, StickerId> = {
  corner: 'U2', // UFR
  edge: 'U2', // UF
  wing: 'U2', // UFr
  xcenter: 'U0', // Ubl
  tcenter: 'U0', // Ub
};

export function defaultData(): AppData {
  const kana = PRESETS.find((p) => p.id === 'kana')!.labels;
  const speffz = PRESETS.find((p) => p.id === 'speffz')!.labels;
  const pieces = {} as Record<PieceType, PieceConfig>;
  for (const pt of PIECE_TYPES) {
    pieces[pt] = {
      labels: labelsFromList(pt === 'corner' ? kana : speffz),
      buffer: DEFAULT_BUFFER[pt],
      size: DEFAULT_SIZE[pt],
      kana: pt !== 'corner',
    };
  }
  return { version: 1, pieces, algs: {}, pairs: {}, reviews: {} };
}

interface Actions {
  setPiece: (pt: PieceType, patch: Partial<PieceConfig>) => void;
  setAlg: (key: string, patch: Partial<AlgEntry>) => void;
  setAlgsBulk: (entries: Record<string, Partial<AlgEntry>>) => void;
  deleteAlg: (key: string) => void;
  setPair: (pair: string, patch: Partial<PairEntry>) => void;
  setPairsBulk: (entries: Record<string, Partial<PairEntry>>) => void;
  recordReview: (key: string, grade: Grade, timeMs: number) => void;
  resetReview: (key: string) => void;
  replaceAll: (data: AppData) => void;
}

const emptyAlg = (): AlgEntry => ({ algs: [], main: 0, status: 'none', memo: '', updatedAt: Date.now() });
const emptyPair = (): PairEntry => ({ word: '', memo: '', status: 'none', updatedAt: Date.now() });

const idbStorage: StateStorage = {
  getItem: async (name) => (await get<string>(name)) ?? null,
  setItem: (name, value) => set(name, value),
  removeItem: (name) => del(name),
};

export const useStore = create<AppData & Actions>()(
  persist(
    (setState) => ({
      ...defaultData(),
      setPiece: (pt, patch) =>
        setState((s) => ({ pieces: { ...s.pieces, [pt]: { ...s.pieces[pt], ...patch } } })),
      setAlg: (key, patch) =>
        setState((s) => ({
          algs: { ...s.algs, [key]: { ...(s.algs[key] ?? emptyAlg()), ...patch, updatedAt: Date.now() } },
        })),
      setAlgsBulk: (entries) =>
        setState((s) => {
          const algs = { ...s.algs };
          for (const [k, patch] of Object.entries(entries))
            algs[k] = { ...(algs[k] ?? emptyAlg()), ...patch, updatedAt: Date.now() };
          return { algs };
        }),
      deleteAlg: (key) =>
        setState((s) => {
          const algs = { ...s.algs };
          delete algs[key];
          return { algs };
        }),
      setPair: (pair, patch) =>
        setState((s) => ({
          pairs: { ...s.pairs, [pair]: { ...(s.pairs[pair] ?? emptyPair()), ...patch, updatedAt: Date.now() } },
        })),
      setPairsBulk: (entries) =>
        setState((s) => {
          const pairs = { ...s.pairs };
          for (const [k, patch] of Object.entries(entries))
            pairs[k] = { ...(pairs[k] ?? emptyPair()), ...patch, updatedAt: Date.now() };
          return { pairs };
        }),
      recordReview: (key, grade, timeMs) =>
        setState((s) => ({ reviews: { ...s.reviews, [key]: review(s.reviews[key], grade, timeMs) } })),
      resetReview: (key) =>
        setState((s) => {
          const reviews = { ...s.reviews };
          delete reviews[key];
          return { reviews };
        }),
      replaceAll: (data) => setState(() => ({ ...defaultData(), ...data })),
    }),
    {
      name: 'bld-trainer',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ version: s.version, pieces: s.pieces, algs: s.algs, pairs: s.pairs, reviews: s.reviews }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppData>;
        const d = defaultData();
        return {
          ...current,
          ...p,
          pieces: { ...d.pieces, ...(p.pieces ?? {}) },
        };
      },
    },
  ),
);

export function exportData(): AppData {
  const s = useStore.getState();
  return { version: 1, pieces: s.pieces, algs: s.algs, pairs: s.pairs, reviews: s.reviews };
}

export function isAppData(x: unknown): x is AppData {
  const d = x as AppData;
  return !!d && typeof d === 'object' && d.version === 1 && typeof d.pieces === 'object' && typeof d.algs === 'object';
}
