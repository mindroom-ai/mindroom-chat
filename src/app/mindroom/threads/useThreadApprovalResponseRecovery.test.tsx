// @vitest-environment jsdom
import React from 'react';
import { createClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { createBackfillScheduler } from '../engine/backfillScheduler';
import { collectThreadApprovals } from '../messages/threadApprovalModel';
import { planThreadApprovalTimeline } from './threadApprovalTimeline';
import { useThreadApprovalResponseRecovery } from './useThreadApprovalResponseRecovery';
import { useThreadRenderState } from './useThreadRenderState';

const roomId = '!room:example.org';
const threadId = '$thread';
const reply = (id: string, body: string, target = threadId): Partial<IEvent> => ({
  event_id: id,
  room_id: roomId,
  sender: '@assistant:example.org',
  origin_server_ts: 2,
  type: 'm.room.message',
  content: {
    body,
    msgtype: 'm.text',
    'm.relates_to': { rel_type: 'm.thread', event_id: target },
  },
});
const response = (): Partial<IEvent> => ({
  ...reply('$response', 'Thinking...'),
  unsigned: {
    'm.relations': {
      'm.replace': {
        ...reply('$completed', '* Saved the note.'),
        origin_server_ts: 4,
        content: {
          'm.relates_to': { rel_type: 'm.replace', event_id: '$response' },
          'm.new_content': { msgtype: 'm.text', body: 'Saved the note.' },
        },
      },
    },
  },
});
const approval = (id = '$approval', responseId = '$response') =>
  new MatrixEvent({
    ...reply(id, ''),
    type: 'io.mindroom.tool_approval',
    sender: '@router:example.org',
    origin_server_ts: 3,
    content: {
      'm.relates_to': { rel_type: 'm.thread', event_id: threadId },
      approval_id: id,
      tool_name: 'save_note',
      arguments: {},
      agent_name: 'assistant',
      status: 'approved',
      thread_id: threadId,
      response_event_id: responseId,
      requested_at: '2026-09-01T12:00:00Z',
      expires_at: '2026-09-01T12:30:00Z',
    },
  });

const renderers: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => renderers.splice(0).forEach((renderer) => renderer.unmount()));
});

const setup = (extra: MatrixEvent[] = [], cacheOnly = false) => {
  const mx = createClient({ baseUrl: 'https://matrix.example.org', threadSupport: true });
  // startClient normally enables this; leave the sync network stopped in this test.
  mx.supportsThreads = () => true;
  const room = new Room(roomId, mx, '@alice:example.org');
  mx.store.storeRoom(room);
  const root = new MatrixEvent({
    ...reply(threadId, 'Save a note'),
    content: { body: 'Save a note' },
  });
  const initialEvents = [new MatrixEvent(reply('$human', 'Yes, please.')), approval(), ...extra];
  const thread = cacheOnly ? undefined : room.createThread(threadId, root, initialEvents, false);
  const scheduler = createBackfillScheduler({ mx });
  const persist = vi.fn();
  const fetch = vi.spyOn(mx, 'fetchRoomEvent').mockResolvedValue(response() as IEvent);
  const delivered = vi.fn();
  function Harness({ target = threadId }: { target?: string }) {
    const { threadEvents: events, setSupplementalThreadEvents } = useThreadRenderState({
      room,
      threadId: target,
      thread: room.getThread(target),
      roomTimelineSet: room.getUnfilteredTimelineSet(),
      threadTimelineSet: room.getThread(target)?.getUnfilteredTimelineSet(),
      threadInitialCacheHydrated: true,
    });
    React.useLayoutEffect(() => {
      if (cacheOnly && target === threadId) setSupplementalThreadEvents(target, initialEvents);
    }, [target, setSupplementalThreadEvents]);
    const plan = planThreadApprovalTimeline(
      collectThreadApprovals(events, roomId, target),
      events,
      new Set(),
      new Set(),
      target
    );
    const recovered = React.useCallback(
      (id: string, incoming: MatrixEvent[]) => {
        delivered(id, incoming);
        setSupplementalThreadEvents(id, incoming);
      },
      [setSupplementalThreadEvents]
    );
    useThreadApprovalResponseRecovery({
      mx,
      room,
      threadId: target,
      scheduler,
      persist,
      events,
      fallbackGroups: plan.fallbackGroupsByEventId,
      onRecovered: recovered,
    });
    return (
      <>
        <span data-fallback>{plan.fallbackGroupsByEventId.size}</span>
        {events
          .filter((event) => event.getType() === 'm.room.message')
          .map((event) => (
            <span key={event.getId()} data-event={event.getId()}>
              {event.getContent().body}
            </span>
          ))}
      </>
    );
  }
  const mount = async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Harness />);
    });
    renderers.push(renderer);
    return renderer;
  };
  return { mx, room, thread, scheduler, persist, fetch, delivered, Harness, mount };
};

