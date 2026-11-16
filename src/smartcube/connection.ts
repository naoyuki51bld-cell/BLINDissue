// GAN スマートキューブとの Bluetooth 接続（Web Bluetooth）
import { create } from 'zustand';
import type { Face } from '../cube/cube';
import { DEFAULT_GRIP, gripMap, parseFaceTurn, type FaceTurn, type Grip } from './tracker';
import { applyTurnColors, fromFacelets, solvedColors, type Colors } from '../timer/cubeColors';

type Status = 'disconnected' | 'connecting' | 'connected';

export interface MoveEvent {
  /** 持ち方に合わせて変換した回転 */
  turn: FaceTurn;
  /** キューブ本来の面名での回転 */
  raw: string;
  time: number;
}

type Listener = (e: MoveEvent) => void;

interface SmartCubeState {
  status: Status;
  deviceName: string;
  battery: number | null;
  error: string;
  grip: Grip;
  /** キューブ本来の向きでの色の状態（分からなければ null） */
  colors: Colors | null;
  /** キューブに今の状態を問い合わせる（届くまで最大 1.5 秒待つ） */
  requestState: () => Promise<Colors | null>;
  /** 今の状態を「揃っている」として扱う（状態を取得できない機種・動作確認用） */
  assumeSolved: () => void;
  /** キューブを揃えた状態でリセット（キューブ内部の状態も揃った状態にする） */
  resetSolved: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  setGrip: (g: Grip) => void;
  subscribe: (fn: Listener) => () => void;
  /** 動作確認用: キューブ本来の面名の回転を流す */
  emitRaw: (moves: string) => void;
}

const listeners = new Set<Listener>();
let connection: { disconnect: () => Promise<void>; sendCubeCommand: (c: { type: 'REQUEST_FACELETS' | 'REQUEST_BATTERY' | 'REQUEST_RESET' }) => Promise<void> } | null = null;
let stateWaiters: ((c: Colors | null) => void)[] = [];

const GRIP_KEY = 'smartcube.grip';
const MAC_KEY = 'smartcube.mac';

function loadGrip(): Grip {
  try {
    const g = JSON.parse(localStorage.getItem(GRIP_KEY) ?? 'null') as Grip | null;
    if (g && g.top && g.front) {
      gripMap(g);
      return g;
    }
  } catch {
    /* 読めなければ標準の持ち方 */
  }
  return DEFAULT_GRIP;
}

function loadMacs(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(MAC_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveMac(name: string, mac: string) {
  try {
    localStorage.setItem(MAC_KEY, JSON.stringify({ ...loadMacs(), [name]: mac }));
  } catch {
    /* 保存できなくても接続は続ける */
  }
}

export function bluetoothSupport(): { ok: boolean; message: string } {
  if (typeof navigator !== 'undefined' && 'bluetooth' in navigator) return { ok: true, message: '' };
  const ios = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
  return {
    ok: false,
    message: ios
      ? 'iPhone の Safari / Chrome は Bluetooth 接続に対応していません。App Store の「Bluefy – Web BLE Browser」でこのページを開いてください。'
      : 'このブラウザは Bluetooth 接続（Web Bluetooth）に対応していません。パソコン・Android の Chrome か Edge で開いてください。',
  };
}

export const useSmartCube = create<SmartCubeState>()((set, get) => {
  const dispatch = (raw: string) => {
    const t = parseFaceTurn(raw);
    if (!t) return;
    const cur = get().colors;
    if (cur) set({ colors: applyTurnColors(cur, t) });
    const map = gripMap(get().grip);
    const e: MoveEvent = { turn: { face: map[t.face as Face], amount: t.amount }, raw, time: performance.now() };
    listeners.forEach((fn) => fn(e));
  };

  return {
    status: 'disconnected',
    deviceName: '',
    battery: null,
    error: '',
    grip: loadGrip(),
    colors: null,
    requestState: async () => {
      if (!connection) return get().colors;
      const p = new Promise<Colors | null>((resolve) => {
        stateWaiters.push(resolve);
        setTimeout(() => resolve(get().colors), 1500);
      });
      await connection.sendCubeCommand({ type: 'REQUEST_FACELETS' }).catch(() => undefined);
      return p;
    },
    assumeSolved: () => set({ colors: solvedColors() }),
    resetSolved: async () => {
      set({ colors: solvedColors() });
      if (connection) {
        await connection.sendCubeCommand({ type: 'REQUEST_RESET' }).catch(() => undefined);
        // リセット後の状態を読み直す（揃っていれば一致する）
        setTimeout(() => connection?.sendCubeCommand({ type: 'REQUEST_FACELETS' }).catch(() => undefined), 400);
      }
    },
    setGrip: (g) => {
      set({ grip: g });
      try {
        localStorage.setItem(GRIP_KEY, JSON.stringify(g));
      } catch {
        /* 保存できなくても動作は続ける */
      }
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emitRaw: (moves) => {
      if (!get().colors) set({ colors: solvedColors() });
      moves.split(/\s+/).filter(Boolean).forEach(dispatch);
    },
    connect: async () => {
      const support = bluetoothSupport();
      if (!support.ok) {
        set({ error: support.message });
        return;
      }
      set({ status: 'connecting', error: '' });
      try {
        const { connectGanCube } = await import('gan-web-bluetooth');
        const conn = await connectGanCube(async (device, isFallbackCall) => {
          const saved = loadMacs()[device.name ?? ''];
          if (saved && !isFallbackCall) return saved;
          if (!isFallbackCall) return null; // まずはライブラリに自動取得を試させる
          const mac = window.prompt(
            'キューブの MAC アドレスを入力してください（例: AB:12:34:CD:56:EF）。\n' +
              'GAN の公式アプリの「キューブ情報」などで確認できます。一度入力すれば次からは不要です。',
            saved ?? '',
          );
          if (mac && device.name) saveMac(device.name, mac.trim().toUpperCase());
          return mac ? mac.trim().toUpperCase() : null;
        });
        connection = conn;
        if (conn.deviceMAC) saveMac(conn.deviceName, conn.deviceMAC);
        set({ status: 'connected', deviceName: conn.deviceName });
        conn.events$.subscribe((ev) => {
          if (ev.type === 'MOVE') dispatch(ev.move);
          else if (ev.type === 'FACELETS') {
            const c = fromFacelets(ev.facelets);
            if (c) set({ colors: c });
            stateWaiters.forEach((fn) => fn(c));
            stateWaiters = [];
          }
          else if (ev.type === 'BATTERY') set({ battery: ev.batteryLevel });
          else if (ev.type === 'DISCONNECT') {
            connection = null;
            set({ status: 'disconnected', battery: null, colors: null });
          }
        });
        conn.sendCubeCommand({ type: 'REQUEST_BATTERY' }).catch(() => undefined);
        conn.sendCubeCommand({ type: 'REQUEST_FACELETS' }).catch(() => undefined);
      } catch (e) {
        connection = null;
        const msg = e instanceof Error ? e.message : String(e);
        set({
          status: 'disconnected',
          error: /cancel|chosen/i.test(msg) ? '' : `接続できませんでした: ${msg}`,
        });
      }
    },
    disconnect: async () => {
      await connection?.disconnect().catch(() => undefined);
      connection = null;
      set({ status: 'disconnected', battery: null });
    },
  };
});

// ?debug を付けて開くと、ブラウザのコンソールから useSmartCube の動作確認ができる
if (typeof window !== 'undefined' && /[?&]debug\b/.test(window.location.search)) {
  (window as unknown as { __smartCube: typeof useSmartCube }).__smartCube = useSmartCube;
}
