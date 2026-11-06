import {
  ClientEvent,
  createClient,
  MatrixEventEvent,
  MemoryStore,
  NotificationCountType,
  type IEvent,
  type MatrixClient,
  type MatrixEvent,
} from 'matrix-js-sdk';
import { DecryptionError } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepEncryptedRoomCounts } from './encryptedRoomCounts';

// Regression (L5-F012): in an encrypted room the SDK counts unread messages itself as they decrypt.
// An agent's reply that the reader read half-way, then finished while the reader was elsewhere,
// left the room read although the server counted the finished reply; a new session that could
// not decrypt the room counted every streaming edit as an unread message (23 for one reply).

const ROOM = '!secure:example.org';
const ME = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';
const ROOT = '$root';
const REPLY = '$reply';

const member = (userId: string): IEvent =>
  ({
    type: 'm.room.member',
    event_id: `$member-${userId}`,
    room_id: ROOM,
    sender: userId,
    state_key: userId,
    origin_server_ts: 1,
    content: { membership: 'join' },
  } as IEvent);

const encryption = {
  type: 'm.room.encryption',
  event_id: '$encryption',
  room_id: ROOM,
  sender: ME,
  state_key: '',
  origin_server_ts: 1,
  content: { algorithm: 'm.megolm.v1.aes-sha2' },
} as IEvent;

/** An event as an encrypted room delivers it: only its relation is in the clear. */
const encrypted = (
  eventId: string,
  sender: string,
  ts: number,
  relation?: Record<string, unknown>
): IEvent =>
  ({
    type: 'm.room.encrypted',
    event_id: eventId,
    room_id: ROOM,
    sender,
    origin_server_ts: ts,
    unsigned: {},
    content: {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'opaque',
      sender_key: 'key',
      session_id: 'session',
      device_id: 'DEVICE',
      ...(relation ? { 'm.relates_to': relation } : {}),
    },
  } as IEvent);

const inThread = { rel_type: 'm.thread', event_id: ROOT };
const editsReply = { rel_type: 'm.replace', event_id: REPLY };

/** What each encrypted event of the thread decrypts to. */
const clear: Record<string, Record<string, unknown>> = {
  [ROOT]: { msgtype: 'm.text', body: '@Helper how is the build?' },
  // MindRoom streams a reply as a notice and edits it into text once it is done.
  [REPLY]: {
    msgtype: 'm.notice',
    body: 'Thinking...',
    'io.mindroom.stream_status': 'streaming',
    'm.relates_to': inThread,
  },
};
const editContent = (status: string) => ({
  msgtype: 'm.text',
  body: '* The build passed.',
  'm.new_content': {
    msgtype: status === 'completed' ? 'm.text' : 'm.notice',
    body: 'The build passed.',
    'io.mindroom.stream_status': status,
  },
  'm.relates_to': editsReply,
});

