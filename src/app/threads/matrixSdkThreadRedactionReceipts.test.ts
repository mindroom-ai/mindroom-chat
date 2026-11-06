import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { getRelationsThreadFilter } from 'matrix-js-sdk/lib/thread-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The SDK asks every event it gives a receipt whether it is in a thread, and warns "Event is not a
// relation or a thread root, but still has a threadRootId!" for one that has a thread but no
// relation: a redaction, or a redacted event. Agents redact a stop reaction at the end of every
// reply, so a busy room printed it hundreds of times a minute (live-test finding L9-F007).

const ROOM = '!room:example.org';
const READER = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';
const THREAD_WARNING = 'still has a threadRootId';

let ts = 1_000;
const event = (id: string, type: string, content: Record<string, unknown>, extra = {}) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM,
    type,
    sender: AGENT,
    origin_server_ts: (ts += 1),
    content,
    ...extra,
  });
const stopReaction = (id: string, replyId: string) =>
  event(id, 'm.reaction', {
    'm.relates_to': { rel_type: 'm.annotation', event_id: replyId, key: '🛑' },
  });
const redactionOf = (id: string, targetId: string) =>
  event(id, 'm.room.redaction', { redacts: targetId }, { redacts: targetId });

const fixture = async () => {
  const client = createClient({ baseUrl: 'https://example.org', userId: READER });
  const room = new Room(ROOM, client, READER, { timelineSupport: true });
  client.store.storeRoom(room);
  vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
  const root = event('$root', 'm.room.message', { msgtype: 'm.text', body: 'A question' });
  const reply = event('$reply', 'm.room.message', {
    msgtype: 'm.text',
    body: 'An answer',
    'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
  });
  await room.addLiveEvents([root], { addToState: false });
  const thread = room.createThread('$root', root, [reply], false);
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  const warnings = () =>
    vi
      .mocked(logger.warn)
      .mock.calls.filter((call) => call.some((part) => String(part).includes(THREAD_WARNING)));
  return { room, thread, warnings };
};

describe('SDK receipts for redactions in threads', () => {
  let support: FeatureSupport;
  beforeEach(() => {
    support = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.None;
  });
  afterEach(() => {
    Thread.hasServerSideSupport = support;
    vi.restoreAllMocks();
  });

  it('gives no receipt to a stop reaction that its redaction moves out of the thread', async () => {
    const { room, thread, warnings } = await fixture();
    thread.addEvent(stopReaction('$stop', '$reply'), false);
    expect(thread.findEventById('$stop')).toBeDefined();

    await room.addLiveEvents([redactionOf('$redaction', '$stop')], { addToState: false });

    expect(room.findEventById('$stop')?.isRedacted()).toBe(true);
    expect(thread.findEventById('$stop')).toBeUndefined();
    expect(warnings()).toEqual([]);
  });

  it('gives no receipt to a redaction that arrives in a thread with its target', async () => {
    const { room, thread, warnings } = await fixture();

    await room.addLiveEvents(
      [stopReaction('$stop', '$reply'), redactionOf('$redaction', '$stop')],
      {
        addToState: false,
      }
    );

    expect(thread.findEventById('$redaction')).toBeDefined();
    expect(room.getReadReceiptForUserId(AGENT)?.eventId).not.toBe('$redaction');
    expect(warnings()).toEqual([]);
  });

  it("keeps redacted events out of a thread's relations page", () => {
    const keep = getRelationsThreadFilter('$root');

    const redactedStop = { ...stopReaction('$stop', '$reply').event, content: {} };
    expect(keep(redactedStop)).toBe(false);
    expect(keep(stopReaction('$stop', '$reply').event)).toBe(true);
    expect(
      keep({
        type: 'm.room.message',
        content: { 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } },
      })
    ).toBe(true);
    // A reaction to the root lives in the room's timeline, as before.
    expect(keep(stopReaction('$root-reaction', '$root').event)).toBe(false);
  });
});
