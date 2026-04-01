import React from 'react';
import { EventTimelineSet, MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useThreadRenderState } from './useThreadRenderState';

const makeMessageEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org',
  body = 'original'
) =>
  new MatrixEvent({
    content: {
      body,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeEditEvent = (
  eventId: string,
  ts: number,
  targetEventId: string,
  sender = '@alice:example.org'
) =>
  new MatrixEvent({
    content: {
      body: `* ${eventId}`,
      'm.new_content': {
        body: eventId,
        msgtype: 'm.text',
      },
      'm.relates_to': {
        event_id: targetEventId,
        rel_type: 'm.replace',
      },
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const attachSerializedReplacement = (
  targetEvent: MatrixEvent,
  replacementEventId: string,
  ts: number
) => {
  targetEvent.event.unsigned = {
    'm.relations': {
      'm.replace': {
        content: {
          body: `* ${replacementEventId}`,
          'm.new_content': {
            body: replacementEventId,
            msgtype: 'm.text',
          },
          'm.relates_to': {
            event_id: targetEvent.getId(),
            rel_type: 'm.replace',
          },
          msgtype: 'm.text',
        },
        event_id: replacementEventId,
        origin_server_ts: ts,
        room_id: '!room:example.org',
        sender: '@alice:example.org',
        type: 'm.room.message',
      },
    },
  };
};

type HookSnapshot = ReturnType<typeof useThreadRenderState>;

type HarnessProps = {
  room: Room;
  roomTimelineSet: EventTimelineSet;
  threadTimelineSet?: EventTimelineSet;
  threadId?: string;
  thread: Thread | null;
  threadInitialCacheHydrated: boolean;
  onRender: (snapshot: HookSnapshot) => void;
};

function Harness({ onRender, ...props }: HarnessProps) {
  const snapshot = useThreadRenderState(props);
  onRender(snapshot);
  return null;
}

const makeTimelineSet = (): EventTimelineSet =>
  ({
    relations: {
      aggregateChildEvent: vi.fn(),
    },
  } as unknown as EventTimelineSet);

const makeRoom = (
  rootEvent?: MatrixEvent,
  txnMap?: Map<string, MatrixEvent>
): Room =>
  ({
    findEventById: vi.fn((eventId: string) =>
      rootEvent?.getId() === eventId ? rootEvent : undefined
    ),
    getEventForTxnId: vi.fn((txnId: string) => txnMap?.get(txnId)),
  } as unknown as Room);

const makeThread = (rootEvent: MatrixEvent, events: MatrixEvent[]): Thread =>
  ({
    rootEvent,
    events,
  } as unknown as Thread);

const renderHookHarness = (props: Omit<HarnessProps, 'onRender'>): {
  getSnapshot: () => HookSnapshot;
  update: (nextProps: Omit<HarnessProps, 'onRender'>) => void;
  renderer: ReactTestRenderer;
} => {
  let latestSnapshot: HookSnapshot | undefined;
  const onRender = (snapshot: HookSnapshot) => {
    latestSnapshot = snapshot;
  };

  const renderer = create(React.createElement(Harness, { ...props, onRender }));

  return {
    getSnapshot: () => {
      if (!latestSnapshot) {
        throw new Error('Hook snapshot was not captured');
      }
      return latestSnapshot;
    },
    update: (nextProps) => {
      act(() => {
        renderer.update(React.createElement(Harness, { ...nextProps, onRender }));
      });
    },
    renderer,
  };
};

describe('useThreadRenderState', () => {
  it('renders cached fallback events before initial cache hydration finishes', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const replyEvent = makeMessageEvent('$reply', 2);
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread: null,
      threadInitialCacheHydrated: false,
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('loading');
    expect(getSnapshot().threadEvents).toEqual([]);

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [replyEvent]);
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('cached');
    expect(getSnapshot().threadEvents).toEqual([replyEvent]);
    expect(getSnapshot().threadEventIndexMapRef.current.get('$reply')).toBe(0);

    renderer.unmount();
  });

  it('keeps the richer fallback event when live thread hydration brings a stale duplicate', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const staleLiveReply = makeMessageEvent('$reply', 2);
    const correctedFallbackReply = makeMessageEvent('$reply', 2);
    correctedFallbackReply.makeReplaced(makeEditEvent('$edit-2', 3, '$reply'));
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, [staleLiveReply]);

    const { getSnapshot, update, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [correctedFallbackReply]);
    });

    update({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('live');
    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual([
      '$root',
      '$reply',
    ]);
    expect(getSnapshot().threadEvents[1]).toBe(correctedFallbackReply);
    expect(getSnapshot().threadEvents[1].replacingEvent()?.getId()).toBe('$edit-2');

    renderer.unmount();
  });

  it('prefers a cached fallback event when it carries a newer bundled replacement than the live duplicate', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const staleLiveReply = makeMessageEvent('$reply', 2);
    staleLiveReply.makeReplaced(makeEditEvent('$edit-8', 8, '$reply'));
    const refetchedFallbackReply = makeMessageEvent('$reply', 2);
    attachSerializedReplacement(refetchedFallbackReply, '$edit-13', 13);
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, [staleLiveReply]);

    const { getSnapshot, update, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [refetchedFallbackReply]);
    });

    update({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual([
      '$root',
      '$reply',
    ]);
    expect(getSnapshot().threadEvents[1]).toBe(refetchedFallbackReply);
    expect(getSnapshot().threadEvents[1].replacingEvent()?.getId()).toBe('$edit-13');

    renderer.unmount();
  });

  it('rehydrates serialized replacements from cached fallback events', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const cachedReply = new MatrixEvent({
      content: {
        body: 'Thinking...  ⋯',
        msgtype: 'm.text',
      },
      event_id: '$reply',
      origin_server_ts: 2,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
      unsigned: {
        'm.relations': {
          'm.replace': {
            content: {
              body: '* Final answer',
              'm.new_content': {
                body: 'Final answer',
                msgtype: 'm.text',
              },
              'm.relates_to': {
                event_id: '$reply',
                rel_type: 'm.replace',
              },
              msgtype: 'm.text',
            },
            event_id: '$edit-1',
            origin_server_ts: 3,
            room_id: '!room:example.org',
            sender: '@alice:example.org',
            type: 'm.room.message',
          },
        },
      },
    });
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread: null,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [cachedReply]);
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('cached');
    expect(getSnapshot().threadEvents[0].getId()).toBe('$reply');
    expect(getSnapshot().threadEvents[0].replacingEvent()?.getId()).toBe('$edit-1');

    renderer.unmount();
  });

  it('deduplicates a confirmed thread event when cached and live copies disagree on transaction metadata', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const cachedReply = makeMessageEvent('$reply', 2);
    cachedReply.event.unsigned = { transaction_id: 'txn-4' };
    const liveReply = makeMessageEvent('$reply', 2);
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, [liveReply]);

    const { getSnapshot, update, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [cachedReply]);
    });

    update({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    expect(getSnapshot().threadEvents.map((event) => event.getId())).toEqual(['$root', '$reply']);

    renderer.unmount();
  });

  it('deduplicates local echo against confirmed event from /relations when room resolves the confirmed id', () => {
    const rootEvent = makeMessageEvent('$root', 1);

    // Local echo: still has ~-prefix ID, txnId set
    const localEcho = makeMessageEvent('~local-txn-5', 2);
    localEcho.setTxnId('txn-5');

    // Simulate updatePendingEvent having updated the local echo's ID
    const localEchoAfterSent = makeMessageEvent('$reply', 2);
    localEchoAfterSent.setTxnId('txn-5');

    // Confirmed event from /relations API — no transaction_id
    const confirmedReply = makeMessageEvent('$reply', 2);

    const txnMap = new Map<string, MatrixEvent>([['txn-5', localEchoAfterSent]]);
    const room = makeRoom(rootEvent, txnMap);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, [confirmedReply]);

    const { getSnapshot, update, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: false,
    });

    // Supplemental events include the local echo (from timeline listener)
    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [localEcho]);
    });

    update({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    // Should deduplicate: local echo and confirmed reply are the same message
    expect(getSnapshot().threadEvents.map((e) => e.getId())).toEqual(['$root', '$reply']);

    renderer.unmount();
  });

  it('deduplicates local echo against confirmed event in setSupplementalThreadEvents via fallback resolver', () => {
    const rootEvent = makeMessageEvent('$root', 1);

    // Local echo with txnId
    const localEcho = makeMessageEvent('~local-txn-7', 2);
    localEcho.setTxnId('txn-7');

    // Confirmed event with unsigned.transaction_id (from cache/API)
    const confirmedReply = makeMessageEvent('$confirmed-7', 2);
    confirmedReply.event.unsigned = { transaction_id: 'txn-7' };

    // Room does NOT resolve txnId (simulates cold reload)
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread: null,
      threadInitialCacheHydrated: false,
    });

    // First supplemental batch: the local echo
    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [localEcho]);
    });

    // Second supplemental batch: the confirmed reply with txn metadata
    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [confirmedReply]);
    });

    // Should deduplicate: only the confirmed event survives
    expect(getSnapshot().threadEvents.map((e) => e.getId())).toEqual(['$confirmed-7']);

    renderer.unmount();
  });

  it('composed resolver falls back to event-derived txnId map when room.getEventForTxnId returns undefined', () => {
    const rootEvent = makeMessageEvent('$root', 1);

    // Local echo
    const localEcho = makeMessageEvent('~local-txn-8', 2);
    localEcho.setTxnId('txn-8');

    // Confirmed event from /relations with unsigned.transaction_id
    const confirmedReply = makeMessageEvent('$confirmed-8', 2);
    confirmedReply.event.unsigned = { transaction_id: 'txn-8' };

    // Room does NOT know about txn-8 (cold reload scenario)
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();
    const thread = makeThread(rootEvent, [confirmedReply]);

    const { getSnapshot, update, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: false,
    });

    // Supplemental: add local echo (from cached events)
    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [localEcho]);
    });

    // Hydrate live thread
    update({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread,
      threadInitialCacheHydrated: true,
    });

    // Should deduplicate via fallback resolver
    expect(getSnapshot().threadEvents.map((e) => e.getId())).toEqual(['$root', '$confirmed-8']);

    renderer.unmount();
  });

  it('resets supplemental thread state cleanly', () => {
    const rootEvent = makeMessageEvent('$root', 1);
    const replyEvent = makeMessageEvent('$reply', 2);
    const room = makeRoom(rootEvent);
    const roomTimelineSet = makeTimelineSet();

    const { getSnapshot, renderer } = renderHookHarness({
      room,
      roomTimelineSet,
      threadTimelineSet: undefined,
      threadId: '$root',
      thread: null,
      threadInitialCacheHydrated: false,
    });

    act(() => {
      getSnapshot().setSupplementalThreadEvents('$root', [replyEvent]);
    });
    expect(getSnapshot().threadEvents).toEqual([replyEvent]);

    act(() => {
      getSnapshot().resetThreadRenderState('$root');
    });

    expect(getSnapshot().threadInitialRenderMode).toBe('loading');
    expect(getSnapshot().threadEvents).toEqual([]);
    expect(getSnapshot().threadEventIndexMapRef.current.size).toBe(0);

    renderer.unmount();
  });
});
