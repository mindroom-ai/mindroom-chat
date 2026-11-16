import { createClient, MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  summarizeLoadedThreadCost,
  summarizeThreadConversationCost,
} from './threadConversationCost';

const AGENT = '@mindroom_code:example.org';
const PERSON = '@alice:example.org';

const message = (id: string, sender: string, usd?: string, extra: Record<string, unknown> = {}) =>
  new MatrixEvent({
    type: 'm.room.message',
    event_id: id,
    room_id: '!room:example.org',
    sender,
    content: {
      msgtype: 'm.text',
      body: id,
      ...(usd === undefined
        ? {}
        : { 'io.mindroom.ai_run': { version: 1, status: 'completed', cost: { usd } } }),
      ...extra,
    },
  });

const edit = (id: string, targetId: string, usd: string) =>
  new MatrixEvent({
    type: 'm.room.message',
    event_id: id,
    room_id: '!room:example.org',
    sender: AGENT,
    content: {
      msgtype: 'm.text',
      body: '* edited',
      'm.new_content': {
        msgtype: 'm.text',
        body: 'edited',
        'io.mindroom.ai_run': { version: 1, status: 'completed', cost: { usd } },
      },
      'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
    },
  });

const loaded = { sdkLoaded: true, canPaginateBack: false, hasMoreCachedBack: false };
const isTrustedSender = (userId: string) => userId === AGENT;

describe('summarizeThreadConversationCost', () => {
  it('sums priced agent replies in order', () => {
    const cost = summarizeThreadConversationCost(
      [message('$root', PERSON), message('$r1', AGENT, '0.01'), message('$r2', AGENT, '0.02')],
      { history: loaded, isTrustedSender }
    );

    expect(cost?.byEventId.get('$r1')).toEqual({ usd: 0.01, replyCount: 1 });
    expect(cost?.byEventId.get('$r2')?.usd).toBeCloseTo(0.03);
    expect(cost?.byEventId.get('$r2')?.replyCount).toBe(2);
    expect(cost?.replies).toEqual([
      { eventId: '$r1', usd: 0.01 },
      { eventId: '$r2', usd: 0.02 },
    ]);
  });

  it("uses the latest edit's cost", () => {
    const original = message('$r1', AGENT);
    const latest = edit('$e1', '$r1', '0.5');
    const cost = summarizeThreadConversationCost([original, latest], {
      history: loaded,
      isTrustedSender,
      getContent: (event) =>
        event === original
          ? (latest.getContent()['m.new_content'] as Record<string, unknown>)
          : event.getContent(),
    });

    expect(cost?.byEventId.get('$r1')).toEqual({ usd: 0.5, replyCount: 1 });
    expect(cost?.byEventId.has('$e1')).toBe(false);
  });

  it('ignores costs from non-agent senders', () => {
    const cost = summarizeThreadConversationCost(
      [message('$r1', AGENT, '0.01'), message('$fake', PERSON, '100')],
      { history: loaded, isTrustedSender }
    );

    expect(cost?.replies).toEqual([{ eventId: '$r1', usd: 0.01 }]);
    expect(cost?.byEventId.has('$fake')).toBe(false);
  });

  it('ignores costs from ignored senders', () => {
    const cost = summarizeThreadConversationCost([message('$r1', AGENT, '0.01')], {
      history: loaded,
      isTrustedSender,
      ignoredUserIds: new Set([AGENT]),
    });

    expect(cost).toBeUndefined();
  });

  it('skips replies without cost', () => {
    const cost = summarizeThreadConversationCost(
      [message('$r1', AGENT), message('$r2', AGENT, '0.02')],
      { history: loaded, isTrustedSender }
    );

    expect(cost?.replies).toEqual([{ eventId: '$r2', usd: 0.02 }]);
    expect(cost?.byEventId.has('$r1')).toBe(false);
  });

  it('returns undefined when nothing is priced', () => {
    expect(
      summarizeThreadConversationCost([message('$root', PERSON), message('$r1', AGENT)], {
        history: loaded,
        isTrustedSender,
      })
    ).toBeUndefined();
  });

  it('is complete only once the thread start is loaded', () => {
    const events = [message('$r1', AGENT, '0.01')];
    const options = { isTrustedSender };

    expect(summarizeThreadConversationCost(events, { ...options, history: loaded })?.complete).toBe(
      true
    );
    [
      { ...loaded, sdkLoaded: false },
      { ...loaded, canPaginateBack: true },
      { ...loaded, hasMoreCachedBack: true },
    ].forEach((history) => {
      expect(summarizeThreadConversationCost(events, { ...options, history })?.complete).toBe(
        false
      );
    });
  });
});

describe('summarizeLoadedThreadCost', () => {
  const ROOM_ID = '!room:example.org';
  const inThread = (event: MatrixEvent) =>
    new MatrixEvent({
      ...event.event,
      content: {
        ...event.getContent(),
        'm.relates_to': { rel_type: RelationType.Thread, event_id: '$root' },
      },
    });
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
  });

  afterEach(() => {
    Thread.hasServerSideSupport = previousThreadSupport;
    vi.restoreAllMocks();
  });

  const setup = async (replies: MatrixEvent[], { fetched = false } = {}) => {
    const mx = createClient({ baseUrl: 'https://example.org', userId: PERSON });
    vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
    vi.spyOn(mx.http, 'authedRequest').mockResolvedValue({ chunk: [] });
    const room = new Room(ROOM_ID, mx, PERSON);
    mx.store.storeRoom(room);
    const root = message('$root', PERSON);
    room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
    const thread = room.createThread('$root', root, [], false);
    if (fetched) await thread.initialize();
    thread.addEvents(replies.map(inThread), false);
    await vi.waitFor(() => expect(thread.events.length).toBeGreaterThanOrEqual(replies.length));
    return thread;
  };

  it("sums the agents' priced replies the thread holds, as a lower bound until it is fetched", async () => {
    const thread = await setup([
      message('$r1', AGENT, '0.25'),
      message('$fake', PERSON, '9'),
      message('$r2', AGENT, '1'),
    ]);

    const cost = summarizeLoadedThreadCost(thread, PERSON);

    expect(cost?.replies).toEqual([
      { eventId: '$r1', usd: 0.25 },
      { eventId: '$r2', usd: 1 },
    ]);
    expect(cost?.complete).toBe(false);
  });

  it('is complete once the thread is fetched with no older page', async () => {
    const thread = await setup([message('$r1', AGENT, '0.25')], { fetched: true });

    expect(summarizeLoadedThreadCost(thread, PERSON)?.complete).toBe(true);
  });

  it('is undefined when no reply is priced', async () => {
    const thread = await setup([message('$r1', AGENT)]);

    expect(summarizeLoadedThreadCost(thread, PERSON)).toBeUndefined();
  });
});
