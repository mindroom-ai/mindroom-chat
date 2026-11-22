import type { DesktopMediaSession } from '../lib/desktopBridge';
import { desktopBridge } from '../lib/nativeShell';

let ready = false;
let started = false;
// Ignores stale IPC acks that resolve after a newer session switch or logout.
let seq = 0;
// Skips duplicate IPC pushes on metadata-only session store writes.
let sentKey: string | undefined;
const listeners = new Set<() => void>();

const setReady = (next: boolean): void => {
  if (ready === next) return;
  ready = next;
  listeners.forEach((listener) => listener());
};

export const desktopMediaAuthReady = (): boolean => ready;

export const subscribeDesktopMediaAuth = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const startDesktopMediaAuth = (
  readActiveSession: () => DesktopMediaSession | undefined,
  subscribe: (listener: () => void) => () => void
): void => {
  const bridge = desktopBridge();
  if (started || !bridge) return;
  started = true;
  const push = (): void => {
    const raw = readActiveSession();
    const session = raw?.accessToken
      ? { baseUrl: raw.baseUrl, accessToken: raw.accessToken }
      : null;
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
  subscribe(push);
  push();
};
