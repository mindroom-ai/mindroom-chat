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

  it('forgets everything of an account that signs out', async () => {
    const store = await load();
    store.rememberSeenThreadRoot(ME, ROOM, root('$root', 5000), 2000);
    store.clearSeenThreadRoots(ME);
    expect(store.isSeenThreadRoot(ME, ROOM, '$root')).toBe(false);
    expect(values.size).toBe(0);
  });
});
