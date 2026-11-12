// Firebase（メールアドレスでのログイン + Firestore）による端末間の同期。
// 設定（firebaseConfig）は、ビルド時の環境変数 VITE_FIREBASE_CONFIG か、アプリの設定画面で貼り付けたもの（この端末に保存）を使う。
import { create } from 'zustand';
import type { FirebaseApp } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import type { Firestore, Unsubscribe } from 'firebase/firestore';
import { replaceListeners, useStore } from '../data/store';
import { joinChunks, mergeChunk, splitChunks, stableJson, type Chunks } from './merge';

const CONFIG_KEY = 'firebase.config';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  [k: string]: string;
}

/** Firebase コンソールからコピーした `const firebaseConfig = { … };` も JSON も受け付ける */
export function parseConfig(text: string): FirebaseConfig | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let body = m[0];
  try {
    return check(JSON.parse(body));
  } catch {
    body = body
      .replace(/\/\/.*$/gm, '')
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,\s*}/g, '}');
    try {
      return check(JSON.parse(body));
    } catch {
      return null;
    }
  }
  function check(x: unknown): FirebaseConfig | null {
    const c = x as FirebaseConfig;
    return c && typeof c.apiKey === 'string' && typeof c.projectId === 'string' ? c : null;
  }
}

export function builtInConfig(): FirebaseConfig | null {
  const raw = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;
  return raw ? parseConfig(raw) : null;
}

export function savedConfig(): FirebaseConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? parseConfig(raw) : null;
  } catch {
    return null;
  }
}

export function activeConfig(): FirebaseConfig | null {
  return savedConfig() ?? builtInConfig();
}

type SyncStatus = 'off' | 'signed-out' | 'syncing' | 'synced' | 'error';

interface SyncState {
  configured: boolean;
  status: SyncStatus;
  email: string | null;
  lastSync: number | null;
  error: string;
}

export const useSync = create<SyncState>()(() => ({
  configured: !!activeConfig(),
  status: activeConfig() ? 'signed-out' : 'off',
  email: null,
  lastSync: null,
  error: '',
}));

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let fs: typeof import('firebase/firestore') | null = null;
let authMod: typeof import('firebase/auth') | null = null;
let unsubSnapshot: Unsubscribe | null = null;
let unsubStore: (() => void) | null = null;
let uid: string | null = null;
let applyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
/** 最後にサーバーと一致していた各チャンクの内容（JSON） */
const synced = new Map<string, string>();
const remote = new Map<string, Record<string, unknown>>();

const errorText = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'メールアドレスかパスワードが違います',
    'auth/wrong-password': 'パスワードが違います',
    'auth/user-not-found': 'このメールアドレスのアカウントがありません',
    'auth/email-already-in-use': 'このメールアドレスはすでに登録されています（「ログイン」を使ってください）',
    'auth/weak-password': 'パスワードは 6 文字以上にしてください',
    'auth/invalid-email': 'メールアドレスの形式が正しくありません',
    'auth/operation-not-allowed': 'Firebase で「メール/パスワード」のログインが有効になっていません',
    'auth/network-request-failed': 'ネットワークに接続できません',
    'permission-denied': 'Firestore のルールで書き込みが拒否されました（ルールの設定を確認してください）',
  };
  return map[code] ?? (e instanceof Error ? e.message : String(e));
};

export async function initSync() {
  const config = activeConfig();
  if (!config || app) return;
  const [{ initializeApp }, a, f] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
  authMod = a;
  fs = f;
  app = initializeApp(config);
  auth = a.getAuth(app);
  db = f.getFirestore(app);
  a.onAuthStateChanged(auth, (user) => {
    if (user) start(user);
    else stop();
  });
  replaceListeners.add(() => {
    // バックアップの復元・初期化のあとは、この端末の内容でサーバーを上書きする
    synced.clear();
    remote.clear();
    schedulePush(0, true);
  });
}

function stop() {
  unsubSnapshot?.();
  unsubStore?.();
  unsubSnapshot = unsubStore = null;
  uid = null;
  synced.clear();
  remote.clear();
  useSync.setState({ status: activeConfig() ? 'signed-out' : 'off', email: null });
}

