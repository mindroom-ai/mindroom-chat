import { IEventWithRoomId, MatrixClient, MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearThreadSummarySharedState,
  getThreadSummaryStateSnapshot,
} from '../event-store/threads/threadSummaryState';
import {
  fetchSearchHitThread,
  getSearchResultOpenTarget,
  resolveSearchThreadTitle,
  resolveSyncSearchHitThread,
} from './searchResultOpenTarget';

vi.mock('../event-store/cache/db', () => ({
  loadCachedThreadSummaries: vi.fn().mockResolvedValue(new Map()),
  saveCachedThreadSummary: vi.fn().mockResolvedValue(undefined),
}));

const ROOM = '!ops:example.org';
const ROOT = '$thread-root';
const BASE = { room_id: ROOM, sender: '@a:e', origin_server_ts: 1000, type: 'm.room.message' };
const THREAD_REL = { 'm.relates_to': { rel_type: RelationType.Thread, event_id: ROOT } };
const ev = (id: string, content = {}, unsigned?: Record<string, unknown>): IEventWithRoomId => ({
  ...BASE,
  event_id: id,
  content,
  ...(unsigned && { unsigned }),
});
const titleOf = (summary: string) => ({
  msgtype: 'm.notice',
  body: summary,
  'io.mindroom.thread_summary': { version: 1, summary },
  ...THREAD_REL,
});
const bundled = (id: string, s: string, ts: number) => ({
  'm.relations': {
    'm.thread': { 'io.mindroom.title': { ...ev(id, titleOf(s)), origin_server_ts: ts } },
  },
});
const mkRoom = (loaded: Record<string, unknown> = {}) =>
  ({
    roomId: ROOM,
    hasEncryptionStateEvent: () => false,
    findEventById: (id: string) => loaded[id],
    getThread: () => undefined,
  }) as unknown as Room;

afterEach(() => clearThreadSummarySharedState());

describe('getSearchResultOpenTarget', () => {
  it('returns the event id for a room-level message', () => {
    expect(
      getSearchResultOpenTarget({
        event_id: '$room-message',
        content: {},
      })
    ).toEqual({
      mainEventId: '$room-message',
      threadRootId: undefined,
    });
  });

  it('returns the thread root for a threaded reply', () => {
    expect(
      getSearchResultOpenTarget({
        event_id: '$thread-reply',
        content: {
          'm.relates_to': {
            rel_type: RelationType.Thread,
            event_id: '$thread-root',
          },
        },
      })
    ).toEqual({
      mainEventId: '$thread-reply',
      threadRootId: '$thread-root',
    });
  });

  it('marks a thread title notice, by its shape, as opening its thread', () => {
    const notice = (content: Record<string, unknown>) =>
      getSearchResultOpenTarget({
        event_id: '$title',
        content: {
          msgtype: 'm.notice',
          body: 'Launch roadmap',
          'm.relates_to': { rel_type: RelationType.Thread, event_id: '$thread-root' },
          ...content,
        },
      }).threadTitle;
    expect(
      notice({ 'io.mindroom.thread_summary': { version: 1, summary: 'Launch roadmap' } })
    ).toBe(true);
    // The same words as a plain notice or a message are no title.
    expect(notice({})).toBeUndefined();
    expect(
      notice({ msgtype: 'm.text', 'io.mindroom.thread_summary': { version: 1 } })
    ).toBeUndefined();
  });

  it('keeps replacement targets and does not infer a thread root from edits', () => {
    expect(
      getSearchResultOpenTarget({
        event_id: '$edit-event',
        content: {
          'm.relates_to': {
            rel_type: RelationType.Replace,
            event_id: '$edited-message',
          },
        },
      })
    ).toEqual({
      mainEventId: '$edited-message',
      threadRootId: undefined,
    });
  });

  it('returns no thread root for a thread root event itself', () => {
    expect(
      getSearchResultOpenTarget({
        event_id: '$thread-root',
        content: {},
      })
    ).toEqual({ mainEventId: '$thread-root', threadRootId: undefined });
  });

  it('does not infer thread root from an edit of a threaded message', () => {
    expect(
      getSearchResultOpenTarget({
        event_id: '$edit-of-thread-reply',
        content: {
          'm.relates_to': {
            rel_type: RelationType.Replace,
            event_id: '$thread-reply',
          },
        },
      })
    ).toEqual({ mainEventId: '$thread-reply', threadRootId: undefined });
  });
});

