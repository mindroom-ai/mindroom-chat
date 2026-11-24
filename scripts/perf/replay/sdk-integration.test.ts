import {
  ClientEvent,
  createClient,
  Direction,
  MemoryStore,
  RelationType,
  SyncState,
  type IEvent,
  type MatrixClient,
  type MatrixEvent,
} from 'matrix-js-sdk';
import type { ISavedSync } from 'matrix-js-sdk/lib/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startReplayServer } from './server.mjs';

const VIEWER = '@viewer:example.test';
const AGENT = '@mindroom_agent:example.test';
const ROOM_ID = '!room:example.test';
const BASE_TS = 1_760_000_000_000;
const SID_RE = /^\d{13}-[0-9a-f]{8}$/;

const buildFixtureBundle = () => {
  const rootEvent = {
    type: 'm.room.message',
    event_id: '$root1',
    room_id: ROOM_ID,
    sender: VIEWER,
    origin_server_ts: BASE_TS - 30_000,
    content: { msgtype: 'm.text', body: 'Thread root' },
    unsigned: {
      'm.relations': {
        'm.thread': {
          count: 2,
          current_user_participated: true,
          latest_event: {
            type: 'm.room.message',
            event_id: '$rep2',
            room_id: ROOM_ID,
            sender: AGENT,
            origin_server_ts: BASE_TS - 10_000,
            content: { msgtype: 'm.text', body: 'Second thread reply' },
          },
          'io.mindroom.latest_reply': {
            type: 'm.room.message',
            event_id: '$rep2',
            room_id: ROOM_ID,
            sender: AGENT,
            origin_server_ts: BASE_TS - 10_000,
            content: { msgtype: 'm.text', body: 'Second thread reply' },
          },
          'io.mindroom.title': {
            type: 'm.room.message',
            event_id: '$title1',
            room_id: ROOM_ID,
            sender: AGENT,
            origin_server_ts: BASE_TS - 15_000,
            content: {
              msgtype: 'm.notice',
              body: 'Thread Summary',
              'io.mindroom.thread_summary': { summary: 'Thread Summary', version: 1 },
            },
          },
        },
      },
    },
  };
  const rep1 = {
    type: 'm.room.message',
    event_id: '$rep1',
    room_id: ROOM_ID,
    sender: AGENT,
    origin_server_ts: BASE_TS - 20_000,
    content: {
      msgtype: 'm.text',
      body: 'First thread reply',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: '$root1',
        'm.in_reply_to': { event_id: '$root1' },
      },
    },
  };
  const rep2 = {
    type: 'm.room.message',
    event_id: '$rep2',
    room_id: ROOM_ID,
    sender: AGENT,
    origin_server_ts: BASE_TS - 10_000,
    content: {
      msgtype: 'm.text',
      body: 'Second thread reply',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: '$root1',
        'm.in_reply_to': { event_id: '$rep1' },
      },
    },
  };
  const older1 = {
    type: 'm.room.message',
    event_id: '$old1',
    room_id: ROOM_ID,
    sender: VIEWER,
    origin_server_ts: BASE_TS - 120_000,
    content: { msgtype: 'm.text', body: 'Older room message 1' },
  };
  const older2 = {
    type: 'm.room.message',
    event_id: '$old2',
    room_id: ROOM_ID,
    sender: VIEWER,
    origin_server_ts: BASE_TS - 110_000,
    content: { msgtype: 'm.text', body: 'Older room message 2' },
  };
  const state = [
    {
      type: 'm.room.create',
      event_id: '$st_create',
      room_id: ROOM_ID,
      sender: AGENT,
      state_key: '',
      origin_server_ts: BASE_TS - 500_000,
      content: { room_version: '11', creator: AGENT },
    },
    {
      type: 'm.room.name',
      event_id: '$st_name',
      room_id: ROOM_ID,
      sender: AGENT,
      state_key: '',
      origin_server_ts: BASE_TS - 499_000,
      content: { name: 'SDK Replay Room' },
    },
    {
      type: 'm.room.member',
      event_id: '$st_viewer',
      room_id: ROOM_ID,
      sender: VIEWER,
      state_key: VIEWER,
      origin_server_ts: BASE_TS - 498_000,
      content: { membership: 'join', displayname: 'Viewer' },
    },
    {
      type: 'm.room.member',
      event_id: '$st_agent',
      room_id: ROOM_ID,
      sender: AGENT,
      state_key: AGENT,
      origin_server_ts: BASE_TS - 497_000,
      content: { membership: 'join', displayname: 'Agent' },
    },
  ];
  const liveEntries = [
    {
      tauMs: 500,
      response: {
        rooms: {
          join: {
            [ROOM_ID]: {
              timeline: {
                events: [
                  {
                    type: 'm.room.message',
                    event_id: '$live1',
                    room_id: ROOM_ID,
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 500,
                    content: {
                      msgtype: 'm.text',
                      body: 'Streaming reply',
                      'io.mindroom.stream_status': 'streaming',
                      'm.relates_to': {
                        rel_type: 'm.thread',
                        event_id: '$root1',
                        'm.in_reply_to': { event_id: '$rep2' },
                      },
                    },
                  },
                ],
              },
              ephemeral: {
                events: [
                  {
                    type: 'io.mindroom.live',
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 500,
                    content: {
                      v: 1,
                      reply: '$live1',
                      sid: '1760000000500-aabbccdd',
                      seq: 0,
                      snapshot: {
                        md: 'Streaming reply',
                        reasoning: '',
                        tools: [],
                        status: 'streaming',
                        activity: 'Working',
                        segments: [],
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
    {
      tauMs: 2_000,
      response: {
        rooms: {
          join: {
            [ROOM_ID]: {
              ephemeral: {
                events: [
                  {
                    type: 'io.mindroom.live',
                    sender: AGENT,
                    origin_server_ts: BASE_TS + 2_000,
                    content: {
                      v: 1,
                      reply: '$live1',
                      sid: '1760000000500-aabbccdd',
                      seq: 1,
                      delta: {
                        md: { at: 15, del: 0, ins: ' updated', len: 23 },
                        status: 'streaming',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  ];
  return {
    manifest: {
      version: 1,
      capturedAtMs: BASE_TS,
      userId: VIEWER,
      viewerDomain: 'example.test',
      primaryRoomId: ROOM_ID,
      primaryRoomName: 'SDK Replay Room',
      focusedRoomIds: [ROOM_ID],
      durationMs: 3_000,
      blobIndex: {},
    },
    snapshot: {
      initialSync: {
        next_batch: 'b0',
        account_data: { events: [] },
        rooms: {
          join: {
            [ROOM_ID]: {
              state: { events: state },
              timeline: { events: [rootEvent, rep1, rep2], limited: true, prev_batch: 'pb0' },
              ephemeral: { events: [] },
              account_data: { events: [] },
            },
          },
        },
      },
      rooms: {
        [ROOM_ID]: {
          threads: [rootEvent],
          threadRelations: { $root1: [rep2, rep1] },
          messagesTail: [older2, older1],
          members: state.filter((e) => e.type === 'm.room.member'),
        },
      },
    },
    liveEntries,
  };
};

describe('replay server integration with patched matrix-js-sdk', () => {
  const clients: MatrixClient[] = [];
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    clients.splice(0).forEach((client) => client.stopClient());
    await Promise.all(servers.splice(0).map((srv) => srv.close()));
  });

  it('syncs, fetches cloned threads & relations, paginates history, receives live frames, and catches up on warm restart', async () => {
    const srv = await startReplayServer({
      bundle: buildFixtureBundle(),
      port: 0,
      multiplyThreads: 3,
      multiplyRooms: 1,
      speed: 10,
    });
    servers.push(srv);

    const client = createClient({
      baseUrl: srv.baseUrl,
      userId: VIEWER,
      deviceId: 'SDK_TEST',
      accessToken: srv.accessToken,
      store: new MemoryStore(),
      timelineSupport: true,
    });
    clients.push(client);

    const liveFrames: MatrixEvent[] = [];
    client.on(ClientEvent.Event, (event) => {
      if (event.getType() === 'io.mindroom.live') liveFrames.push(event);
    });

    const prepared = new Promise<void>((resolve) => {
      const onSync = (state: SyncState) => {
        if (state === SyncState.Prepared) {
          client.removeListener(ClientEvent.Sync, onSync);
          resolve();
        }
      };
      client.on(ClientEvent.Sync, onSync);
    });

    await client.startClient({ threadSupport: true, initialSyncLimit: 2 });
    await prepared;

    const room = client.getRoom(ROOM_ID);
    if (!room) throw new Error('expected initial sync to populate primary room');
    expect(room.name).toBe('SDK Replay Room');

    // Fetch server-side thread list with Tuwunel bundled summaries for all 3 cloned threads
    await client.threadSupportPending;
    await room.createThreadsTimelineSets();
    await room.fetchRoomThreads();
    const threads = room.getThreads();
    expect(threads.length).toBeGreaterThanOrEqual(3);
    const rootIds = threads.map((thread) => thread.id);
    expect(rootIds).toContain('$root1');
    expect(rootIds).toContain('$root1__r0_k1');
    expect(rootIds).toContain('$root1__r0_k2');
    const mainThread = room.getThread('$root1');
    expect(mainThread?.rootEvent).toBeTruthy();
    expect(mainThread?.length ?? 0).toBeGreaterThanOrEqual(2);

    // Paginate room history backwards through /messages
    const liveTimeline = room.getLiveTimeline();
    const beforeCount = liveTimeline.getEvents().length;
    const paginated = await client.paginateEventTimeline(liveTimeline, {
      backwards: true,
      limit: 8,
    });
    expect(paginated).toBe(true);
    expect(liveTimeline.getEvents().length).toBeGreaterThan(beforeCount);

    // Fetch thread relations through /relations
    const rels = await client.fetchRelations(ROOM_ID, '$root1', RelationType.Thread, null, {
      dir: Direction.Backward,
      limit: 10,
    });
    const relIds = rels.chunk.map((ev) => ev.event_id);
    expect(relIds).toContain('$rep1');
    expect(relIds).toContain('$rep2');

    // Receive live io.mindroom.live ephemeral frames on the room
    await vi.waitFor(() => expect(liveFrames.length).toBeGreaterThan(0), { timeout: 5_000 });
    const firstLive = liveFrames[0];
    if (!firstLive) throw new Error('expected at least one io.mindroom.live frame');
    expect(firstLive.getRoomId()).toBe(ROOM_ID);
    expect(firstLive.getSender()).toBe(AGENT);
    const liveContent = firstLive.getContent();
    expect(liveContent.v).toBe(1);
    expect(String(liveContent.sid)).toMatch(SID_RE);

    // Warm restart with saved `since` catches up cleanly from incremental /sync
    const savedSince = client.store.getSyncToken();
    if (!savedSince) throw new Error('expected initial sync to record sync token');
    client.stopClient();

    await new Promise((resolve) => setTimeout(resolve, 250));

    const seenUrls: string[] = [];
    const warmStore = new MemoryStore();
    const savedSync: ISavedSync = {
      nextBatch: savedSince,
      accountData: [],
      roomsData: {
        join: {
          [ROOM_ID]: {
            state: {
              events: [
                {
                  type: 'm.room.member',
                  event_id: '$st_viewer',
                  room_id: ROOM_ID,
                  sender: VIEWER,
                  state_key: VIEWER,
                  origin_server_ts: BASE_TS - 498_000,
                  content: { membership: 'join', displayname: 'Viewer' },
                } as IEvent,
              ],
            },
            timeline: { events: [], prev_batch: 'm0' },
            ephemeral: { events: [] },
            account_data: { events: [] },
          },
        } as unknown as ISavedSync['roomsData']['join'],
        invite: {},
        leave: {},
        knock: {},
      },
    };
    vi.spyOn(warmStore, 'getSavedSync').mockResolvedValue(savedSync);
    vi.spyOn(warmStore, 'getSavedSyncToken').mockResolvedValue(savedSince);

    const warmFetch: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seenUrls.push(url);
      return fetch(input, init);
    };
    const warmClient = createClient({
      baseUrl: srv.baseUrl,
      userId: VIEWER,
      deviceId: 'SDK_WARM',
      accessToken: srv.accessToken,
      store: warmStore,
      timelineSupport: true,
      fetchFn: warmFetch,
    });
    clients.push(warmClient);

    await warmClient.startClient({ threadSupport: true, initialSyncLimit: 5 });
    await vi.waitFor(
      () => {
        const token = warmClient.store.getSyncToken();
        expect(token).toBeTruthy();
        expect(token).not.toBe(savedSince);
      },
      { timeout: 5_000 }
    );
    expect(
      seenUrls.some(
        (u) => u.includes('/_matrix/client/v3/sync') && u.includes(`since=${savedSince}`)
      )
    ).toBe(true);
  });
});