function start(user: User) {
  if (!db || !fs) return;
  uid = user.uid;
  useSync.setState({ status: 'syncing', email: user.email, error: '' });
  const col = fs.collection(db, 'users', user.uid, 'chunks');
  let first = true;
  unsubSnapshot = fs.onSnapshot(
    col,
    (snap) => {
      const incoming: Chunks = {};
      snap.docChanges().forEach((ch) => {
        if (ch.type === 'removed') return;
        try {
          incoming[ch.doc.id] = JSON.parse((ch.doc.data() as { json: string }).json);
        } catch {
          /* 壊れたチャンクは無視 */
        }
      });
      applyRemote(incoming);
      if (first) {
        first = false;
        schedulePush(0); // サーバーに無い・古い分をこの端末から送る
      }
      useSync.setState({ status: 'synced', lastSync: Date.now() });
    },
    (e) => useSync.setState({ status: 'error', error: errorText(e) }),
  );
  unsubStore = useStore.subscribe((s, prev) => {
    if (applyingRemote) return;
    if (s.algs !== prev.algs || s.pairs !== prev.pairs || s.reviews !== prev.reviews || s.pieces !== prev.pieces) schedulePush(3000);
  });
}

function localChunks(): Chunks {
  const s = useStore.getState();
  return splitChunks({ pieces: s.pieces, algs: s.algs, pairs: s.pairs, reviews: s.reviews });
}

function applyRemote(incoming: Chunks) {
  const local = localChunks();
  const merged: Chunks = { ...local };
  let changed = false;
  for (const [name, data] of Object.entries(incoming)) {
    remote.set(name, data);
    synced.set(name, stableJson(data));
    const m = mergeChunk(name, local[name], data);
    merged[name] = m;
    if (stableJson(m) !== stableJson(local[name] ?? {})) changed = true;
  }
  if (!changed) return;
  const joined = joinChunks(merged);
  applyingRemote = true;
  useStore.setState({ pieces: { ...useStore.getState().pieces, ...joined.pieces }, algs: joined.algs, pairs: joined.pairs, reviews: joined.reviews });
  applyingRemote = false;
}

function schedulePush(delay: number, overwrite = false) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    push(overwrite).catch((e) => useSync.setState({ status: 'error', error: errorText(e) }));
  }, delay);
}

async function push(overwrite = false) {
  if (!db || !fs || !uid) return;
  const local = localChunks();
  const writes: [string, string][] = [];
  for (const [name, data] of Object.entries(local)) {
    const base = overwrite ? data : mergeChunk(name, data, remote.get(name));
    const json = stableJson(base);
    if (synced.get(name) === json) continue;
    writes.push([name, json]);
  }
  if (!writes.length) return;
  useSync.setState({ status: 'syncing' });
  for (const [name, json] of writes) {
    await fs.setDoc(fs.doc(db, 'users', uid, 'chunks', name), { json, updatedAt: Date.now() });
    synced.set(name, json);
    remote.set(name, JSON.parse(json));
  }
  useSync.setState({ status: 'synced', lastSync: Date.now(), error: '' });
}

// アプリを閉じる・裏に回すときは待たずに送る
if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pushTimer) schedulePush(0);
  });

export async function signIn(email: string, password: string, create: boolean) {
  if (!auth || !authMod) await initSync();
  if (!auth || !authMod) throw new Error('Firebase の設定がありません');
  try {
    if (create) await authMod.createUserWithEmailAndPassword(auth, email, password);
    else await authMod.signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    throw new Error(errorText(e));
  }
}

export async function resetPassword(email: string) {
  if (!auth || !authMod) throw new Error('Firebase の設定がありません');
  try {
    await authMod.sendPasswordResetEmail(auth, email);
  } catch (e) {
    throw new Error(errorText(e));
  }
}

export async function signOut() {
  if (pushTimer) {
    clearTimeout(pushTimer);
    await push().catch(() => undefined);
  }
  if (auth && authMod) await authMod.signOut(auth);
}

export function syncNow() {
  schedulePush(0);
}

export function saveConfig(text: string): boolean {
  const c = parseConfig(text);
  if (!c) return false;
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {
    return false;
  }
  return true;
}

export function clearSavedConfig() {
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* 何もしない */
  }
}
