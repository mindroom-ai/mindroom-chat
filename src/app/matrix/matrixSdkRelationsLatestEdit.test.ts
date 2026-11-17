import {
  createClient,
  EventStatus,
  FeatureSupport,
  MatrixEvent,
  Room,
  Thread,
  type IEvent,
} from 'matrix-js-sdk';
import { DecryptionError } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEditedEvent } from './room';

// Upstream, a room's relations keep every edit of a message for as long as the room lives. An
// agent's streamed reply is edited hundreds of times, each edit with the whole text so far, so the
// room held all of them, and the SDK went through all of them again on every further edit. Only a
// sender's newest edit can show, so our SDK patch drops a sent edit once its sender has a newer sent
// edit that decrypted. An edit still being sent stays, as it may be cancelled, and one that failed
// to decrypt takes no older edit's place, as the app shows the newest edit it can read.

const ROOM = '!room:example.org';
const AGENT = '@agent:example.org';
const ME = '@me:example.org';
const ROOT = '$root';
const REPLY = '$reply';

const message = (
  id: string,
  ts: number,
  content: Record<string, unknown>,
  sender = AGENT
): Partial<IEvent> => ({
  event_id: id,
  room_id: ROOM,
  sender,
  origin_server_ts: ts,
  type: 'm.room.message',
  content: { msgtype: 'm.text', body: id, ...content },
});
const editContent = (body: string, target: string) => ({
  msgtype: 'm.text',
  body: `* ${body}`,
  'm.new_content': { msgtype: 'm.text', body },
  'm.relates_to': { rel_type: 'm.replace', event_id: target },
});
const edit = (id: string, ts: number, target = REPLY, sender = AGENT) =>
  new MatrixEvent(message(id, ts, editContent(id, target), sender));
const reaction = (id: string, key: string, sender: string) =>
  new MatrixEvent({
    ...message(id, 5, {}, sender),
    type: 'm.reaction',
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: REPLY, key } },
  });

/** An edit as an encrypted room delivers it: only its relation is in the clear. */
const encryptedEdit = (id: string, ts: number) =>
  new MatrixEvent({
    ...message(id, ts, {}),
    type: 'm.room.encrypted',
    content: {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'opaque',
      'm.relates_to': { rel_type: 'm.replace', event_id: REPLY },
    },
  });