describe('search hit thread resolution', () => {
  const sync = (e: IEventWithRoomId, r: Room | null = null, known = false) =>
    resolveSyncSearchHitThread(e, getSearchResultOpenTarget(e), r, known);
  const edit = (target: string) =>
    ev('$e', { 'm.relates_to': { rel_type: RelationType.Replace, event_id: target } });

  it('resolveSyncSearchHitThread resolves replies, roots, loaded edits, and unloaded edits', () => {
    expect(sync(ev('$r', THREAD_REL))).toEqual({ threadRootId: ROOT, isThreadTitle: undefined });
    expect(sync(ev(ROOT, {}, bundled('$t1', 'Title', 2000)))).toEqual({ threadRootId: ROOT });
    expect(sync(ev('$plain'))).toEqual({});
    expect(sync(ev('$plain'), null, true)).toEqual({ threadRootId: '$plain' });
    const room = mkRoom({
      $title: new MatrixEvent(ev('$title', titleOf('Title'))),
      $plain: new MatrixEvent(ev('$plain')),
    });
    expect(sync(edit('$title'), room)).toEqual({ threadRootId: ROOT, isThreadTitle: true });
    expect(sync(edit('$plain'), room)).toEqual({});
    expect(sync(edit('$missing'), room)).toEqual({ needsFetch: true });
    expect(sync(edit('$missing'), room, true)).toEqual({ threadRootId: '$missing' });
  });

  it('fetchSearchHitThread checks room first, stores bundled titles, and propagates errors', async () => {
    const fetchRoomEvent = vi.fn();
    const room = mkRoom({ $loaded: new MatrixEvent(ev('$loaded', THREAD_REL)) });
    const client = { getRoom: () => room, fetchRoomEvent } as unknown as MatrixClient;
    const run = (id: string, s?: string) => fetchSearchHitThread(client, ROOM, id, s);
    expect(await run('$loaded')).toEqual({ threadRootId: ROOT });
    expect(fetchRoomEvent).not.toHaveBeenCalled();

    fetchRoomEvent.mockResolvedValueOnce(ev('$reply', THREAD_REL));
    expect(await run('$reply')).toEqual({ threadRootId: ROOT });
    fetchRoomEvent.mockResolvedValueOnce(ev('$title', titleOf('Plan')));
    expect(await run('$title')).toEqual({ threadRootId: ROOT, threadTitle: true });
    fetchRoomEvent.mockResolvedValueOnce(ev(ROOT, {}, bundled('$t2', 'Bundled', 5000)));
    expect(await run(ROOT, 's1')).toEqual({ threadRootId: ROOT });
    expect(getThreadSummaryStateSnapshot('s1', ROOM).get(ROOT)?.summaryText).toBe('Bundled');
    fetchRoomEvent.mockResolvedValueOnce(ev('$solo'));
    expect(await run('$solo')).toBeNull();
    fetchRoomEvent.mockRejectedValueOnce(new Error('503'));
    await expect(run('$err')).rejects.toThrow('503');
  });

  it('resolveSearchThreadTitle compares index, cache, localRoot, and hit bundles chronologically', () => {
    const hit = ev(ROOT, {}, bundled('$s2', 'Newer hit', 5000));
    const cache = new Map([[ROOT, { summaryText: 'Older cache', eventTs: 2000 }]]);
    const loc = (ts: number, s: string) =>
      mkRoom({ [ROOT]: new MatrixEvent(ev(ROOT, {}, bundled('$loc', s, ts))) });
    expect(resolveSearchThreadTitle(loc(1000, 'Old'), hit, ROOT, cache)).toBe('Newer hit');
    expect(resolveSearchThreadTitle(loc(9000, 'New'), hit, ROOT, cache)).toBe('New');
    const idx = { summaryText: 'Index latest', eventTs: 20_000 };
    expect(resolveSearchThreadTitle(loc(9000, 'New'), hit, ROOT, cache, idx)).toBe('Index latest');
  });
});
