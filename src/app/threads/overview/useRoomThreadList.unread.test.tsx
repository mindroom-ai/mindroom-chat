// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  ClientEvent,
  createClient,
  MatrixEvent,
  ReceiptType,
  RelationType,
  Room,
  ThreadEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { SyncEngineProvider } from '../../event-store/engine/engineContext';
import { createSyncEngine } from '../../event-store/engine/syncEngine';
import { getThreadUnread } from '../../event-store/threads/roomThreadList';
import { keepSyncedEdits } from '../../matrix/client/syncedEdits';
import { useThreadOverviewRefreshCounter } from './threadOverviewRefreshCounter';
import { useRoomThreadList } from './useRoomThreadList';

vi.mock('../../event-store/threads/roomThreadList', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../event-store/threads/roomThreadList')>();
  return {
    ...actual,
    getThreadUnread: vi.fn(actual.getThreadUnread),
    loadRoomThreads: vi.fn(async () => undefined),
  };
});
vi.mock('../../event-store/cache/eventRepository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../event-store/cache/eventRepository')>()),
  loadCachedThreadRootsForRoom: vi.fn(async () => []),
}));

// A room event checks the unread mark of the thread it touches, not of every thread of the room.
const ROOM_ID = '!unread:example.org';
const ME = '@me:example.org';
const BOB = '@bob:example.org';
const IDS = ['$a', '$b', '$c'];

let mx: MatrixClient;
let room: Room;
const originalListSupport = Thread.hasServerSideListSupport;

const message = (id: string, ts: number, threadRootId?: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: BOB,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.text',
      body: id,
      ...(threadRootId
        ? { 'm.relates_to': { rel_type: RelationType.Thread, event_id: threadRootId } }
        : {}),
    },
  });

const addThread = (id: string) => {
  const root = message(id, 1000);
  room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
  room.createThread(id, root, [], false).addEvents([message(`${id}-reply`, 2000, id)], false);
};

/** Lets the threads announce what they changed, which they do after a few promises. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

/** The reader's receipt on `eventId`, in thread `threadId` or, without one, unthreaded. */
const receipt = (eventId: string, ts: number, threadId?: string) =>
  new MatrixEvent({
    type: 'm.receipt',
    room_id: ROOM_ID,
    content: {
      [eventId]: {
        [ReceiptType.Read]: { [ME]: { ts, ...(threadId ? { thread_id: threadId } : {}) } },
      },
    },
  });

/** The threads whose unread mark `change` checked, once the threads announced what it changed. */
const checkedBy = async (change: () => void) => {
  vi.mocked(getThreadUnread).mockClear();
  act(change);
  await settle();
  return [...new Set(vi.mocked(getThreadUnread).mock.calls.map(([thread]) => thread.id))].sort();
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  mx = createClient({ baseUrl: 'https://example.org', userId: ME });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  vi.spyOn(mx.http, 'authedRequest').mockResolvedValue({ chunk: [] });
  room = new Room(ROOM_ID, mx, ME);
  mx.store.storeRoom(room);
  // The room's thread list is in, so the room drops a thread that goes.
  Thread.hasServerSideListSupport = FeatureSupport.Stable;
  vi.spyOn(
    room as unknown as { fetchRoomThreadList: () => Promise<void> },
    'fetchRoomThreadList'
  ).mockResolvedValue();
  await room.fetchRoomThreads();
  IDS.forEach(addThread);
  await vi.advanceTimersByTimeAsync(0);
  // An old receipt in another thread: the reader's next thread receipts are not their oldest,
  // which would change how every thread reads.
  room.addReceipt(receipt('$old', 1, '$old'));
});

afterEach(() => {
  // A list of an earlier test would hear the store of kept edits, which every client shares.
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Thread.hasServerSideListSupport = originalListSupport;
});