it('recovers a missing completed reply and replaces the approval-only fallback without reload', async () => {
  const fixture = setup();
  const renderer = await fixture.mount();
  expect(fixture.fetch).toHaveBeenCalledWith(roomId, '$response');
  expect(renderer.root.findByProps({ 'data-event': '$response' }).children).toEqual([
    'Saved the note.',
  ]);
  expect(renderer.root.findByProps({ 'data-fallback': true }).children).toEqual(['0']);
  expect(fixture.thread?.findEventById('$response')?.getContent().body).toBe('Saved the note.');
  expect(fixture.persist).toHaveBeenCalledTimes(1);
});

it.each([false, true])('does not fetch an existing response (redacted: %s)', async (redacted) => {
  const raw = response();
  if (redacted) {
    // Modern room versions retain the thread relation after redaction.
    raw.content = { 'm.relates_to': { rel_type: 'm.thread', event_id: threadId } };
    raw.unsigned = {
      redacted_because: { type: 'm.room.redaction', redacts: '$response', content: {} },
    };
  }
  const existing = new MatrixEvent(raw);
  const fixture = setup([existing]);
  await fixture.mount();
  expect(fixture.fetch).not.toHaveBeenCalled();
});

it('retries a failed recovery when the app resumes, without a reload', async () => {
  const fixture = setup();
  fixture.fetch.mockRejectedValueOnce(new Error('Offline'));
  const renderer = await fixture.mount();
  expect(renderer.root.findByProps({ 'data-fallback': true }).children).toEqual(['1']);
  await act(async () => {
    window.dispatchEvent(new Event('online'));
  });
  expect(renderer.root.findByProps({ 'data-event': '$response' }).children).toEqual([
    'Saved the note.',
  ]);
  expect(fixture.fetch).toHaveBeenCalledTimes(2);
});

it('retries on thread reopen while keeping the same populated SDK thread', async () => {
  const fixture = setup();
  fixture.fetch.mockRejectedValueOnce(new Error('Offline'));
  const renderer = await fixture.mount();
  await act(async () => {
    renderer.unmount();
  });
  const reopened = await fixture.mount();
  expect(reopened.root.findByProps({ 'data-event': '$response' }).children).toEqual([
    'Saved the note.',
  ]);
  expect(fixture.fetch).toHaveBeenCalledTimes(2);
});

it.each(['foreign thread', 'foreign room', 'wrong event', 'redacted', 'wrong type'])(
  'does not inject a fetched %s response',
  async (kind) => {
    const fixture = setup();
    const raw = response();
    if (kind === 'foreign thread') raw.content = reply('$response', 'Other', '$other').content;
    if (kind === 'foreign room') raw.room_id = '!other:example.org';
    if (kind === 'wrong event') raw.event_id = '$other';
    if (kind === 'wrong type') raw.type = 'io.mindroom.tool_approval';
    if (kind === 'redacted') {
      raw.content = {};
      raw.unsigned = {
        redacted_because: { type: 'm.room.redaction', content: {}, redacts: '$response' },
      };
    }
    fixture.fetch.mockResolvedValue(raw as IEvent);
    const renderer = await fixture.mount();
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
    expect(fixture.persist).not.toHaveBeenCalled();
    expect(fixture.delivered).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ 'data-fallback': true }).children).toEqual(['1']);
  }
);

