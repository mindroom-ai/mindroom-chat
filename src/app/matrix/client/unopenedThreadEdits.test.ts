import {
  ClientEvent,
  createClient,
  ThreadEvent,
  type IEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { DecryptionError } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';
import {
  FeatureSupport,
  FILTER_RELATED_BY_REL_TYPES,
  FILTER_RELATED_BY_SENDERS,
  THREAD_RELATION_TYPE,
  Thread,
} from 'matrix-js-sdk/lib/models/thread';
import { MemoryStore } from 'matrix-js-sdk/lib/store/memory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildThreadRecord } from '../../event-store/threads/threadRecord';
import { getFinishingEdit } from '../../event-store/threads/streamFinish';
import { getThreadSummaryReply, keepUnopenedThreadEditsShown } from './unopenedThreadEdits';
import { defined } from '../../../test/utils/defined';

const roomId = '!room:example.org';
const agentId = '@agent:example.org';
const otherId = '@other:example.org';
const rootId = '$root';

const message = (
  eventId: string,
  ts: number,
  content: Record<string, unknown>,
  sender = agentId
): IEvent =>
  ({
    event_id: eventId,
    room_id: roomId,
    sender,
    type: 'm.room.message',
    origin_server_ts: ts,
    unsigned: {},
    content: { msgtype: 'm.text', ...content },
  } as IEvent);
const root = (): IEvent => message(rootId, 1, { body: 'What changed in the build?' });
const reply = (): IEvent =>
  message('$reply', 100, {
    body: 'Thinking about it',
    'io.mindroom.stream_status': 'pending',
    'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
  });
const edit = (body: string, ts: number, status = 'streaming', sender = agentId): IEvent =>
  message(
    `$edit-${ts}`,
    ts,
    {
      body: `* ${body}`,
      'm.new_content': { msgtype: 'm.text', body, 'io.mindroom.stream_status': status },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
    },
    sender
  );
/** The thread's title notice, sent after its reply finished: the thread's newest event. */
const title = (ts: number): IEvent =>
  message(`$title-${ts}`, ts, {
    msgtype: 'm.notice',
    body: 'Build status',
    'io.mindroom.thread_summary': { version: 1, summary: 'Build status', message_count: 2 },
    'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
  });
/** An edit as an encrypted room delivers it: only its relation is in the clear. */
const encryptedEdit = (ts: number): IEvent =>
  ({
    event_id: `$edit-${ts}`,
    room_id: roomId,
    sender: agentId,
    type: 'm.room.encrypted',
    origin_server_ts: ts,
    unsigned: {},
    content: {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'ciphertext',
      sender_key: 'sender-key',
      session_id: 'session',
      device_id: 'DEVICE',
      'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
    },
  } as IEvent);
const redaction = (eventId: string, ts: number): IEvent => ({
  ...message(`$redaction-${ts}`, ts, {}),
  type: 'm.room.redaction',
  redacts: eventId,
  content: { redacts: eventId },
});
const withSummary = (latest: IEvent): IEvent => ({
  ...root(),
  unsigned: {
    'm.relations': {
      'm.thread': { count: 1, current_user_participated: false, latest_event: latest },
    },
  },
});
const membership = (userId: string): IEvent =>
  ({
    type: 'm.room.member',
    event_id: `$member-${userId}`,
    room_id: roomId,
    sender: userId,
    state_key: userId,
    origin_server_ts: 0,
    content: { membership: 'join' },
  } as IEvent);

const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const clients: MatrixClient[] = [];

/** A real SDK client against a fake homeserver whose /sync answers come from `deliver`. */
const fixture = (serverThread: () => IEvent[]) => {
  const requests: string[] = [];
  const pendingSyncs: unknown[] = [];
  const waitingSyncs: Array<(response: Response) => void> = [];
  let batch = 0;
  const mx = createClient({
    baseUrl: 'https://example.org',
    userId: otherId,
    accessToken: 'token',
    timelineSupport: true,
    store: new MemoryStore(),
    fetchFn: async (input) => {
      const url = new URL(String(input));
      const path = decodeURIComponent(url.pathname);
      requests.push(path);
      if (path.endsWith('/versions')) return json({ versions: ['v1.4'], unstable_features: {} });
      if (path.endsWith('/pushrules/')) return json({ global: {} });
      if (path.endsWith('/filter')) return json({ filter_id: 'filter' });
      if (path.endsWith('/capabilities')) return json({ capabilities: {} });
      if (path.endsWith('/sync')) {
        const next = pendingSyncs.shift();
        if (next) return json(next);
        return new Promise<Response>((resolve) => {
          waitingSyncs.push(resolve);
        });
      }
      if (path.endsWith('/messages')) return json({ chunk: [], start: 'start', end: 'end' });
      if (path.endsWith(`/event/${rootId}`)) return json(withSummary(reply()));
      if (path.includes(`/relations/${rootId}`)) return json({ chunk: serverThread() });
      throw new Error(`Unexpected request ${path}`);
    },
  });
  clients.push(mx);
  (mx as MatrixClient & { serverVersionsPromise?: Promise<unknown> }).serverVersionsPromise =
    Promise.resolve({ versions: ['v1.4'], unstable_features: {} });

  /** Answers the client's next /sync with these room events, as the server sends them. */
  const deliver = async (events: IEvent[]) => {
    batch += 1;
    const response = {
      next_batch: `batch-${batch}`,
      rooms: {
        join: {
          [roomId]: {
            state: { events: [membership(agentId), membership(otherId)] },
            timeline: { events, prev_batch: 'before', limited: false },
            ephemeral: { events: [] },
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
  const start = async (keep = true) => {
    if (keep) keepUnopenedThreadEditsShown(mx);
    void mx.startClient({ threadSupport: true, lazyLoadMembers: true });
    await vi.waitFor(() => expect(waitingSyncs.length > 0 || pendingSyncs.length > 0).toBe(true));
    await settle();
  };
  const room = (): Room => mx.getRoom(roomId)!;
  const thread = (): Thread => room().getThread(rootId)!;
  /** What the thread's Compact card shows: its latest reply's preview and whether it streams. */
  const card = (cached?: { text: string; ts: number }) => {
    const record = buildThreadRecord({
      room: room(),
      threadRootId: rootId,
      // What the overview's cache read last: a saved copy of the reply, at its revision's time.
      fallbackLatestReplyPreviewText: cached?.text,
      fallbackLatestReplyTs: cached?.ts,
    });
    return {
      preview: record.presentation.latestReplyPreviewText,
      streaming: record.status.isStreaming,
    };
  };
  const loadedThread = () => requests.some((path) => path.includes('/relations/'));
  return { mx, deliver, start, room, thread, card, loadedThread };
};

const threadNamespaces = [
  FILTER_RELATED_BY_REL_TYPES,
  FILTER_RELATED_BY_SENDERS,
  THREAD_RELATION_TYPE,
];

describe('edits of unopened threads', () => {
  let support: [FeatureSupport, FeatureSupport, FeatureSupport];
  let namespaces: boolean[];
  beforeEach(() => {
    namespaces = threadNamespaces.map((value) => value.name === value.unstable);
    support = [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ];
  });
  afterEach(() => {
    clients.splice(0).forEach((mx) => mx.stopClient());
    [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ] = support;
    threadNamespaces.forEach((value, index) =>
      value.setPreferUnstable(defined(namespaces[index], 'a saved namespace preference'))
    );
    vi.restoreAllMocks();
  });

  /** A thread whose reply streams in: the root and the reply first, then the edits. */
  const streamingThread = async (keep = true) => {
    const f = fixture(() => [reply()]);
    await f.start(keep);
    await f.deliver([withSummary(reply()), reply()]);
    expect(f.card()).toEqual({ preview: 'Thinking about it', streaming: true });
    return f;
  };

  it('shows the newest edit of a streamed reply on its card without loading the thread', async () => {
    const f = await streamingThread();
    await f.deliver([edit('The build', 150), edit('The build passed.', 151)]);
    expect(f.card()).toEqual({ preview: 'The build passed.', streaming: true });

    await f.deliver([edit('The build passed. All 412 tests are green.', 152, 'completed')]);
    expect(f.card()).toEqual({
      preview: 'The build passed. All 412 tests are green.',
      streaming: false,
    });
    expect(f.thread().initialEventsFetched).toBe(false);
    expect(f.loadedThread()).toBe(false);
  });

  it('shows the edits of a reply the thread knows only from its root summary', async () => {
    const f = fixture(() => [reply()]);
    await f.start();
    // A thread listed with the room: its reply is only the root summary's latest event.
    await f.deliver([withSummary(reply())]);
    expect(f.card()).toEqual({ preview: 'Thinking about it', streaming: true });

    await f.deliver([edit('The build passed. All 412 tests are green.', 152, 'completed')]);
    expect(f.card()).toEqual({
      preview: 'The build passed. All 412 tests are green.',
      streaming: false,
    });
    expect(f.loadedThread()).toBe(false);
  });

  it('shows a streamed edit over an older cached copy of the reply', async () => {
    const f = fixture(() => [reply()]);
    await f.start();
    await f.deliver([withSummary(reply())]);
    await f.deliver([edit('The build', 150)]);
    // The cache saved the reply before its first edit.
    expect(f.card({ text: 'Thinking about it', ts: 100 })).toEqual({
      preview: 'The build',
      streaming: true,
    });
  });

  it('keeps the finished reply on the card when a title notice follows it', async () => {
    const f = fixture(() => [reply()]);
    await f.start();
    await f.deliver([withSummary(reply())]);
    await f.deliver([edit('The build', 150)]);
    // The last edit and the title come in one /sync answer: the title is now the thread's newest
    // event, and the SDK's summary no longer names the reply.
    await f.deliver([edit('The build passed.', 151, 'completed'), title(160)]);
    const finished = { preview: 'The build passed.', streaming: false };
    expect(f.card()).toEqual(finished);
    expect(f.card({ text: 'Thinking about it', ts: 100 })).toEqual(finished);
    expect(f.loadedThread()).toBe(false);
  });

  it('keeps the finished reply on the card when a title notice comes in a later answer', async () => {
    const f = fixture(() => [reply()]);
    await f.start();
    await f.deliver([withSummary(reply())]);
    await f.deliver([edit('The build passed.', 151, 'completed')]);
    await f.deliver([title(160)]);
    const finished = { preview: 'The build passed.', streaming: false };
    expect(f.card()).toEqual(finished);
    expect(f.card({ text: 'Thinking about it', ts: 100 })).toEqual(finished);
  });

  it('keeps a newer cached copy over the reply the device holds', async () => {
    const f = fixture(() => [reply()]);
    await f.start();
    await f.deliver([withSummary(reply())]);
    await f.deliver([edit('The build', 150), title(160)]);
    // Another session saved the finished reply after this device's last edit.
    expect(f.card({ text: 'The build passed.', ts: 155 }).preview).toBe('The build passed.');
  });

  it('is what moves the card past the first revision', async () => {
    const f = await streamingThread(false);
    await f.deliver([edit('The build passed.', 151, 'completed')]);
    // The SDK holds the edit for the thread's first page.
    expect(f.card()).toEqual({ preview: 'Thinking about it', streaming: true });
  });

  it('keeps the newer edit when an older one arrives later', async () => {
    const f = await streamingThread();
    await f.deliver([edit('Final answer', 160, 'completed')]);
    await f.deliver([edit('Draft', 155)]);
    expect(f.card()).toEqual({ preview: 'Final answer', streaming: false });
  });

  it('ignores an edit by someone other than the reply sender', async () => {
    const f = await streamingThread();
    await f.deliver([edit('Not the agent', 150, 'completed', otherId)]);
    expect(f.card()).toEqual({ preview: 'Thinking about it', streaming: true });
  });

  it('shows an edit that came before its reply once the reply arrives', async () => {
    const f = fixture(() => [reply()]);
    await f.start();
    await f.deliver([withSummary(reply())]);
    await f.deliver([edit('Arrived first', 150, 'completed')]);
    await f.deliver([reply()]);
    expect(f.card()).toEqual({ preview: 'Arrived first', streaming: false });
  });

  it('shows the reply as sent again when its shown edit is redacted', async () => {
    const f = await streamingThread();
    await f.deliver([edit('Leaked a secret', 150)]);
    expect(f.card().preview).toBe('Leaked a secret');

    await f.deliver([redaction('$edit-150', 170)]);
    expect(f.card()).toEqual({ preview: 'Thinking about it', streaming: true });
  });

  it('keeps a streamed edit another member redacts, also for the first page', async () => {
    const f = await streamingThread();
    await f.deliver([edit('The build passed.', 150)]);

    // Only the reply's sender or a moderator may redact the edit.
    await f.deliver([{ ...redaction('$edit-150', 160), sender: otherId }]);

    expect(f.card().preview).toBe('The build passed.');
    expect(f.thread().replayEvents?.map((event) => event.getId())).toContain('$edit-150');
    expect(f.loadedThread()).toBe(false);
  });

  it('shows the reply as sent once its bundled edit is redacted after a title notice', async () => {
    const leaked = edit('Leaked a secret', 151, 'completed');
    const bundled = (): IEvent => ({
      ...reply(),
      unsigned: { 'm.relations': { 'm.replace': leaked } },
    });
    const f = fixture(() => [bundled()]);
    await f.start();
    // The reply and its edit are known only from the root's summary; then the title notice follows.
    await f.deliver([withSummary(bundled())]);
    await f.deliver([title(160)]);
    expect(f.card().preview).toBe('Leaked a secret');

    await f.deliver([redaction('$edit-151', 170)]);
    expect(f.card().preview).toBe('Thinking about it');
    // Nor does the reply still name the edit as the one that finished its stream.
    const kept = defined(getThreadSummaryReply(f.thread()), 'the reply the thread keeps');
    expect(getFinishingEdit(kept, f.thread())).toBeUndefined();

    expect(f.loadedThread()).toBe(false);
  });

  it('does not show a stale copy of a bundled edit the room took a redaction of', async () => {
    const leaked = edit('Leaked a secret', 151, 'completed');
    const bundled = (): IEvent => ({
      ...reply(),
      unsigned: { 'm.relations': { 'm.replace': leaked } },
    });
    const f = fixture(() => [bundled()]);
    await f.start();
    await f.deliver([withSummary(bundled())]);
    await f.deliver([redaction('$edit-151', 170)]);
    expect(f.card().preview).toBe('Thinking about it');

    // A copy of the edit as it was before its redaction comes back, as from a cached page.
    await f.deliver([leaked]);

    expect(f.card().preview).toBe('Thinking about it');
    expect(f.loadedThread()).toBe(false);
  });

  it('shows an encrypted edit once a later attempt decrypts it', async () => {
    const f = await streamingThread();
    await f.deliver([encryptedEdit(150)]);
    const held = f.thread().replayEvents!.find((event) => event.getId() === '$edit-150')!;
    const { content } = edit('Decrypted once the key came', 150, 'completed');
    const crypto = {
      decryptEvent: vi
        .fn()
        // The key is not there yet: the SDK announces the failed attempt as decrypted too.
        .mockRejectedValueOnce(
          new DecryptionError(DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID, 'no key')
        )
        .mockResolvedValueOnce({ clearEvent: { type: 'm.room.message', content } }),
    };

    await held.attemptDecryption(crypto as never);
    await settle();
    expect(held.isDecryptionFailure()).toBe(true);
    expect(f.card()).toEqual({ preview: 'Thinking about it', streaming: true });

    await held.attemptDecryption(crypto as never);
    await settle();
    expect(f.card()).toEqual({ preview: 'Decrypted once the key came', streaming: false });
  });

  it('lets go of a room the account forgets', async () => {
    const f = await streamingThread(false);
    const room = f.room();
    const before = room.listenerCount(ThreadEvent.Update);
    keepUnopenedThreadEditsShown(f.mx);
    expect(room.listenerCount(ThreadEvent.Update)).toBe(before + 1);

    // What the SDK announces once `forget` takes the room out of the store.
    f.mx.emit(ClientEvent.DeleteRoom, roomId);
    expect(room.listenerCount(ThreadEvent.Update)).toBe(before);
  });

  it('shows the same edit once the thread opens', async () => {
    const final = edit('The build passed.', 151, 'completed');
    const f = fixture(() => [{ ...reply(), unsigned: { 'm.relations': { 'm.replace': final } } }]);
    await f.start();
    await f.deliver([withSummary(reply()), reply()]);
    await f.deliver([final]);
    expect(f.card().preview).toBe('The build passed.');

    await f.thread().initialize();
    await settle();
    expect(f.thread().initialEventsFetched).toBe(true);
    expect(f.card()).toEqual({ preview: 'The build passed.', streaming: false });
  });
});
