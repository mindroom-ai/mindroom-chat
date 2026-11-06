// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ME = '@me:example.org';

type Tab = typeof import('./notifiedOnce');

/** A fresh copy of the module: what another tab of the browser runs. */
const openTab = async (): Promise<Tab> => {
  vi.resetModules();
  return import('./notifiedOnce');
};

/** Web Locks for every tab of this test: one holder per name, `ifAvailable` loses to it. */
const fakeLocks = () => {
  const held = new Set<string>();
  return {
    request: async (
      name: string,
      options: { ifAvailable?: boolean },
      callback: (lock: { name: string } | null) => unknown
    ) => {
      if (held.has(name)) {
        if (options.ifAvailable) return callback(null);
        throw new Error('the fake only grants free locks');
      }
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
};

/** Each `raiseOnce` call of `tab`, and what it raised. */
const raised = (tab: Tab, ids: string[], keepMs?: number) => {
  const raise = vi.fn<(claimed: string[]) => void>();
  tab.raiseOnce(ME, ids, raise, keepMs);
  return raise;
};

describe('raiseOnce', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('raises each notification once on this device, across reloads, until it expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const tab = await openTab();
    expect(raised(tab, ['$a', '$b'])).toHaveBeenCalledWith(['$a', '$b']);
    expect(raised(tab, ['$a'])).not.toHaveBeenCalled();
    expect(raised(tab, ['$a', '$c'])).toHaveBeenCalledWith(['$c']);

    const reloaded = await openTab();
    expect(raised(reloaded, ['$b'])).not.toHaveBeenCalled();
    expect(raised(reloaded, ['invite:!room'], 60_000)).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_001);
    expect(raised(reloaded, ['invite:!room'], 60_000)).toHaveBeenCalledOnce();
    expect(raised(reloaded, ['$b'])).not.toHaveBeenCalled();

    // Another account on this device has its own record; signing out forgets it.
    const other = vi.fn();
    reloaded.raiseOnce('@other:example.org', ['$b'], other);
    expect(other).toHaveBeenCalledOnce();
    reloaded.clearNotified(ME);
    expect(raised(await openTab(), ['$b'])).toHaveBeenCalledOnce();
  });

  it('lets one tab raise a notification every tab hears of at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.stubGlobal('navigator', { locks: fakeLocks() });
    const first = await openTab();
    const second = await openTab();

    const firstRaise = raised(first, ['$news']);
    // The second tab's copy of localStorage has not caught up with the first tab's claim yet.
    const stored = new Map<string, string>();
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) stored.set(key, localStorage.getItem(key) ?? '');
    }
    localStorage.clear();
    const secondRaise = raised(second, ['$news']);
    await vi.waitFor(() => expect(firstRaise).toHaveBeenCalledWith(['$news']));
    await Promise.resolve();
    expect(secondRaise).not.toHaveBeenCalled();

    // Once the claim's lock is free, the record is what keeps a late tab quiet.
    stored.forEach((value, key) => localStorage.setItem(key, value));
    await vi.advanceTimersByTimeAsync(10_000);
    const lateRaise = raised(await openTab(), ['$news']);
    await vi.advanceTimersByTimeAsync(0);
    expect(lateRaise).not.toHaveBeenCalled();
    const freshRaise = raised(await openTab(), ['$fresh']);
    await vi.waitFor(() => expect(freshRaise).toHaveBeenCalledWith(['$fresh']));
  });
});
