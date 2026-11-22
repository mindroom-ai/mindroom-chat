// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopMediaSession, DesktopResult } from '../lib/desktopBridge';
import {
  getActiveSession,
  putSession,
  removeSession,
  setActiveSession,
  subscribeToSessionStore,
  updateSessionCredentials,
  updateSessionLastPath,
} from '../matrix/session/sessions';

type Deferred = {
  session: DesktopMediaSession | null;
  resolve: (result: DesktopResult<void>) => void;
};

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const installBridge = () => {
  const pending: Deferred[] = [];
  const calls: Array<DesktopMediaSession | null> = [];
  const bridge: DesktopBridge = {
    onShellEvent: vi.fn(() => () => undefined),
    setMediaSession: vi.fn((session: DesktopMediaSession | null) => {
      calls.push(session);
      return new Promise<DesktopResult<void>>((resolve) => {
        pending.push({ session, resolve });
      });
    }),
  };
  Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: bridge });
  return { bridge, pending, calls };
};

let unsubscribes: Array<() => void> = [];
const trackedSubscribe = (listener: () => void): (() => void) => {
  const stop = subscribeToSessionStore(listener);
  unsubscribes.push(stop);
  return stop;
};

beforeEach(() => {
  vi.resetModules();
  unsubscribes = [];
});

afterEach(() => {
  for (const stop of unsubscribes) stop();
  unsubscribes = [];
  Reflect.deleteProperty(window, 'mindroomDesktop');
  window.localStorage.clear();
});

describe('desktopMediaAuth', () => {
  it('follows the active session across 21 stored accounts, switches, token refreshes, and logout', async () => {
    const { desktopMediaAuthReady, startDesktopMediaAuth, subscribeDesktopMediaAuth } =
      await import('./desktopMediaAuth');
    const { pending, calls } = installBridge();
    const notifications = vi.fn();
    const stop = subscribeDesktopMediaAuth(notifications);

    try {
      for (let i = 1; i <= 21; i += 1) {
        putSession(
          {
            baseUrl: `https://hs-${(i % 3) + 1}.example`,
            userId: `@user${i}:example`,
            deviceId: `DEV${i}`,
            accessToken: `tok-${i}`,
          },
          { setActive: i === 21 }
        );
      }

      startDesktopMediaAuth(getActiveSession, trackedSubscribe);
      // Calling startDesktopMediaAuth a second time is a no-op.
      startDesktopMediaAuth(getActiveSession, trackedSubscribe);
      expect(calls).toEqual([{ baseUrl: 'https://hs-1.example', accessToken: 'tok-21' }]);
      expect(desktopMediaAuthReady()).toBe(false);

      pending.shift()!.resolve({ ok: true, value: undefined });
      await flushMicrotasks();
      expect(desktopMediaAuthReady()).toBe(true);
      expect(notifications).toHaveBeenCalledTimes(1);

      // Unrelated metadata write does not re-push or flicker readiness.
      const session21Id = `${encodeURIComponent('https://hs-1.example')}::${encodeURIComponent(
        '@user21:example'
      )}`;
      updateSessionLastPath(session21Id, '/home');
      expect(calls).toHaveLength(1);
      expect(desktopMediaAuthReady()).toBe(true);

      // Switch to account 5 (on hs-3.example): readiness drops until acked.
      const session5Id = `${encodeURIComponent('https://hs-3.example')}::${encodeURIComponent(
        '@user5:example'
      )}`;
      setActiveSession(session5Id);
      expect(calls[calls.length - 1]).toEqual({
        baseUrl: 'https://hs-3.example',
        accessToken: 'tok-5',
      });
      expect(desktopMediaAuthReady()).toBe(false);

      pending.shift()!.resolve({ ok: true, value: undefined });
      await flushMicrotasks();
      expect(desktopMediaAuthReady()).toBe(true);

      // Token refresh on active account: readiness is false between new token and ack.
      updateSessionCredentials(session5Id, { accessToken: 'tok-5-refreshed' });
      expect(calls[calls.length - 1]).toEqual({
        baseUrl: 'https://hs-3.example',
        accessToken: 'tok-5-refreshed',
      });
      expect(desktopMediaAuthReady()).toBe(false);

      pending.shift()!.resolve({ ok: true, value: undefined });
      await flushMicrotasks();
      expect(desktopMediaAuthReady()).toBe(true);

      // Remove all accounts until signed out: clears main session and leaves ready false.
      for (let i = 1; i <= 21; i += 1) {
        const base = `https://hs-${(i % 3) + 1}.example`;
        const id = `${encodeURIComponent(base)}::${encodeURIComponent(`@user${i}:example`)}`;
        removeSession(id);
      }
      expect(calls[calls.length - 1]).toBeNull();
      expect(desktopMediaAuthReady()).toBe(false);

      while (pending.length > 0) {
        pending.shift()!.resolve({ ok: true, value: undefined });
      }
      await flushMicrotasks();
      expect(desktopMediaAuthReady()).toBe(false);
    } finally {
      stop();
    }
  });

  it('ignores stale acknowledgements and stays not-ready on rejected IPC results', async () => {
    const { desktopMediaAuthReady, startDesktopMediaAuth } = await import('./desktopMediaAuth');
    const { pending } = installBridge();

    putSession({
      baseUrl: 'https://hs.example',
      userId: '@alice:example',
      deviceId: 'D1',
      accessToken: 'tok-alice',
    });
    startDesktopMediaAuth(getActiveSession, trackedSubscribe);
    const first = pending.shift()!;

    putSession({
      baseUrl: 'https://hs.example',
      userId: '@bob:example',
      deviceId: 'D2',
      accessToken: 'tok-bob',
    });
    const second = pending.shift()!;

    // Stale ack for Alice must not mark Bob ready.
    first.resolve({ ok: true, value: undefined });
    await flushMicrotasks();
    expect(desktopMediaAuthReady()).toBe(false);

    // Failed ack for Bob must leave readiness false.
    second.resolve({ ok: false, code: 'BAD_ARGUMENTS' });
    await flushMicrotasks();
    expect(desktopMediaAuthReady()).toBe(false);
  });
});
