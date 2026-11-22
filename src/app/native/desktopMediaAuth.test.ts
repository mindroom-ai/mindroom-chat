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
  it('follows the active session across 21 stored accounts and drops ready until ack on refresh, switch, and logout', async () => {
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

      // Same-account token refresh drops readiness to false until main acks the new token.
      updateSessionCredentials(session21Id, { accessToken: 'tok-21-refreshed' });
      expect(calls[calls.length - 1]).toEqual({
        baseUrl: 'https://hs-1.example',
        accessToken: 'tok-21-refreshed',
      });
      expect(desktopMediaAuthReady()).toBe(false);
      expect(notifications).toHaveBeenCalledTimes(2);

      pending.shift()!.resolve({ ok: true, value: undefined });
      await flushMicrotasks();
      expect(desktopMediaAuthReady()).toBe(true);

      // Switch to another account on the SAME homeserver (user 18 is also on hs-1.example): drops ready until ack.
      const session18Id = `${encodeURIComponent('https://hs-1.example')}::${encodeURIComponent(
        '@user18:example'
      )}`;
      setActiveSession(session18Id);
      expect(calls[calls.length - 1]).toEqual({
        baseUrl: 'https://hs-1.example',
        accessToken: 'tok-18',
      });
      expect(desktopMediaAuthReady()).toBe(false);

      pending.shift()!.resolve({ ok: true, value: undefined });
      await flushMicrotasks();
      expect(desktopMediaAuthReady()).toBe(true);

      // Switch to account 5 (on hs-3.example): drops ready until ack.
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

  it('retries a failed push once, ignores stale acks, and drops ready if the retry also fails', async () => {
    const { desktopMediaAuthReady, startDesktopMediaAuth } = await import('./desktopMediaAuth');
    const { pending, calls } = installBridge();

    putSession({
      baseUrl: 'https://hs.example',
      userId: '@alice:example',
      deviceId: 'D1',
      accessToken: 'tok-alice',
    });
    startDesktopMediaAuth(getActiveSession, trackedSubscribe);
    const aliceFirst = pending.shift()!;

    // First failure retries once automatically and becomes ready on retry success.
    aliceFirst.resolve({ ok: false, code: 'INTERNAL_ERROR' });
    await flushMicrotasks();
    expect(calls).toHaveLength(2);
    expect(desktopMediaAuthReady()).toBe(false);

    pending.shift()!.resolve({ ok: true, value: undefined });
    await flushMicrotasks();
    expect(desktopMediaAuthReady()).toBe(true);

    // Switch to Bob, then switch to Carol before Bob resolves: stale Bob ack is ignored.
    putSession({
      baseUrl: 'https://hs.example',
      userId: '@bob:example',
      deviceId: 'D2',
      accessToken: 'tok-bob',
    });
    const bobPush = pending.shift()!;
    putSession({
      baseUrl: 'https://hs.example',
      userId: '@carol:example',
      deviceId: 'D3',
      accessToken: 'tok-carol',
    });
    const carolFirst = pending.shift()!;

    bobPush.resolve({ ok: true, value: undefined });
    await flushMicrotasks();
    expect(desktopMediaAuthReady()).toBe(false);

    // Double failure for Carol stops after one retry and leaves readiness false.
    const callsBeforeCarolFail = calls.length;
    carolFirst.resolve({ ok: false, code: 'BAD_ARGUMENTS' });
    await flushMicrotasks();
    expect(calls).toHaveLength(callsBeforeCarolFail + 1);
    pending.shift()!.resolve({ ok: false, code: 'BAD_ARGUMENTS' });
    await flushMicrotasks();
    expect(calls).toHaveLength(callsBeforeCarolFail + 1);
    expect(desktopMediaAuthReady()).toBe(false);
  });
});
