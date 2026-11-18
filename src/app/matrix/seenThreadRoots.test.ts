import { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The roots a user opened while other messages in the main timeline were unread stay read on this
// device, also after a reload, until the user's receipts read them.
const ME = '@me:example.org';
const ROOM = '!room:example.org';

const root = (eventId: string, ts: number) =>
  new MatrixEvent({
    content: { body: eventId, msgtype: 'm.text' },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: ROOM,
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.resetModules();
});

afterEach(() => vi.unstubAllGlobals());

const load = () => import('./seenThreadRoots');

describe('seen thread roots', () => {
  it('remembers a root per account and room, also after a reload', async () => {
    const store = await load();
    store.rememberSeenThreadRoot(ME, ROOM, root('$root', 5000), 2000);
    expect(store.isSeenThreadRoot(ME, ROOM, '$root')).toBe(true);
    expect(store.isSeenThreadRoot('@bob:example.org', ROOM, '$root')).toBe(false);
    expect(store.isSeenThreadRoot(ME, '!other:example.org', '$root')).toBe(false);

    vi.resetModules();
    const reloaded = await load();
    expect(reloaded.isSeenThreadRoot(ME, ROOM, '$root')).toBe(true);
    expect(reloaded.countSeenThreadRootsAfter(ME, ROOM, 2000)).toBe(1);
  });

  it('forgets the roots that receipts have read since', async () => {
    const store = await load();
    store.rememberSeenThreadRoot(ME, ROOM, root('$early', 3000), 2000);
    store.rememberSeenThreadRoot(ME, ROOM, root('$late', 5000), 2000);
    store.forgetReadThreadRoots(ME, ROOM, 4000);
    expect(store.isSeenThreadRoot(ME, ROOM, '$early')).toBe(false);
    expect(store.isSeenThreadRoot(ME, ROOM, '$late')).toBe(true);

    store.forgetReadThreadRoots(ME, ROOM, 6000);
    expect(store.isSeenThreadRoot(ME, ROOM, '$late')).toBe(false);
    // A room with nothing left keeps no record.
    expect([...values.values()].join('')).not.toContain(ROOM);
  });

  it("keeps another tab's roots when it records one of its own", async () => {
    const first = await load();
    vi.resetModules();
    const second = await load();
    first.rememberSeenThreadRoot(ME, ROOM, root('$first', 5000), 2000);
    second.rememberSeenThreadRoot(ME, ROOM, root('$second', 6000), 2000);

    vi.resetModules();
    const reloaded = await load();
    expect(reloaded.isSeenThreadRoot(ME, ROOM, '$first')).toBe(true);
    expect(reloaded.isSeenThreadRoot(ME, ROOM, '$second')).toBe(true);
  });

  it('tells its listeners the room of each change, with no event of the room', async () => {
    const seen = await load();
    const told: string[] = [];
    const stop = seen.onSeenThreadRootsChange((roomId) => told.push(roomId));

    seen.rememberSeenThreadRoot(ME, ROOM, root('$a', 10), 0);
    seen.forgetReadThreadRoots(ME, ROOM, 20);
    // Nothing is recorded for this room, so nothing changes.
    seen.forgetReadThreadRoots(ME, '!other:example.org', 20);
    expect(told).toEqual([ROOM, ROOM]);

    stop();
    seen.rememberSeenThreadRoot(ME, ROOM, root('$b', 30), 0);
    expect(told).toEqual([ROOM, ROOM]);
  });

  describe("another tab's write", () => {
    const key = `mindroom.seenThreadRoots:${encodeURIComponent(ME)}`;
    const OTHER_ROOM = '!other:example.org';
    /** The write of another tab, and the event this tab gets of it. */
    const otherTabWrites = (
      page: EventTarget,
      record: object | undefined,
      eventKey: string | null = key
    ) => {
      if (record) values.set(key, JSON.stringify(record));
      else values.delete(key);
      const newValue = values.get(key) ?? null;
      page.dispatchEvent(Object.assign(new Event('storage'), { key: eventKey, newValue }));
    };
    const loadInPage = async () => {
      const page = new EventTarget();
      vi.stubGlobal('window', page);
      return { page, seen: await load() };
    };

    it('reaches what this tab read, its version and its listeners', async () => {
      const { page, seen } = await loadInPage();
      seen.rememberSeenThreadRoot(ME, ROOM, root('$mine', 10), 0);
      const told: string[] = [];
      seen.onSeenThreadRootsChange((roomId) => told.push(roomId));
      const version = seen.seenThreadRootsVersion();

      otherTabWrites(page, { [ROOM]: { $mine: 10, $theirs: 20 }, [OTHER_ROOM]: { $far: 30 } });

      expect(seen.isSeenThreadRoot(ME, ROOM, '$theirs')).toBe(true);
      expect(seen.isSeenThreadRoot(ME, OTHER_ROOM, '$far')).toBe(true);
      expect(seen.seenThreadRootsVersion()).toBeGreaterThan(version);
      expect(told.sort()).toEqual([OTHER_ROOM, ROOM].sort());

      // Only the room whose record changed is told of.
      told.length = 0;
      otherTabWrites(page, { [ROOM]: { $mine: 10, $theirs: 20 } });
      expect(told).toEqual([OTHER_ROOM]);
      expect(seen.isSeenThreadRoot(ME, OTHER_ROOM, '$far')).toBe(false);
    });

    it('forgets what the other tab removed: a sign-out there, or all of the storage cleared', async () => {
      const { page, seen } = await loadInPage();
      seen.rememberSeenThreadRoot(ME, ROOM, root('$mine', 10), 0);

      otherTabWrites(page, undefined);
      expect(seen.isSeenThreadRoot(ME, ROOM, '$mine')).toBe(false);

      seen.rememberSeenThreadRoot(ME, ROOM, root('$again', 10), 0);
      const told: string[] = [];
      seen.onSeenThreadRootsChange((roomId) => told.push(roomId));
      // `localStorage.clear()` names no key.
      otherTabWrites(page, undefined, null);
      expect(seen.isSeenThreadRoot(ME, ROOM, '$again')).toBe(false);
      expect(told).toEqual([ROOM]);
    });

    it("tells nothing for another key's write, or one that changes no record", async () => {
      const { page, seen } = await loadInPage();
      seen.rememberSeenThreadRoot(ME, ROOM, root('$mine', 10), 0);
      const told: string[] = [];
      seen.onSeenThreadRootsChange((roomId) => told.push(roomId));
      const version = seen.seenThreadRootsVersion();

      otherTabWrites(page, { [ROOM]: { $mine: 10 } });
      page.dispatchEvent(
        Object.assign(new Event('storage'), {
          key: 'mindroom.somethingElse',
          newValue: JSON.stringify({ [ROOM]: { $else: 5 } }),
        })
      );

      expect(told).toEqual([]);
      expect(seen.seenThreadRootsVersion()).toBe(version);
      expect(seen.isSeenThreadRoot(ME, ROOM, '$mine')).toBe(true);
    });
  });

  it('forgets everything of an account that signs out', async () => {
    const store = await load();
    store.rememberSeenThreadRoot(ME, ROOM, root('$root', 5000), 2000);
    store.clearSeenThreadRoots(ME);
    expect(store.isSeenThreadRoot(ME, ROOM, '$root')).toBe(false);
    expect(values.size).toBe(0);
  });
});
