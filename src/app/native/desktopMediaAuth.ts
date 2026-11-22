import type { DesktopBridge, DesktopMediaSession } from '../lib/desktopBridge';
import { isRecord } from '../lib/isRecord';
import { desktopBridge } from '../lib/nativeShell';
import { getSafeLocalStorage, getStorageItemSafe } from '../lib/safeLocalStorage';
import {
  MINDROOM_SESSION_STORE_EVENT,
  MINDROOM_SESSION_STORE_KEY,
} from '../lib/sessionStoreConfig';

let ready = false;
let seq = 0;
let sentKey: string | undefined;
let started: DesktopBridge | undefined;
let stop: (() => void) | undefined;
const listeners = new Set<() => void>();

const setReady = (next: boolean): void => {
  if (ready === next) return;
  ready = next;
  listeners.forEach((l) => l());
};

const readActiveSession = (): DesktopMediaSession | null => {
  try {
    const p: unknown = JSON.parse(
      getStorageItemSafe(getSafeLocalStorage(), MINDROOM_SESSION_STORE_KEY) ?? ''
    );
    if (!isRecord(p) || !Array.isArray(p.sessions) || typeof p.activeSessionId !== 'string')
      return null;
    if (typeof p.version === 'number' && p.version > 1) return null;
    const s = p.sessions.find(
      (e): e is DesktopMediaSession =>
        isRecord(e) &&
        e.sessionId === p.activeSessionId &&
        typeof e.baseUrl === 'string' &&
        typeof e.userId === 'string' &&
        typeof e.deviceId === 'string' &&
        typeof e.accessToken === 'string'
    );
    return s && s.accessToken ? { baseUrl: s.baseUrl, accessToken: s.accessToken } : null;
  } catch {
    return null;
  }
};

const push = (): void => {
  const bridge = desktopBridge();
  if (!bridge) return;
  const session = readActiveSession();
  const key = session ? `${session.baseUrl}\0${session.accessToken}` : '';
  if (key === sentKey) return;
  sentKey = key;
  setReady(false);
  const id = ++seq;
  void Promise.resolve(bridge.setMediaSession(session))
    .catch(() => ({ ok: false as const, code: 'IPC_ERROR' }))
    .then((res) => {
      if (id !== seq) return;
      if (res?.ok) setReady(session !== null);
      else sentKey = undefined;
    });
};

export const desktopMediaAuthReady = (): boolean => ready;

export const subscribeDesktopMediaAuth = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const startDesktopMediaAuth = (): void => {
  const bridge = desktopBridge();
  if (started === bridge) {
    if (bridge) push();
    return;
  }
  stop?.();
  stop = undefined;
  started = bridge;
  sentKey = undefined;
  seq += 1;
  setReady(false);
  if (!bridge || typeof window === 'undefined') return;
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === MINDROOM_SESSION_STORE_KEY) push();
  };
  const win = window;
  win.addEventListener(MINDROOM_SESSION_STORE_EVENT, push);
  win.addEventListener('storage', onStorage);
  stop = () => {
    win.removeEventListener(MINDROOM_SESSION_STORE_EVENT, push);
    win.removeEventListener('storage', onStorage);
  };
  push();
};
