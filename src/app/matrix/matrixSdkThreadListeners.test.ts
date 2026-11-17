import {
  createClient,
  FeatureSupport,
  Room,
  Thread,
  ThreadEvent,
  MatrixEvent,
  type IEvent,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Upstream, `MatrixEvent.setThread` made the event re-emit its thread's `ThreadEvent.Update`, which
// left one listener on the thread for every event instance given to it: each reply, each edit of a
// streamed reply, and each further copy the event mapper made of one. The thread so kept all of
// them, with their content, for as long as it lived, and every update of the thread called every
// one. Our SDK patch drops that re-emit, which nothing listened for.

const ROOM = '!room:example.org';
const AGENT = '@agent:example.org';
const ROOT = '$root';

const message = (id: string, ts: number, content: Record<string, unknown>): Partial<IEvent> => ({
  event_id: id,
  room_id: ROOM,
  sender: AGENT,
  origin_server_ts: ts,
  type: 'm.room.message',
  content: { msgtype: 'm.text', body: id, ...content },
});
const reply = (id: string, ts: number) =>
  message(id, ts, { 'm.relates_to': { rel_type: 'm.thread', event_id: ROOT } });
const edit = (id: string, ts: number, target: string) =>
  message(id, ts, {
    'm.new_content': { msgtype: 'm.text', body: id },
    'm.relates_to': { rel_type: 'm.replace', event_id: target },
  });

describe('the listeners a thread holds for its events', () => {
  let support: FeatureSupport;
  beforeEach(() => {
    support = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.None;
  });
  afterEach(() => {
    Thread.hasServerSideSupport = support;
    vi.restoreAllMocks();
  });

  const threadWithReply = async () => {
    const client = createClient({ baseUrl: 'https://example.org', userId: '@me:example.org' });
    vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
    const room = new Room(ROOM, client, '@me:example.org', { timelineSupport: true });
    vi.spyOn(client, 'getRoom').mockReturnValue(room);
    const map = client.getEventMapper();
    const add = (...events: MatrixEvent[]) => room.addLiveEvents(events, { addToState: false });
    await add(map(message(ROOT, 1, {})), map(reply('$reply-0', 2)));
    const thread = room.getThread(ROOT);
    if (!thread) throw new Error('the room made no thread');
    return { room, thread, map, add };
  };

  it('stay as many across replies, edits and further copies of them', async () => {
    const { thread, map, add } = await threadWithReply();
    const listeners = () => thread.listenerCount(ThreadEvent.Update);
    const before = listeners();

    const given: MatrixEvent[] = [];
    let ts = 10;
    for (let round = 1; round <= 5; round += 1) {
      ts += 1;
      const next = map(reply(`$reply-${round}`, ts));
      ts += 1;
      const streamed = map(edit(`$edit-${round}`, ts, `$reply-${round}`));
      // eslint-disable-next-line no-await-in-loop
      await add(next, streamed);
      // Another instance of a reply the thread holds, as a read of the cache or of the server
      // makes, given the thread as the SDK gives it to what it maps.
      const copy = new MatrixEvent(reply(`$reply-${round}`, ts));
      copy.setThread(thread);
      expect(copy).not.toBe(next);
      given.push(next, streamed, copy);
    }

    // Each kind was given to the thread: the replies, their edits and the copies.
    expect(given).toHaveLength(15);
    expect(given.every((event) => event.getThread() === thread)).toBe(true);
    expect(listeners()).toBe(before);
  });

  it('still lets the room hear the thread update', async () => {
    const { room, thread } = await threadWithReply();
    const heard = vi.fn();
    room.on(ThreadEvent.Update, heard);

    thread.emit(ThreadEvent.Update, thread);

    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0]?.[0]).toBe(thread);
  });
});
