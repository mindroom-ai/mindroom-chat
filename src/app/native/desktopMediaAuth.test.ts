// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopMediaSession, DesktopResult } from '../lib/desktopBridge';
import {
  getActiveSession,
  listSessions,
  putSession,
  removeSession,
  setActiveSession,
  subscribeToSessionStore,
  updateSessionCredentials,
  updateSessionLastPath,
} from '../matrix/session/sessions';

const OK: DesktopResult<void> = { ok: true, value: undefined };

/** A bridge whose synchronous push answers `answer.current` (or throws when it is undefined). */
const installBridge = () => {
  const calls: Array<DesktopMediaSession | null> = [];
  const answer: { current: DesktopResult<void> | undefined } = { current: OK };
  const bridge: DesktopBridge = {
    onShellEvent: vi.fn(() => () => undefined),
    setMediaSession: (session) => {
      calls.push(session);
      if (!answer.current) throw new Error('main is gone');
      return answer.current;
    },
    startSignIn: async () => ({ ok: true, value: '' }),
    openSignIn: async () => ({ ok: true, value: undefined }),
    showMainWindow: async () => ({ ok: true, value: undefined }),
    screenShare: false,
    appUrl: {
      addListener: async () => ({ remove: () => undefined }),
      getLaunchUrl: async () => undefined,
    },
  };
  Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: bridge });
  return { calls, answer };
};

const stops: Array<() => void> = [];
const trackedSubscribe = (listener: () => void): (() => void) => {
  const stop = subscribeToSessionStore(listener);
  stops.push(stop);
  return stop;
};

const account = (name: string, accessToken = `tok-${name}`) => ({
  baseUrl: 'https://hs.example',
  userId: `@${name}:example`,
  deviceId: `DEV-${name}`,
  accessToken,
});
const pushed = (name: string, accessToken = `tok-${name}`): DesktopMediaSession => ({
  baseUrl: 'https://hs.example',
  userId: `@${name}:example`,
  accessToken,
});

const start = async () => {
  const mod = await import('./desktopMediaAuth');
  const bridge = installBridge();
  const notified = vi.fn();
  stops.push(mod.subscribeDesktopMediaAuth(notified));
  return {
    ...bridge,
    notified,
    ready: mod.desktopMediaAuthReady,
    start: () => mod.startDesktopMediaAuth(getActiveSession, trackedSubscribe),
  };
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  Reflect.deleteProperty(window, 'mindroomDesktop');
  window.localStorage.clear();
});

describe('desktopMediaAuth', () => {
  it('pushes the active session of 21 stored accounts at start, on a switch, and on logout', async () => {
    const auth = await start();
    for (let i = 1; i <= 21; i += 1) putSession(account(`user${i}`), { setActive: i === 21 });

    // Ready as soon as the start returns: the push is synchronous.
    auth.start();
    expect(auth.calls).toEqual([pushed('user21')]);
    expect(auth.ready()).toBe(true);
    expect(auth.notified).toHaveBeenCalledOnce();

    // A switch pushes the new account and readiness never drops.
    const target = listSessions().find((s) => s.userId === '@user5:example')!;
    setActiveSession(target.sessionId);
    expect(auth.calls.at(-1)).toEqual(pushed('user5'));
    expect(auth.ready()).toBe(true);
    expect(auth.notified).toHaveBeenCalledOnce();

    // Writes that change neither the homeserver nor the token push nothing.
    const before = auth.calls.length;
    updateSessionLastPath(target.sessionId, '/home/room');
    expect(auth.calls).toHaveLength(before);

    // Logout of every account ends with a null push and drops readiness once.
    for (const { sessionId } of listSessions()) removeSession(sessionId);
    expect(auth.calls.at(-1)).toBeNull();
    expect(auth.ready()).toBe(false);
    expect(auth.notified).toHaveBeenCalledTimes(2);

    // Signing in again makes it ready again.
    putSession(account('alice'));
    expect(auth.calls.at(-1)).toEqual(pushed('alice'));
    expect(auth.ready()).toBe(true);
    expect(auth.notified).toHaveBeenCalledTimes(3);
  });

  it('never makes readiness false on a same-account token refresh', async () => {
    const auth = await start();
    putSession(account('alice', 'tok-1'));
    auth.start();
    const { sessionId } = getActiveSession()!;
    auth.notified.mockClear();
    const seen: boolean[] = [];
    stops.push(subscribeToSessionStore(() => seen.push(auth.ready())));

    updateSessionCredentials(sessionId, { accessToken: 'tok-2' });

    expect(auth.calls).toEqual([pushed('alice', 'tok-1'), pushed('alice', 'tok-2')]);
    expect(auth.ready()).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain(false);
    expect(auth.notified).not.toHaveBeenCalled();
  });

  it('makes readiness false on a rejected or throwing push, and true again on the next accepted one', async () => {
    const auth = await start();
    putSession(account('alice'));
    auth.answer.current = { ok: false, code: 'BAD_ARGUMENTS' };
    auth.start();
    expect(auth.calls).toEqual([pushed('alice')]);
    expect(auth.ready()).toBe(false);
    expect(auth.notified).not.toHaveBeenCalled();

    // A rejected push is offered again on the next store change, even for the same session.
    auth.answer.current = OK;
    putSession(account('alice'));
    expect(auth.calls).toEqual([pushed('alice'), pushed('alice')]);
    expect(auth.ready()).toBe(true);

    putSession(account('bob'));
    expect(auth.ready()).toBe(true);

    auth.answer.current = { ok: false, code: 'FORBIDDEN' };
    putSession(account('carol'));
    expect(auth.calls.at(-1)).toEqual(pushed('carol'));
    expect(auth.ready()).toBe(false);

    auth.answer.current = OK;
    putSession(account('dave'));
    expect(auth.ready()).toBe(true);
    auth.answer.current = undefined;
    putSession(account('erin'));
    expect(auth.ready()).toBe(false);
    expect(auth.notified).toHaveBeenCalledTimes(4);
  });

  it('does nothing without the desktop bridge', async () => {
    const { desktopMediaAuthReady, startDesktopMediaAuth } = await import('./desktopMediaAuth');
    putSession(account('alice'));
    startDesktopMediaAuth(getActiveSession, trackedSubscribe);
    expect(desktopMediaAuthReady()).toBe(false);
  });
});