/** The homeserver's default rules that matter here: notices and edits never notify, messages do. */
const pushRules = {
  global: {
    override: [
      {
        rule_id: '.m.rule.suppress_notices',
        default: true,
        enabled: true,
        conditions: [{ kind: 'event_match', key: 'content.msgtype', pattern: 'm.notice' }],
        actions: [],
      },
    ],
    content: [],
    room: [],
    sender: [],
    underride: [
      {
        rule_id: '.m.rule.message',
        default: true,
        enabled: true,
        conditions: [{ kind: 'event_match', key: 'type', pattern: 'm.room.message' }],
        actions: ['notify'],
      },
      {
        rule_id: '.m.rule.encrypted',
        default: true,
        enabled: true,
        conditions: [{ kind: 'event_match', key: 'type', pattern: 'm.room.encrypted' }],
        actions: ['notify'],
      },
    ],
  },
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

const clients: MatrixClient[] = [];

const fixture = async (keep: boolean) => {
  const pendingSyncs: unknown[] = [];
  const waitingSyncs: Array<(response: Response) => void> = [];
  let batch = 0;
  const mx = createClient({
    baseUrl: 'https://example.org',
    userId: ME,
    accessToken: 'token',
    store: new MemoryStore(),
    fetchFn: async (input) => {
      const path = decodeURIComponent(new URL(String(input)).pathname);
      if (path.endsWith('/versions')) return json({ versions: ['v1.4'], unstable_features: {} });
      if (path.endsWith('/pushrules/')) return json(pushRules);
      if (path.endsWith('/filter')) return json({ filter_id: 'filter' });
      if (path.endsWith('/capabilities')) return json({ capabilities: {} });
      if (path.endsWith('/sync')) {
        const next = pendingSyncs.shift();
        if (next) return json(next);
        return new Promise<Response>((resolve) => {
          waitingSyncs.push(resolve);
        });
      }
      return json({});
    },
  });
  clients.push(mx);
  // The SDK's model of each event the server sent, as the client announced it.
  const seen = new Map<string, MatrixEvent>();
  mx.on(ClientEvent.Event, (event) => {
    const id = event.getId();
    if (id && !seen.has(id)) seen.set(id, event);
  });
  (mx as MatrixClient & { serverVersionsPromise?: Promise<unknown> }).serverVersionsPromise =
    Promise.resolve({ versions: ['v1.4'], unstable_features: {} });
  if (keep) keepEncryptedRoomCounts(mx);

  /** Answers the client's next /sync with these events of the room. */
  const deliver = async (events: IEvent[], ephemeral: unknown[] = []) => {
    batch += 1;
    const response = {
      next_batch: `batch-${batch}`,
      rooms: {
        join: {
          [ROOM]: {
            state: { events: [encryption, member(ME), member(AGENT)] },
            timeline: { events, prev_batch: 'before', limited: false },
            ephemeral: { events: ephemeral },
            account_data: { events: [] },
          },
        },
      },
    };
    const waiting = waitingSyncs.shift();
    if (waiting) waiting(json(response));
    else pendingSyncs.push(response);
    await settle();
  };

  void mx.startClient({ threadSupport: true });
  await vi.waitFor(() => expect(waitingSyncs.length > 0 || pendingSyncs.length > 0).toBe(true));
  await settle();

  const room = () => mx.getRoom(ROOM)!;
  const find = (eventId: string): MatrixEvent => {
    const event = seen.get(eventId);
    if (!event) throw new Error(`The client has no ${eventId}`);
    return event;
  };
  /** Decrypts an event as the crypto backend would; `undefined` content fails for want of a key. */
  const decrypt = async (event: MatrixEvent, content: Record<string, unknown> | undefined) => {
    const crypto = {
      decryptEvent: vi.fn(async () => {
        if (!content) {
          throw new DecryptionError(
            DecryptionFailureCode.HISTORICAL_MESSAGE_NO_KEY_BACKUP,
            'sent before this device logged in'
          );
        }
        return { clearEvent: { type: 'm.room.message', content } };
      }),
    };
    await event.attemptDecryption(crypto as never);
    await settle();
  };
  const threadCount = () =>
    room().getThreadUnreadNotificationCount(ROOT, NotificationCountType.Total) ?? 0;
  const totalCount = () => room().getUnreadNotificationCount(NotificationCountType.Total);
  return { mx, deliver, room, find, decrypt, threadCount, totalCount };
};

/** The reader opened the thread and read the reply's start. */
const readUpToReply = {
  type: 'm.receipt',
  content: { [REPLY]: { 'm.read': { [ME]: { ts: 3, thread_id: ROOT } } } },
};

const threadWithReadReply = async (keep: boolean) => {
  const f = await fixture(keep);
  await f.deliver(
    [encrypted(ROOT, ME, 1), encrypted(REPLY, AGENT, 2, inThread)],
    [readUpToReply]
  );
  await f.decrypt(f.find(ROOT), clear[ROOT]);
  await f.decrypt(f.find(REPLY), clear[REPLY]);
  return f;
};

describe('unread counts of an encrypted room', () => {
  afterEach(() => {
    clients.splice(0).forEach((mx) => mx.stopClient());
    vi.restoreAllMocks();
  });

  it('count a reply that finished after the reader left it, once', async () => {
    const f = await threadWithReadReply(true);
    expect(f.threadCount()).toBe(0);

    await f.deliver([
      encrypted('$edit-1', AGENT, 4, editsReply),
      encrypted('$edit-2', AGENT, 5, editsReply),
    ]);
    await f.decrypt(f.find('$edit-1'), editContent('streaming'));
    expect(f.threadCount()).toBe(0);

    await f.decrypt(f.find('$edit-2'), editContent('completed'));
    expect(f.threadCount()).toBe(1);
    expect(f.totalCount()).toBe(1);

    // Another copy of the same edit decrypting again counts nothing more.
    f.mx.emit(MatrixEventEvent.Decrypted, f.find('$edit-2'));
    expect(f.totalCount()).toBe(1);
  });

  it('do not count streaming edits a new session cannot decrypt', async () => {
    const f = await fixture(true);
    await f.deliver(
      [
        encrypted(ROOT, ME, 1),
        encrypted(REPLY, AGENT, 2, inThread),
        ...Array.from({ length: 5 }, (_, index) =>
          encrypted(`$edit-${index}`, AGENT, 4 + index, editsReply)
        ),
      ],
      [readUpToReply]
    );
    const edits = Array.from({ length: 5 }, (_, index) => f.find(`$edit-${index}`));
    await f.decrypt(f.find(REPLY), undefined);
    for (const edit of edits) await f.decrypt(edit, undefined);
    expect(f.totalCount()).toBe(0);
  });
});
