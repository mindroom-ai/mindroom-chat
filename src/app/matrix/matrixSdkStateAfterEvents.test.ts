import {
  ClientEvent,
  createClient,
  EventType,
  MemoryStore,
  type MatrixClient,
} from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

const BASE_URL = 'https://matrix.example';
const USER_ID = '@alice:example';
const ROOM_ID = '!room:example';

const event = (eventId: string, type: string, content: object, stateKey?: string) => ({
  event_id: eventId,
  room_id: ROOM_ID,
  sender: USER_ID,
  origin_server_ts: 1,
  type,
  content,
  ...(stateKey === undefined ? {} : { state_key: stateKey }),
});

const member = event('$member', EventType.RoomMember, { membership: 'join' }, USER_ID);
const topic = event('$topic', EventType.RoomTopic, { topic: 'New' }, '');
const reply = event('$reply', EventType.RoomMessage, { msgtype: 'm.text', body: 'Reply' });

const responses: Record<string, object> = {
  'initial-request': {
    next_batch: 'initial',
    rooms: {
      join: {
        [ROOM_ID]: {
          'org.matrix.msc4222.state_after': { events: [member] },
          timeline: { events: [], limited: false },
        },
      },
    },
  },
  // What Tuwunel answers with lazy-loaded members: the state after the timeline holds the
  // sender's membership again, although the client has had that very event since it joined.
  initial: {
    next_batch: 'after-reply',
    rooms: {
      join: {
        [ROOM_ID]: {
          'org.matrix.msc4222.state_after': { events: [member, topic] },
          timeline: { events: [reply, topic], limited: false },
        },
      },
    },
  },
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('Matrix sync events with the state after the timeline (MSC4222)', () => {
  const clients: MatrixClient[] = [];

  afterEach(() => {
    clients.splice(0).forEach((client) => client.stopClient());
  });

  it('announces what the timeline brought, not the state the server repeats beside it', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/versions')) return json({ versions: ['v1.11'] });
      if (url.pathname.includes('/pushrules')) return json({ global: {} });
      if (url.pathname.endsWith('/filter')) return json({ filter_id: 'filter' });
      if (!url.pathname.endsWith('/sync')) return json({});
      const response = responses[url.searchParams.get('since') ?? 'initial-request'];
      if (response) return json(response);
      return new Promise<Response>(() => {
        // Long poll with nothing new.
      });
    });
    const client = createClient({
      baseUrl: BASE_URL,
      userId: USER_ID,
      deviceId: 'DEVICE',
      accessToken: 'token',
      store: new MemoryStore(),
      fetchFn,
    });
    clients.push(client);
    const announced: Array<string | undefined> = [];
    client.on(ClientEvent.Event, (matrixEvent) => {
      if (matrixEvent.getRoomId() === ROOM_ID) announced.push(matrixEvent.getId());
    });

    await client.startClient({ initialSyncLimit: 1 });
    await vi.waitFor(() => expect(client.store.getSyncToken()).toBe('after-reply'));

    // matrix-js-sdk 41.7 announced exactly this. The room state still follows the state after
    // the timeline, so the membership and the new topic are both in place.
    expect(announced).toEqual(['$reply', '$topic']);
    const state = client.getRoom(ROOM_ID)?.currentState;
    expect(state?.getStateEvents(EventType.RoomMember, USER_ID)?.getId()).toBe('$member');
    expect(state?.getStateEvents(EventType.RoomTopic, '')?.getId()).toBe('$topic');
  });
});