it('does not deliver an old recovery after navigating to another thread', async () => {
  const fixture = setup();
  let resolve!: (value: IEvent) => void;
  fixture.fetch.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    })
  );
  const renderer = await fixture.mount();
  await act(async () => {
    renderer.update(<fixture.Harness target="$other" />);
  });
  await act(async () => {
    resolve(response() as IEvent);
  });
  expect(fixture.delivered).not.toHaveBeenCalled();
  // Engine-owned work can finish for the old thread, but never enters the new view.
  expect(fixture.persist.mock.calls.map((call) => call[1])).toEqual([threadId]);
  expect(renderer.root.findAllByProps({ 'data-event': '$response' })).toHaveLength(0);
});

it('fetches a newly referenced reply after deduplicating against an older in-flight request', async () => {
  const fixture = setup();
  let resolve!: (value: IEvent) => void;
  fixture.fetch.mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    })
  );
  fixture.fetch.mockResolvedValue(reply('$second', 'Second note saved.') as IEvent);
  const renderer = await fixture.mount();
  await act(async () => {
    fixture.thread!.addEvents([approval('$second-approval', '$second')], false);
  });
  await act(async () => {
    resolve(response() as IEvent);
  });
  expect(fixture.fetch.mock.calls).toEqual([
    [roomId, '$response'],
    [roomId, '$second'],
  ]);
  expect(renderer.root.findByProps({ 'data-event': '$response' }).children).toEqual([
    'Saved the note.',
  ]);
  expect(renderer.root.findByProps({ 'data-event': '$second' }).children).toEqual([
    'Second note saved.',
  ]);
  expect(renderer.root.findByProps({ 'data-fallback': true }).children).toEqual(['0']);
});

it('continues past a missing reply without retrying it on unrelated renders', async () => {
  const fixture = setup([approval('$second-approval', '$second')]);
  fixture.fetch.mockRejectedValueOnce(new Error('Not found'));
  fixture.fetch.mockResolvedValue(reply('$second', 'Second note saved.') as IEvent);
  const renderer = await fixture.mount();
  await act(async () => {
    renderer.update(<fixture.Harness />);
  });
  expect(fixture.fetch.mock.calls).toEqual([
    [roomId, '$response'],
    [roomId, '$second'],
  ]);
  expect(renderer.root.findByProps({ 'data-event': '$second' }).children).toEqual([
    'Second note saved.',
  ]);
  expect(renderer.root.findByProps({ 'data-fallback': true }).children).toEqual(['1']);
});

it("lets a reopened thread receive the previous visit's in-flight reply", async () => {
  const fixture = setup();
  let resolve!: (value: IEvent) => void;
  fixture.fetch.mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    })
  );
  const renderer = await fixture.mount();
  await act(async () => {
    renderer.unmount();
  });
  const reopened = await fixture.mount();
  await act(async () => {
    resolve(response() as IEvent);
  });
  expect(fixture.fetch).toHaveBeenCalledTimes(1);
  expect(reopened.root.findByProps({ 'data-event': '$response' }).children).toEqual([
    'Saved the note.',
  ]);
  expect(reopened.root.findByProps({ 'data-fallback': true }).children).toEqual(['0']);
});

it('recovers into a cache-only view without creating an SDK thread', async () => {
  const fixture = setup([], true);
  const renderer = await fixture.mount();
  expect(fixture.room.getThread(threadId)).toBeNull();
  expect(fixture.delivered).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByProps({ 'data-event': '$response' }).children).toEqual([
    'Saved the note.',
  ]);
  expect(renderer.root.findByProps({ 'data-fallback': true }).children).toEqual(['0']);
});