const renderList = async () => {
  const engine = createSyncEngine({ mx });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MatrixClientProvider value={mx}>
      <SyncEngineProvider engine={engine}>{children}</SyncEngineProvider>
    </MatrixClientProvider>
  );
  const hook = renderHook(
    () => {
      const { overviewChanges, overviewRefreshCounter } = useThreadOverviewRefreshCounter(
        room,
        undefined
      );
      return useRoomThreadList(room, true, overviewChanges, overviewRefreshCounter);
    },
    { wrapper }
  );
  const unreads = () => hook.result.current.threadUnreads;
  expect(Object.fromEntries(unreads())).toEqual({ $a: true, $b: true, $c: true });
  // The listener marks the room when it starts, so the first count checks every thread again.
  expect(await checkedBy(() => room.addReceipt(receipt('$old', 1, '$old')))).toEqual(IDS);
  return unreads;
};

describe('useRoomThreadList unread marks', () => {
  it('checks only the thread a new reply is in', async () => {
    const unreads = await renderList();
    await checkedBy(() => room.addReceipt(receipt('$a-reply', 2000, '$a')));
    expect(unreads().get('$a')).toBe(false);

    expect(
      await checkedBy(() =>
        room.getThread('$a')!.addEvents([message('$a-reply2', 3000, '$a')], false)
      )
    ).toEqual(['$a']);
    expect(Object.fromEntries(unreads())).toEqual({ $a: true, $b: true, $c: true });
  });

  it("checks the thread of the reader's thread receipt, and every thread for an unthreaded one", async () => {
    const unreads = await renderList();

    expect(await checkedBy(() => room.addReceipt(receipt('$a-reply', 2000, '$a')))).toEqual(['$a']);
    expect(Object.fromEntries(unreads())).toEqual({ $a: false, $b: true, $c: true });

    expect(await checkedBy(() => room.addReceipt(receipt('$b-reply', 2500)))).toEqual(IDS);
    expect(Object.fromEntries(unreads())).toEqual({ $a: false, $b: false, $c: false });
  });

  it("keeps the marks, and the map, on someone else's receipt", async () => {
    const unreads = await renderList();
    const before = unreads();
    const theirs = new MatrixEvent({
      type: 'm.receipt',
      room_id: ROOM_ID,
      content: { '$a-reply': { [ReceiptType.Read]: { [BOB]: { ts: 2000 } } } },
    });

    expect(await checkedBy(() => room.addReceipt(theirs))).toEqual([]);
    expect(unreads()).toBe(before);
  });

  it('checks a new thread, and drops a thread that goes', async () => {
    const unreads = await renderList();

    expect(await checkedBy(() => addThread('$d'))).toEqual(['$d']);
    expect(unreads().get('$d')).toBe(true);

    const gone = room.getThread('$b')!;
    expect(await checkedBy(() => gone.emit(ThreadEvent.Delete, gone))).toEqual([]);
    expect([...unreads().keys()].sort()).toEqual(['$a', '$c', '$d']);
  });

  it('checks the thread of a reply whose kept edits a full store drops, which no event tells of', async () => {
    const stop = keepSyncedEdits(mx);
    const editOf = (messageId: string, roomId: string) =>
      new MatrixEvent({
        event_id: `$edit-of-${messageId}`,
        room_id: roomId,
        sender: BOB,
        type: 'm.room.message',
        origin_server_ts: 3000,
        content: { 'm.relates_to': { rel_type: RelationType.Replace, event_id: messageId } },
      });
    await renderList();
    await checkedBy(() => mx.emit(ClientEvent.Event, editOf('$b-reply', ROOM_ID)));

    // The store keeps 5,000 messages: the edits of as many of another room push this one out.
    expect(
      await checkedBy(() => {
        for (let i = 0; i < 5000; i += 1) {
          mx.emit(ClientEvent.Event, editOf(`$other${i}`, '!other:example.org'));
        }
      })
    ).toEqual(['$b']);
    stop();
  });
});
