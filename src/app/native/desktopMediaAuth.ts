import type { DesktopMediaSession } from '../lib/desktopBridge';
import { desktopBridge } from '../lib/nativeShell';

let ready = false;
// Ignores stale IPC acks that resolve after a newer session push.
let latest: object | undefined;
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
  if (!bridge) return;
  const send = (session: DesktopMediaSession | null, token: object, retried: boolean): void => {
    void bridge
      .setMediaSession(session)
      .catch(() => ({ ok: false as const, code: 'IPC_ERROR' }))
      .then((res) => {
        if (latest !== token) return;
        if (res?.ok) setReady(session !== null);
        else if (!retried) send(session, token, true);
        else {
          // If a logout push fails twice at IPC, readiness stays false so the page requests no authenticated media.
          sentKey = undefined;
          setReady(false);
        }
      });
  };
  const push = (): void => {
    const raw = readActiveSession();
    const session = raw?.accessToken
      ? { baseUrl: raw.baseUrl, accessToken: raw.accessToken }
      : null;
    const key = session ? `${session.baseUrl}\0${session.accessToken}` : '';
    if (key === sentKey) return;
    sentKey = key;
    setReady(false);
    const token = {};
    latest = token;
    send(session, token, false);
  };
  subscribe(push);
  push();
};
