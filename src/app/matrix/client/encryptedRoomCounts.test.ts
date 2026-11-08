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
import { keepUnthreadedReceiptEvents } from '../receiptReadTs';
import { keepSyncedEdits } from './syncedEdits';

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
} as unknown as IEvent;

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
        rule_id: '.m.rule.suppress_edits',
        default: true,
        enabled: true,
        conditions: [
          { kind: 'event_property_is', key: 'content.m\\.relates_to.rel_type', value: 'm.replace' },
        ],
        actions: [],
      },
      {
        rule_id: '.m.rule.is_user_mention',
        default: true,
        enabled: true,
        conditions: [
          { kind: 'event_property_contains', key: 'content.m\\.mentions.user_ids', value: ME },
        ],
        actions: ['notify', { set_tweak: 'highlight' }],
      },
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

/** The server's unread counts for the room: its main timeline's, and each thread's by root. */
type ServerCounts = { room: number; threads?: Record<string, number> };

const fixture = async (keep: boolean) => {
  const pendingSyncs: unknown[] = [];
  const serverEvents = new Map<string, IEvent>();
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
      // An event the client asks for by ID, such as the root of a thread whose replies came
      // without it.
      const asked = /\/event\/(.+)$/.exec(path)?.[1];
      if (asked) {
        const event = serverEvents.get(asked);
        return event
          ? json(event)
          : new Response(JSON.stringify({ errcode: 'M_NOT_FOUND' }), { status: 404 });
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
  if (keep) {
    keepSyncedEdits(mx);
    keepUnthreadedReceiptEvents(mx);
    keepEncryptedRoomCounts(mx);
  }

  /**
   * Answers the client's next /sync with these events of the room; `limited` when the server left
   * out older ones, `counts` the server's unread counts (main timeline and threads) when it sends them.
   */
  const deliver = async (
    events: IEvent[],
    ephemeral: unknown[] = [],
    { limited = false, counts }: { limited?: boolean; counts?: ServerCounts } = {}
  ) => {
    batch += 1;
    events.forEach((event) => serverEvents.set(event.event_id, event));
    const response = {
      next_batch: `batch-${batch}`,
      rooms: {
        join: {
          [ROOM]: {
            state: { events: [encryption, member(ME), member(AGENT)] },
            timeline: { events, prev_batch: `before-${batch}`, limited },
            ephemeral: { events: ephemeral },
            account_data: { events: [] },
            ...(counts
              ? {
                  unread_notifications: { notification_count: counts.room, highlight_count: 0 },
                  unread_thread_notifications: Object.fromEntries(
                    Object.entries(counts.threads ?? {}).map(([id, count]) => [
                      id,
                      { notification_count: count, highlight_count: 0 },
                    ])
                  ),
                }
              : {}),
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
  /** Events the server holds that no sync brought, as after a gap. */
  const serverHolds = (events: IEvent[]) =>
    events.forEach((event) => serverEvents.set(event.event_id, event));
  return { mx, deliver, serverHolds, room, find, decrypt, threadCount, totalCount };
};

/** The reader opened the thread and read the reply's start. */
const readUpToReply = {
  type: 'm.receipt',
  content: { [REPLY]: { 'm.read': { [ME]: { ts: 3, thread_id: ROOT } } } },
};

const threadWithReadReply = async (keep: boolean) => {
  const f = await fixture(keep);
  await f.deliver([encrypted(ROOT, ME, 1), encrypted(REPLY, AGENT, 2, inThread)], [readUpToReply]);
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
    await settle();
    expect(f.totalCount()).toBe(1);
  });

  it('count a reply whose first message still streamed not before it finishes, as the server', async () => {
    const f = await fixture(true);
    // MindRoom keeps the stream status of the reply's first message in the clear.
    const pending = encrypted('$pending', AGENT, 2, inThread);
    pending.content['io.mindroom.stream_status'] = 'pending';
    // A receipt the reader sent in another thread earlier, as clients with threads send them.
    const readElsewhere = {
      type: 'm.receipt',
      content: { $elsewhere: { 'm.read': { [ME]: { ts: 1, thread_id: '$other' } } } },
    };
    await f.deliver([encrypted(ROOT, ME, 1), pending], [readElsewhere]);
    await f.decrypt(f.find(ROOT), clear[ROOT]);
    // The first message is text: push rules alone would count it.
    const thinking = {
      msgtype: 'm.text',
      body: 'Thinking...',
      'io.mindroom.stream_status': 'pending',
      'm.relates_to': inThread,
    };
    await f.decrypt(f.find('$pending'), thinking);
    expect(f.threadCount()).toBe(0);
    // Decrypting it again (after a reload, say) counts nothing either.
    f.mx.emit(MatrixEventEvent.Decrypted, f.find('$pending'));
    await settle();
    expect(f.threadCount()).toBe(0);

    // The finished reply counts once.
    const done = encrypted('$done', AGENT, 5, { rel_type: 'm.replace', event_id: '$pending' });
    done.content['io.mindroom.stream_status'] = 'completed';
    await f.deliver([done]);
    await f.decrypt(f.find('$done'), {
      ...editContent('completed'),
      'm.relates_to': { rel_type: 'm.replace', event_id: '$pending' },
    });
    expect(f.threadCount()).toBe(1);
    expect(f.totalCount()).toBe(1);
  });

  // Regression (P2-e2ee-F001): the client's receipt on a reply the reader watched to its end
  // names the reply's terminal edit, and the SDK passes over a receipt on an event no timeline
  // holds. The reply, and every event of the thread before it, counted as unread when it
  // decrypted after the server's last count: after a reload, on keys arriving late, and on a new
  // session that has no keys. The server, and the client's own receipt, say it is read.
  // With the reader's receipts in other threads, as clients with threads send them: the SDK takes
  // a thread older than every threaded receipt as read.
  const readTerminalEdit = (ts: number) => ({
    type: 'm.receipt',
    content: {
      '$edit-done': { 'm.read': { [ME]: { ts, thread_id: ROOT } } },
      $elsewhere: { 'm.read': { [ME]: { ts: 1, thread_id: '$other' } } },
    },
  });

  it('count no reply whose terminal edit the reader has a receipt on', async () => {
    const f = await fixture(true);
    await f.deliver(
      [
        encrypted(ROOT, ME, 1),
        encrypted(REPLY, AGENT, 2, inThread),
        encrypted('$edit-done', AGENT, 5, editsReply),
      ],
      [readTerminalEdit(6)]
    );
    await f.decrypt(f.find(ROOT), clear[ROOT]);
    await f.decrypt(f.find(REPLY), clear[REPLY]);
    await f.decrypt(f.find('$edit-done'), editContent('completed'));
    expect(f.threadCount()).toBe(0);
    expect(f.totalCount()).toBe(0);
  });

  it('count a reply finished after a receipt on the terminal edit of an earlier one', async () => {
    const f = await fixture(true);
    // The reader watched the first reply to its end, then left before the follow-up finished.
    await f.deliver(
      [
        encrypted(ROOT, ME, 1),
        encrypted(REPLY, AGENT, 2, inThread),
        encrypted('$edit-done', AGENT, 5, editsReply),
        encrypted('$follow-up', ME, 7, inThread),
        encrypted('$reply-2', AGENT, 8, inThread),
        encrypted('$edit-2-done', AGENT, 9, { rel_type: 'm.replace', event_id: '$reply-2' }),
      ],
      [readTerminalEdit(6)]
    );
    for (const id of [ROOT, REPLY, '$follow-up', '$reply-2']) {
      await f.decrypt(f.find(id), id === ROOT || id === '$follow-up' ? clear[ROOT] : clear[REPLY]);
    }
    await f.decrypt(f.find('$edit-done'), editContent('completed'));
    expect(f.threadCount()).toBe(0);
    await f.decrypt(f.find('$edit-2-done'), {
      ...editContent('completed'),
      'm.relates_to': { rel_type: 'm.replace', event_id: '$reply-2' },
    });
    expect(f.threadCount()).toBe(1);
  });

  it('count no follow-up reply whose terminal edit the reader has a receipt on', async () => {
    const f = await fixture(true);
    // The SDK makes up a receipt on the reader's own follow-up and prefers it to the server's
    // receipt on an edit, which no timeline holds.
    await f.deliver(
      [
        encrypted(ROOT, ME, 1),
        encrypted(REPLY, AGENT, 2, inThread),
        encrypted('$follow-up', ME, 7, inThread),
        encrypted('$reply-2', AGENT, 8, inThread),
        encrypted('$edit-2-done', AGENT, 9, { rel_type: 'm.replace', event_id: '$reply-2' }),
      ],
      [
        {
          type: 'm.receipt',
          content: {
            '$edit-2-done': { 'm.read': { [ME]: { ts: 10, thread_id: ROOT } } },
            $elsewhere: { 'm.read': { [ME]: { ts: 1, thread_id: '$other' } } },
          },
        },
      ]
    );
    for (const id of [ROOT, REPLY, '$follow-up', '$reply-2']) {
      await f.decrypt(f.find(id), id === ROOT || id === '$follow-up' ? clear[ROOT] : clear[REPLY]);
    }
    await f.decrypt(f.find('$edit-2-done'), {
      ...editContent('completed'),
      'm.relates_to': { rel_type: 'm.replace', event_id: '$reply-2' },
    });
    expect(f.threadCount()).toBe(0);
  });

  it('count nothing a new session cannot decrypt before the receipt on a terminal edit', async () => {
    const f = await fixture(true);
    await f.deliver(
      [
        encrypted(ROOT, ME, 1),
        encrypted(REPLY, AGENT, 2, inThread),
        encrypted('$edit-done', AGENT, 5, editsReply),
        encrypted('$title', AGENT, 6, inThread),
      ],
      [readTerminalEdit(7)]
    );
    for (const id of [ROOT, REPLY, '$edit-done', '$title']) await f.decrypt(f.find(id), undefined);
    expect(f.threadCount()).toBe(0);
    expect(f.totalCount()).toBe(0);
  });

  it('count no reply a new session cannot decrypt while it still streams', async () => {
    const f = await fixture(true);
    // The stream status of the reply's first message is in the clear; the server counts it not.
    const pending = encrypted(REPLY, AGENT, 2, inThread);
    pending.content['io.mindroom.stream_status'] = 'pending';
    const readElsewhere = {
      type: 'm.receipt',
      content: { $elsewhere: { 'm.read': { [ME]: { ts: 1, thread_id: '$other' } } } },
    };
    await f.deliver([encrypted(ROOT, ME, 1), pending], [readElsewhere]);
    await f.decrypt(f.find(REPLY), undefined);
    expect(f.threadCount()).toBe(0);
  });

  // Regression (P2-lane2-F005): two devices of one account showed different counts for the same
  // encrypted room (4 and 3, the server 7 with two title notices), and after a read on another
  // device a reload brought a count back (2, the server 0). The client counted events as they
  // decrypted, so the order they decrypted in and whether their thread existed yet decided it.
  const OTHER = '@colleague:example.org';
  const plain = (eventId: string, sender: string, ts: number, relation?: Record<string, unknown>) =>
    ({
      type: 'm.room.message',
      event_id: eventId,
      room_id: ROOM,
      sender,
      origin_server_ts: ts,
      unsigned: {},
      content: {
        msgtype: 'm.text',
        body: `message ${eventId}`,
        ...(relation ? { 'm.relates_to': relation } : {}),
      },
    } as IEvent);
  const streamedReply = (eventId: string, ts: number) => {
    const reply = encrypted(eventId, AGENT, ts, inThread);
    reply.content['io.mindroom.stream_status'] = 'pending';
    return reply;
  };
  const finishingEdit = (eventId: string, replyId: string, ts: number) => {
    const edit = encrypted(eventId, AGENT, ts, { rel_type: 'm.replace', event_id: replyId });
    edit.content['io.mindroom.stream_status'] = 'completed';
    return edit;
  };
  const finishedContent = (replyId: string) => ({
    ...editContent('completed'),
    'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
  });
  const otherThreadReceipt = {
    type: 'm.receipt',
    content: { $elsewhere: { 'm.read': { [ME]: { ts: 1, thread_id: '$other' } } } },
  };
  /** A colleague asks the agent; the agent's reply streams, finishes and gets its title. */
  const answeredQuestion = (offset = 0): IEvent[] => [
    plain(ROOT, OTHER, 10 + offset),
    streamedReply(REPLY, 11 + offset),
    finishingEdit('$done', REPLY, 15 + offset),
    encrypted('$title', AGENT, 16 + offset, inThread),
  ];
  const titleNotice = {
    msgtype: 'm.notice',
    body: 'Build status',
    'm.relates_to': inThread,
  };

  it('count the same whatever order the events decrypt in', async () => {
    const results: number[][] = [];
    for (const order of [
      [REPLY, '$done', '$title'],
      ['$done', '$title', REPLY],
    ]) {
      const f = await fixture(true);
      await f.deliver(answeredQuestion(), [otherThreadReceipt]);
      const contents: Record<string, Record<string, unknown>> = {
        [REPLY]: clear[REPLY]!,
        $done: finishedContent(REPLY),
        $title: titleNotice,
      };
      for (const id of order) await f.decrypt(f.find(id), contents[id]);
      results.push([f.room().getRoomUnreadNotificationCount(), f.threadCount()]);
      clients.splice(0).forEach((mx) => mx.stopClient());
    }
    // The colleague's question in the main timeline and the finished reply; not the title.
    expect(results).toEqual([
      [1, 1],
      [1, 1],
    ]);
  });

  it('count nothing a read on another device read, also after a reload', async () => {
    const readElsewhere = {
      type: 'm.receipt',
      content: { $title: { 'm.read': { [ME]: { ts: 20 } } } },
    };
    const f = await fixture(true);
    await f.deliver(answeredQuestion(), [otherThreadReceipt]);
    await f.decrypt(f.find(REPLY), clear[REPLY]);
    await f.decrypt(f.find('$done'), finishedContent(REPLY));
    await f.decrypt(f.find('$title'), titleNotice);
    expect(f.totalCount()).toBe(2);
    await f.deliver([], [readElsewhere]);
    expect(f.totalCount()).toBe(0);

    // A reload: the saved sync brings the events and the receipt at once, and they decrypt again.
    const reloaded = await fixture(true);
    await reloaded.deliver(answeredQuestion(), [otherThreadReceipt, readElsewhere]);
    for (const id of ['$done', REPLY, '$title']) {
      await reloaded.decrypt(
        reloaded.find(id),
        id === REPLY ? clear[REPLY] : id === '$done' ? finishedContent(REPLY) : titleNotice
      );
    }
    expect(reloaded.totalCount()).toBe(0);
  });

  // The server (mindroom-tuwunel #139) takes an event of the reader's as reading its own thread,
  // or the main timeline, and nothing else: a message sent in the room left a thread the reader
  // never opened unread on the server, while the client counted it read.
  it('take a message of the reader as reading only its own thread or the main timeline', async () => {
    const inMain = await fixture(true);
    await inMain.deliver([...answeredQuestion(), plain('$later', ME, 30)], [otherThreadReceipt]);
    await inMain.decrypt(inMain.find(REPLY), clear[REPLY]);
    await inMain.decrypt(inMain.find('$done'), finishedContent(REPLY));
    await inMain.decrypt(inMain.find('$title'), titleNotice);
    expect(inMain.room().getRoomUnreadNotificationCount()).toBe(0);
    expect(inMain.threadCount()).toBe(1);
    clients.splice(0).forEach((mx) => mx.stopClient());

    const inItsThread = await fixture(true);
    await inItsThread.deliver(
      [...answeredQuestion(), plain('$later', ME, 30, { rel_type: 'm.thread', event_id: ROOT })],
      [otherThreadReceipt]
    );
    await inItsThread.decrypt(inItsThread.find(REPLY), clear[REPLY]);
    await inItsThread.decrypt(inItsThread.find('$done'), finishedContent(REPLY));
    await inItsThread.decrypt(inItsThread.find('$title'), titleNotice);
    expect(inItsThread.threadCount()).toBe(0);
    expect(inItsThread.room().getRoomUnreadNotificationCount()).toBe(1);
  });

  // The server (mindroom-tuwunel #140, v1.9.4-mindroom.31) reads a context up to the event a
  // receipt names, not up to when it took the receipt: a reader who stopped at the thread's first
  // reply still has the replies after it unread on the server, while the client counted them read.
  it('leave unread the events after the event an older receipt names', async () => {
    const reply = (eventId: string, ts: number) =>
      plain(eventId, OTHER, ts, { rel_type: 'm.thread', event_id: ROOT });
    const f = await fixture(true);
    await f.deliver(
      [
        plain(ROOT, OTHER, 10),
        reply('$first', 11),
        reply('$second', 12),
        reply('$third', 13),
        plain('$later', OTHER, 14),
        plain('$latest', OTHER, 15),
      ],
      [otherThreadReceipt]
    );
    expect([f.room().getRoomUnreadNotificationCount(), f.threadCount()]).toEqual([3, 3]);

    // Taken after every event, on the thread's first reply.
    const readFirst = { $first: { 'm.read': { [ME]: { ts: 20, thread_id: ROOT } } } };
    await f.deliver([], [{ type: 'm.receipt', content: readFirst }]);
    expect(f.threadCount()).toBe(2);

    // An unthreaded receipt reads every context, up to its event: the main timeline's root here.
    const readRoot = { [ROOT]: { 'm.read': { [ME]: { ts: 21 } } } };
    await f.deliver([], [{ type: 'm.receipt', content: readRoot }]);
    expect([f.room().getRoomUnreadNotificationCount(), f.threadCount()]).toEqual([2, 2]);
  });

  // P3-lane2-F001: the SDK keeps one receipt for the main timeline, so a stale device's older
  // unthreaded receipt, on a reply in a thread and taken later, replaced a newer main receipt
  // and the messages between came back as unread. The server keeps both and only lowers counts.
  it('keep the main timeline read up to a main receipt when an older unthreaded one comes later', async () => {
    const reply = (eventId: string, ts: number) =>
      plain(eventId, OTHER, ts, { rel_type: 'm.thread', event_id: ROOT });
    const f = await fixture(true);
    await f.deliver(
      [
        plain(ROOT, OTHER, 10),
        reply('$a1', 11),
        plain('$m1', OTHER, 12),
        reply('$a2', 13),
        plain('$m2', OTHER, 14),
      ],
      [otherThreadReceipt]
    );
    expect([f.room().getRoomUnreadNotificationCount(), f.threadCount()]).toEqual([3, 2]);

    const readMain = { $m2: { 'm.read': { [ME]: { ts: 20, thread_id: 'main' } } } };
    await f.deliver([], [{ type: 'm.receipt', content: readMain }]);
    expect([f.room().getRoomUnreadNotificationCount(), f.threadCount()]).toEqual([0, 2]);

    const readFirstAnswer = { $a1: { 'm.read': { [ME]: { ts: 21 } } } };
    await f.deliver([], [{ type: 'm.receipt', content: readFirstAnswer }]);
    expect([f.room().getRoomUnreadNotificationCount(), f.threadCount()]).toEqual([0, 1]);
  });

  it('do not count streaming edits a new session cannot decrypt', async () => {
    const f = await fixture(true);
    // A reply in the room's main timeline (a room in room mode), read at its start.
    await f.deliver(
      [
        encrypted(ROOT, ME, 1),
        encrypted(REPLY, AGENT, 2),
        ...Array.from({ length: 5 }, (_, index) =>
          encrypted(`$edit-${index}`, AGENT, 4 + index, editsReply)
        ),
      ],
      [{ type: 'm.receipt', content: { [REPLY]: { 'm.read': { [ME]: { ts: 3 } } } } }]
    );
    await f.decrypt(f.find(REPLY), undefined);
    for (let index = 0; index < 5; index += 1) await f.decrypt(f.find(`$edit-${index}`), undefined);
    expect(f.totalCount()).toBe(0);
  });

  // Regression (P3-e2ee-F002): after a sync gap (a `limited` sync) the client counted only the
  // events it held after the reader's last read: 20 of 25, live and after a reload, where the
  // server, and the same messages in an unencrypted room, counted 25.
  const colleagueMessages = (from: number, count: number) =>
    Array.from({ length: count }, (_, index) =>
      plain(`$msg-${from + index}`, OTHER, 100 + from + index)
    );
  const readMain = (eventId: string, ts: number) => ({
    type: 'm.receipt',
    content: { [eventId]: { 'm.read': { [ME]: { ts, thread_id: 'main' } } } },
  });

  it("count the server's messages after a sync gap, also after a reload", async () => {
    const f = await fixture(true);
    await f.deliver([plain('$read', OTHER, 50)], [readMain('$read', 60)], { counts: { room: 0 } });
    expect(f.totalCount()).toBe(0);
    // 25 messages while the device was away; the sync brings the newest 20.
    f.serverHolds(colleagueMessages(1, 5));
    await f.deliver(colleagueMessages(6, 20), [], { limited: true, counts: { room: 25 } });
    expect(f.totalCount()).toBe(25);
    // A sync that leaves the count out (the server sends only changed counts) keeps it.
    await f.deliver([], [{ type: 'm.typing', content: { user_ids: [OTHER] } }]);
    expect(f.totalCount()).toBe(25);
    clients.splice(0).forEach((mx) => mx.stopClient());

    // A reload: the saved sync starts after the gap, with the receipt but not the event it names.
    const reloaded = await fixture(true);
    await reloaded.deliver(colleagueMessages(6, 20), [readMain('$read', 60)], {
      limited: true,
      counts: { room: 25 },
    });
    expect(reloaded.totalCount()).toBe(25);
  });

  it('count nothing read on this device while the server still counts it', async () => {
    const f = await fixture(true);
    await f.deliver([plain('$read', OTHER, 50)], [readMain('$read', 60)], { counts: { room: 0 } });
    await f.deliver(colleagueMessages(6, 20), [], { limited: true, counts: { room: 25 } });
    // The device reads up to the newest message; the server's count follows a sync later.
    await f.deliver([], [readMain('$msg-25', 200)]);
    expect(f.totalCount()).toBe(0);
  });

  it('count a thread the server counts whose events the device does not hold', async () => {
    const f = await fixture(true);
    await f.deliver(colleagueMessages(6, 20), [readMain('$msg-25', 130)], {
      limited: true,
      counts: { room: 0, threads: { '$gap-root': 3 } },
    });
    expect(f.totalCount()).toBe(3);
  });

  // Regression (P3-e2ee-F001, P3-e2ee-F003, P3-lane5-F002): a device that signed in after an
  // agent's reply, or that was offline while it streamed, got the reply's last edits and its title
  // notice in a limited sync, without the reply's first message. It counted the title notice while
  // it could not decrypt it (1, by chance right), and nothing once the keys came: 0, live and
  // after a reload, while the server counted the finished reply and the title (2) and every
  // other device showed 1.
  const streamingEdits = (count: number, fromTs: number): IEvent[] =>
    Array.from({ length: count }, (_, index) => {
      const edit = encrypted(`$stream-${index}`, AGENT, fromTs + index, editsReply);
      edit.content['io.mindroom.stream_status'] = 'streaming';
      return edit;
    });
  const replyWindow = (): IEvent[] => [
    ...streamingEdits(18, 12),
    finishingEdit('$done', REPLY, 40),
    encrypted('$title', AGENT, 41, inThread),
  ];
  const contentOf = (eventId: string) => {
    if (eventId === '$title') return titleNotice;
    if (eventId === '$done') return finishedContent(REPLY);
    return editContent('streaming');
  };
  const replyCounts = { room: 0, threads: { [ROOT]: 2 } };

  it('count an unread finished reply whose first message came before the sync, once keys arrive', async () => {
    const f = await fixture(true);
    f.serverHolds([encrypted(ROOT, ME, 10), streamedReply(REPLY, 11)]);
    const window = replyWindow();
    await f.deliver(window, [readMain(ROOT, 10)], { limited: true, counts: replyCounts });
    for (const event of window) await f.decrypt(f.find(event.event_id), undefined);
    // Without keys the device cannot tell the title notice from a message: the server's count.
    expect(f.totalCount()).toBe(2);

    // The keys come (recovery key or verification): the server's count without the title.
    for (const event of window) await f.decrypt(f.find(event.event_id), contentOf(event.event_id));
    expect([f.totalCount(), f.threadCount()]).toEqual([1, 1]);
  });

  it('count a finished reply streamed while the device was offline, also after a reload', async () => {
    const f = await fixture(true);
    await f.deliver([encrypted(ROOT, ME, 10), streamedReply(REPLY, 11)], [readMain(ROOT, 10)], {
      counts: { room: 0 },
    });
    await f.decrypt(f.find(ROOT), clear[ROOT]);
    await f.decrypt(f.find(REPLY), clear[REPLY]);
    expect(f.totalCount()).toBe(0);
    const window = replyWindow();
    await f.deliver(window, [], { limited: true, counts: replyCounts });
    for (const event of window) await f.decrypt(f.find(event.event_id), contentOf(event.event_id));
    expect(f.totalCount()).toBe(1);
    clients.splice(0).forEach((mx) => mx.stopClient());

    // The saved sync holds what came after the gap.
    const reloaded = await fixture(true);
    reloaded.serverHolds([encrypted(ROOT, ME, 10), streamedReply(REPLY, 11)]);
    await reloaded.deliver(window, [readMain(ROOT, 10)], { limited: true, counts: replyCounts });
    for (const event of window) {
      await reloaded.decrypt(reloaded.find(event.event_id), contentOf(event.event_id));
    }
    expect(reloaded.totalCount()).toBe(1);
  });

  // Regression (P3-e2ee-F001, a new session that holds the whole room): the terminal edit of an
  // unopened thread's reply waits in the thread's buffer, where the session never decrypts it, also
  // once the keys came. Push rules read on its ciphertext take it as an edit and count nothing, so
  // the finished reply counted 0 while the server counted it.
  it('count a finished reply whose terminal edit the session never decrypts', async () => {
    const f = await fixture(true);
    const window = [
      { ...member(ME), origin_server_ts: 1 } as IEvent,
      encrypted(ROOT, ME, 10),
      streamedReply(REPLY, 11),
      ...replyWindow(),
    ];
    await f.deliver(window, [], { counts: replyCounts });
    // Without keys: the server's count, the title notice included.
    for (const event of window.filter((e) => e.type === 'm.room.encrypted')) {
      if (event.event_id !== '$done') await f.decrypt(f.find(event.event_id), undefined);
    }
    expect(f.totalCount()).toBe(2);
    // The keys come; the terminal edit stays as it came.
    for (const event of window.filter((e) => e.type === 'm.room.encrypted')) {
      const id = event.event_id;
      if (id === '$done') continue;
      await f.decrypt(f.find(id), id === ROOT ? clear[ROOT] : id === REPLY ? clear[REPLY] : contentOf(id));
    }
    expect([f.totalCount(), f.threadCount()]).toEqual([1, 1]);
  });

  // In an encrypted room only the client can see a mention. The server bundles a reply's newest
  // edit with the reply, and that copy stays encrypted until the reply is shown, while the SDK
  // decrypts the copy the sync brought. The count read the bundled copy, so a finished reply that
  // names the reader counted, but did not highlight, until the reader opened the room.
  it('highlight a finished reply that mentions the reader while its bundled edit stays encrypted', async () => {
    const f = await fixture(true);
    const bundled = finishingEdit('$done', REPLY, 40);
    const reply = { ...streamedReply(REPLY, 11), unsigned: { 'm.relations': { 'm.replace': bundled } } };
    const window = [
      { ...member(ME), origin_server_ts: 1 } as IEvent,
      encrypted(ROOT, ME, 10),
      reply,
      finishingEdit('$done', REPLY, 40),
      encrypted('$title', AGENT, 41, inThread),
    ];
    await f.deliver(window, [], { counts: replyCounts });
    await f.decrypt(f.find(ROOT), clear[ROOT]);
    await f.decrypt(f.find(REPLY), clear[REPLY]);
    await f.decrypt(f.find('$title'), titleNotice);
    // The copy the sync brought decrypts; the bundled one on the reply does not.
    await f.decrypt(f.find('$done'), {
      ...finishedContent(REPLY),
      'm.new_content': {
        msgtype: 'm.text',
        body: 'The build passed, reader.',
        'io.mindroom.stream_status': 'completed',
        'm.mentions': { user_ids: [ME] },
      },
    });
    expect(f.find(REPLY).replacingEvent()?.getClearContent()).toBeNull();

    expect([f.totalCount(), f.threadCount()]).toEqual([1, 1]);
    expect(
      f.room().getThreadUnreadNotificationCount(ROOT, NotificationCountType.Highlight)
    ).toBe(1);
  });
});
