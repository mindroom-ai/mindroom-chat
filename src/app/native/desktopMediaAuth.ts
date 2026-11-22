import type { DesktopMediaSession } from '../lib/desktopBridge';
import { desktopBridge } from '../lib/nativeShell';

let ready = false;
const listeners = new Set<() => void>();

/** Whether main holds the active session, so it authorizes this window's media requests. */
export const desktopMediaAuthReady = (): boolean => ready;

export const subscribeDesktopMediaAuth = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Pushes the active session to main synchronously, now and on every session store change. */
export const startDesktopMediaAuth = (
  readActiveSession: () => DesktopMediaSession | undefined,
  subscribe: (listener: () => void) => () => void
): void => {
  const bridge = desktopBridge();
  if (!bridge) return;
  let sent: DesktopMediaSession | null | undefined;
  const push = (): void => {
    const raw = readActiveSession();
    const session = raw?.accessToken
      ? { baseUrl: raw.baseUrl, userId: raw.userId, accessToken: raw.accessToken }
      : null;
    const same = sent?.baseUrl === session?.baseUrl && sent?.accessToken === session?.accessToken;
    if (sent !== undefined && same) return;
    sent = session;
    let ok = false;
    try {
      ok = bridge.setMediaSession(session).ok;
    } catch {
      // Main did not answer: it holds no session this page knows of.
    }
    const next = ok && session !== null;
    if (ready === next) return;
    ready = next;
    listeners.forEach((listener) => listener());
  };
  subscribe(push);
  push();
};
