import {
  createClient,
  MatrixEvent,
  SyncState,
  type IEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { _createAndReEmitRoom } from 'matrix-js-sdk/lib/sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncEngine } from '../syncEngine';
import type { EngineWriteThrough } from '../engineWriteThrough';
import type { EngineGapTracker } from '../engineGapTracker';
import type { EnginePersistFacade } from '../enginePersistFacade';
import { loadRoomThreads } from '../../threads/roomThreadList';

// A thread the app has not opened or shown keeps its replies' edits out of every timeline, so the
// engine's timeline write-through never sees them. They must still reach the thread's cache: once
// a newer event (an agent's title notice) takes the reply's place in the thread's summary, a
// Compact card reads the reply from the cache.

const roomId = '!room:example.org';
const agentId = '@agent:example.org';
const rootId = '$root';
const replyId = '$reply';

const message = (eventId: string, ts: number, content: Record<string, unknown>): IEvent =>
  ({
    event_id: eventId,
    room_id: roomId,
    sender: agentId,
    type: 'm.room.message',
    origin_server_ts: ts,
    unsigned: {},
    content: { msgtype: 'm.text', ...content },
  } as IEvent);
const inThread = { 'm.relates_to': { rel_type: 'm.thread', event_id: rootId } };
const edit = (eventId: string, ts: number, body: string) =>
  new MatrixEvent(
    message(eventId, ts, {
      body: `* ${body}`,
      'm.new_content': { msgtype: 'm.text', body },
      'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
    })
  );

const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

/** A real client and room whose one thread is listed with its pending reply as the summary. */
const roomWithListedThread = () => {
  const root: IEvent = {
    ...message(rootId, 10, { body: 'Which fixes go into the release notes?' }),
    unsigned: {
      'm.relations': {
        'm.thread': {
          count: 1,
          current_user_participated: false,
          latest_event: message(replyId, 11, { body: 'Thinking...', ...inThread }),
        },
      },
    },
  };
  const client: MatrixClient = createClient({
    baseUrl: 'https://example.org',
    userId: '@reader:example.org',
    accessToken: 'token',
    timelineSupport: true,
    fetchFn: async (input) => {
      const url = new URL(String(input));
      if (decodeURIComponent(url.pathname).endsWith('/threads'))
        return new Response(JSON.stringify({ chunk: [root] }), {
          headers: { 'Content-Type': 'application/json' },
        });
      throw new Error(`Unexpected request ${url.pathname}`);
    },
  });
  vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
  vi.spyOn(client, 'getSyncState').mockReturnValue(SyncState.Syncing);
  const room = _createAndReEmitRoom(client, roomId, {});
  room.setMaxListeners(0);
  client.store.storeRoom(room);
  return { client, room };
};

describe('edits in a thread the app has not opened', () => {
  let support: [FeatureSupport, FeatureSupport, FeatureSupport];
  beforeEach(() => {
    support = [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ];
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    Thread.hasServerSideListSupport = FeatureSupport.Stable;
    Thread.hasServerSideFwdPaginationSupport = FeatureSupport.Stable;
  });
  afterEach(() => {
    [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ] = support;
    vi.restoreAllMocks();
  });

  it("reach the thread's cache, each once, while the thread stays unopened", async () => {
    const { client, room } = roomWithListedThread();
    await loadRoomThreads(room);
    await settle();
    const writeThrough: EngineWriteThrough = { handleLiveEvent: vi.fn(), flush: vi.fn() };
    const gapTracker = {
      handleTimelineReset: vi.fn(),
      handleSyncPrepared: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    } as unknown as EngineGapTracker;
    const persistThreadEventCache = vi.fn();
    const persist = { persistThreadEventCache } as unknown as EnginePersistFacade;
    const engine = createSyncEngine({ mx: client, writeThrough, gapTracker, persist });
    engine.start();
    const thread = room.getThread(rootId)!;
    expect(thread.initialEventsFetched).toBe(false);

    // The reply streams and finishes, then the agent titles the thread.
    await room.addLiveEvents([edit('$step', 20, 'Checking the merged changes.')], {
      addToState: false,
    });
    await settle();
    await room.addLiveEvents(
      [
        edit('$final', 30, 'The notes list the export fix.'),
        new MatrixEvent(message('$title', 31, { msgtype: 'm.notice', body: 'Notes', ...inThread })),
      ],
      { addToState: false }
    );
    await settle();

    const saved = persistThreadEventCache.mock.calls.flatMap(([savedRoom, threadId, events]) =>
      (events as MatrixEvent[]).map((event) => [savedRoom === room, threadId, event.getId()])
    );
    expect(saved).toEqual([
      [true, rootId, '$step'],
      [true, rootId, '$final'],
    ]);
    engine.stop();
  });
});
