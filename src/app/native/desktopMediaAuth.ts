import type { DesktopMediaSession } from '../lib/desktopBridge';
import { desktopBridge } from '../lib/nativeShell';

type ActiveMediaSession = DesktopMediaSession & { sessionId?: string; userId?: string };

let ready = false;
// Ignores stale IPC acks that resolve after a newer session switch or logout.
let seq = 0;
// Skips duplicate IPC pushes on metadata-only session store writes.
let sentKey: string | undefined;
let ackedAccountKey: string | undefined;
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
  readActiveSession: () => ActiveMediaSession | undefined,
  subscribe: (listener: () => void) => () => void
): void => {
  const bridge = desktopBridge();
  if (!bridge) return;
  const send = (
    session: DesktopMediaSession | null,
    accountKey: string | undefined,
    id: number,
    retried: boolean
  ): void => {
    void bridge
      .setMediaSession(session)
      .catch(() => ({ ok: false as const, code: 'IPC_ERROR' }))
      .then((res) => {
        if (id !== seq) return;
        if (res?.ok) {
          ackedAccountKey = session ? accountKey : undefined;
          setReady(session !== null);
        } else if (!retried) {
          send(session, accountKey, id, true);
        } else {
          sentKey = undefined;
          ackedAccountKey = undefined;
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
    const accountId = raw?.sessionId ?? raw?.userId;
    const accountKey = session && accountId ? `${session.baseUrl}\0${accountId}` : undefined;
    if (!(ready && accountKey !== undefined && accountKey === ackedAccountKey)) {
      ackedAccountKey = undefined;
      setReady(false);
    }
    send(session, accountKey, ++seq, false);
  };
  subscribe(push);
  push();
};