/** A crypto backend whose key for the edit arrives on the second attempt. */
const keyArrivesLater = (id: string) => ({
  decryptEvent: vi
    .fn()
    .mockRejectedValueOnce(
      new DecryptionError(DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID, 'no key yet')
    )
    .mockResolvedValueOnce({
      clearEvent: { type: 'm.room.message', content: editContent(id, REPLY) },
    }),
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the edits a room keeps of a message', () => {
  let support: FeatureSupport;
  beforeEach(() => {
    support = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.None;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    Thread.hasServerSideSupport = support;
    vi.restoreAllMocks();
  });

  /** A room with the agent's reply in a thread, and how its events arrive: live, as the sync brings them. */
  const roomWithReply = async () => {
    // Offline: the SDK asks the server for a message the room does not hold.
    const fetchFn = () => Promise.reject(new Error('offline'));
    const client = createClient({ baseUrl: 'https://example.org', userId: ME, fetchFn });
    vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
    const room = new Room(ROOM, client, ME, { timelineSupport: true });
    vi.spyOn(client, 'getRoom').mockReturnValue(room);
    const add = async (...events: MatrixEvent[]) => {
      await room.addLiveEvents(events, { addToState: false });
      await tick();
    };
    await add(
      new MatrixEvent(message(ROOT, 1, {}, ME)),
      new MatrixEvent(
        message(REPLY, 2, { 'm.relates_to': { rel_type: 'm.thread', event_id: ROOT } })
      )
    );
    const reply = room.findEventById(REPLY);
    if (!reply) throw new Error('the room does not hold the reply');
    const kept = (target = REPLY) =>
      room.relations
        .getChildEventsForEvent(target, 'm.replace', 'm.room.message')
        ?.getRelations()
        .map((event) => event.getId());
    return { room, add, reply, kept };
  };

  it('are one after 50 edits of a streamed reply: the newest', async () => {
    const { room, add, reply, kept } = await roomWithReply();

    for (let round = 1; round <= 50; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await add(edit(`$edit-${round}`, 10 + round));
    }

    expect(kept()).toEqual(['$edit-50']);
    expect(reply.replacingEvent()?.getId()).toBe('$edit-50');
    // The thread shows the reply from the same relations.
    expect(room.getThread(ROOT)?.timelineSet.relations).toBe(room.relations);
  });

  it('leave out an older edit that arrives after a newer one', async () => {
    const { add, reply, kept } = await roomWithReply();

    await add(edit('$newest', 20));
    await add(edit('$older', 10));

    expect(kept()).toEqual(['$newest']);
    expect(reply.replacingEvent()?.getId()).toBe('$newest');
  });

  it('are each sender’s newest, and both of two sent at the same time', async () => {
    const { add, reply, kept } = await roomWithReply();

    await add(edit('$first', 10), edit('$not-the-sender', 11, REPLY, ME));
    await add(edit('$tie-a', 20), edit('$tie-b', 20));

    expect(kept()).toEqual(['$not-the-sender', '$tie-a', '$tie-b']);
    expect(reply.replacingEvent()?.getId()).toBe('$tie-b');
  });

  it('are one for a message the room does not hold, too', async () => {
    const { add, kept } = await roomWithReply();

    for (let round = 1; round <= 5; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await add(edit(`$edit-${round}`, 10 + round, '$unknown'));
    }

    expect(kept('$unknown')).toEqual(['$edit-5']);
  });

  it('keep the sent edit beside one still being sent, until its remote echo arrives', async () => {
    const { room, add, kept } = await roomWithReply();
    await add(new MatrixEvent(message('$mine', 3, {}, ME)), edit('$sent', 4, '$mine', ME));
    const mine = room.findEventById('$mine');
    const pending = edit('~pending', 5, '$mine', ME);
    pending.setStatus(EventStatus.SENDING);
    pending.setTxnId('txn');
    room.addPendingEvent(pending, 'txn');
    await tick();

    expect(kept('$mine')).toEqual(['$sent', '~pending']);
    expect(mine?.replacingEvent()).toBe(pending);

    // The server took it; the client still waits for the sync to bring it.
    room.updatePendingEvent(pending, EventStatus.SENT, '$echoed');
    await tick();
    expect(kept('$mine')).toEqual(['$sent', '$echoed']);

    const echo = edit('$echoed', 6, '$mine', ME);
    echo.setUnsigned({ transaction_id: 'txn' });
    await add(echo);
    expect(kept('$mine')).toEqual(['$echoed']);
    expect(mine?.replacingEvent()).toBe(pending);
  });

  it('keep the last edit the client can read while a newer one cannot be decrypted', async () => {
    const { room, add, reply, kept } = await roomWithReply();
    const shown = () => getEditedEvent(REPLY, reply, room.getUnfilteredTimelineSet())?.getId();
    const crypto = keyArrivesLater('$unreadable');
    const unreadable = encryptedEdit('$unreadable', 30);
    await unreadable.attemptDecryption(crypto as never);
    expect(unreadable.isDecryptionFailure()).toBe(true);

    await add(edit('$first', 10), edit('$readable', 20), unreadable);

    expect(kept()).toEqual(['$readable', '$unreadable']);
    expect(shown()).toBe('$readable');

    // Its key arrives, and the next edit leaves the room one edit again.
    await unreadable.attemptDecryption(crypto as never, { isRetry: true });
    expect(shown()).toBe('$unreadable');
    await add(edit('$next', 40));
    expect(kept()).toEqual(['$next']);
    expect(shown()).toBe('$next');
  });

  it('leave the reactions to the message as they are', async () => {
    const { room, add } = await roomWithReply();

    await add(reaction('$up-1', '👍', ME), edit('$edit-1', 10), reaction('$up-2', '👍', AGENT));
    await add(edit('$edit-2', 11), reaction('$party', '🎉', ME));

    const reactions = room.relations.getChildEventsForEvent(REPLY, 'm.annotation', 'm.reaction');
    expect(reactions?.getRelations().map((event) => event.getId())).toEqual([
      '$up-1',
      '$up-2',
      '$party',
    ]);
    expect(
      reactions?.getSortedAnnotationsByKey()?.map(([key, events]) => [key, events.size])
    ).toEqual([
      ['👍', 2],
      ['🎉', 1],
    ]);
  });
});
