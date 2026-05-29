import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  buildResolveConfirmedEventId,
  dedupeThreadRenderEventEntries,
  getThreadInitialRenderMode,
  mergeThreadRenderEvents,
  pickPreferredThreadRenderEvent,
  shouldPinThreadToBottomOnOpen,
} from './threadRenderUtils';

const makeMessageEvent = (eventId: string, ts = 1) =>
  new MatrixEvent({
    content: {
      body: 'hello',
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

const makeLocalEchoPair = (txnId: string) => {
  const localEcho = makeMessageEvent(`~local-${txnId}`, 10);
  localEcho.setTxnId(txnId);

  const remoteEcho = makeMessageEvent(`$remote-${txnId}`, 10);
  remoteEcho.event.unsigned = {
    transaction_id: txnId,
  };

  return { localEcho, remoteEcho };
};

const makeEditEvent = (targetEventId: string, editEventId: string, ts: number) =>
  new MatrixEvent({
    content: {
      body: '* edited',
      'm.new_content': {
        body: `edited ${ts}`,
        msgtype: 'm.text',
      },
      'm.relates_to': {
        event_id: targetEventId,
        rel_type: 'm.replace',
      },
      msgtype: 'm.text',
    },
    event_id: editEventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

const attachSerializedReplacement = (
  targetEvent: MatrixEvent,
  replacementEventId: string,
  ts?: number,
  sender = '@alice:example.org'
) => {
  targetEvent.event.unsigned = {
    'm.relations': {
      'm.replace': {
        content: {
          body: '* edited',
          'm.new_content': {
            body: `edited ${ts}`,
            msgtype: 'm.text',
          },
          'm.relates_to': {
            event_id: targetEvent.getId(),
            rel_type: 'm.replace',
          },
          msgtype: 'm.text',
        },
        event_id: replacementEventId,
        ...(typeof ts === 'number' ? { origin_server_ts: ts } : {}),
        room_id: '!room:example.org',
        sender,
        type: 'm.room.message',
      },
    },
  };
};

const makeRoom = (txnMap?: Map<string, MatrixEvent>) =>
  ({
    getEventForTxnId: (txnId: string) => txnMap?.get(txnId),
  } as never);

describe('getThreadInitialRenderMode', () => {
  it('uses the live render path outside thread view', () => {
    expect(
      getThreadInitialRenderMode({
        threadId: undefined,
        initialCacheHydrated: false,
        fallbackEventCount: 0,
      })
    ).toBe('live');
  });

  it('shows a loading state until the initial thread cache lookup completes', () => {
    expect(
      getThreadInitialRenderMode({
        threadId: '$thread',
        initialCacheHydrated: false,
        fallbackEventCount: 0,
      })
    ).toBe('loading');
  });

  it('renders cached thread events ahead of provisional live events during initial hydration', () => {
    expect(
      getThreadInitialRenderMode({
        threadId: '$thread',
        initialCacheHydrated: false,
        fallbackEventCount: 3,
      })
    ).toBe('cached');
  });

  it('switches back to the live render path after cache hydration finishes', () => {
    expect(
      getThreadInitialRenderMode({
        threadId: '$thread',
        initialCacheHydrated: true,
        fallbackEventCount: 0,
      })
    ).toBe('live');
  });
});

describe('pickPreferredThreadRenderEvent', () => {
  it('prefers the confirmed remote event over a local echo with the same transaction id', () => {
    const { localEcho, remoteEcho } = makeLocalEchoPair('txn-1');

    expect(pickPreferredThreadRenderEvent(localEcho, remoteEcho)).toBe(remoteEcho);
    expect(pickPreferredThreadRenderEvent(remoteEcho, localEcho)).toBe(remoteEcho);
  });

  it('keeps the existing event when it already has the newer edit applied', () => {
    const existingEvent = makeMessageEvent('$target');
    const incomingEvent = makeMessageEvent('$target');
    existingEvent.makeReplaced(makeEditEvent('$target', '$edit-2', 2));

    expect(pickPreferredThreadRenderEvent(existingEvent, incomingEvent)).toBe(existingEvent);
  });

  it('takes the incoming event when it has the newer edit applied', () => {
    const existingEvent = makeMessageEvent('$target');
    const incomingEvent = makeMessageEvent('$target');
    existingEvent.makeReplaced(makeEditEvent('$target', '$edit-2', 2));
    incomingEvent.makeReplaced(makeEditEvent('$target', '$edit-3', 3));

    expect(pickPreferredThreadRenderEvent(existingEvent, incomingEvent)).toBe(incomingEvent);
  });

  it('prefers an incoming event with a newer bundled replacement over a stale live edit', () => {
    const existingEvent = makeMessageEvent('$target');
    const incomingEvent = makeMessageEvent('$target');
    existingEvent.makeReplaced(makeEditEvent('$target', '$edit-8', 8));
    attachSerializedReplacement(incomingEvent, '$edit-13', 13);

    expect(pickPreferredThreadRenderEvent(existingEvent, incomingEvent)).toBe(incomingEvent);
  });

  it('ignores bundled replacements without origin_server_ts when picking the preferred event', () => {
    const existingEvent = makeMessageEvent('$target');
    const incomingEvent = makeMessageEvent('$target');
    existingEvent.makeReplaced(makeEditEvent('$target', '$edit-8', 8));
    attachSerializedReplacement(incomingEvent, '$edit-13');

    expect(pickPreferredThreadRenderEvent(existingEvent, incomingEvent)).toBe(existingEvent);
  });

  it('ignores bundled replacements from other senders when picking the preferred event', () => {
    const existingEvent = makeMessageEvent('$target');
    const incomingEvent = makeMessageEvent('$target');
    existingEvent.makeReplaced(makeEditEvent('$target', '$edit-8', 8));
    attachSerializedReplacement(incomingEvent, '$edit-13', 13, '@mallory:example.org');

    expect(pickPreferredThreadRenderEvent(existingEvent, incomingEvent)).toBe(existingEvent);
  });
});

describe('shouldPinThreadToBottomOnOpen', () => {
  it('pins a plain thread open once cached or live events are ready to render', () => {
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: true,
        threadInitialRenderMode: 'cached',
        threadEventCount: 3,
      })
    ).toBe(true);
  });

  it('does not pin while the initial thread render is still loading', () => {
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: true,
        threadInitialRenderMode: 'loading',
        threadEventCount: 3,
      })
    ).toBe(false);
  });

  it('does not pin targeted thread opens or empty thread renders', () => {
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: false,
        threadInitialRenderMode: 'live',
        threadEventCount: 3,
      })
    ).toBe(false);
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: true,
        threadInitialRenderMode: 'live',
        threadEventCount: 0,
      })
    ).toBe(false);
  });

  it('does not pin while thread back-pagination suppresses open-bottom pinning', () => {
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: true,
        threadInitialRenderMode: 'live',
        threadEventCount: 3,
        suppressOpenBottomPin: true,
      })
    ).toBe(false);
  });
});

describe('mergeThreadRenderEvents', () => {
  it('does not overwrite a corrected cached event with a stale duplicate', () => {
    const correctedEvent = makeMessageEvent('$target');
    correctedEvent.makeReplaced(makeEditEvent('$target', '$edit-2', 2));
    const staleDuplicate = makeMessageEvent('$target');

    expect(mergeThreadRenderEvents([correctedEvent], [staleDuplicate])).toEqual([correctedEvent]);
  });

  it('deduplicates local echo and confirmed thread events using transaction id', () => {
    const { localEcho, remoteEcho } = makeLocalEchoPair('txn-2');

    expect(mergeThreadRenderEvents([localEcho], [remoteEcho])).toEqual([remoteEcho]);
    expect(mergeThreadRenderEvents([remoteEcho], [localEcho])).toEqual([remoteEcho]);
  });

  it('deduplicates identical remote events even when only one copy still carries the transaction id', () => {
    const confirmedWithTxn = makeMessageEvent('$remote', 10);
    confirmedWithTxn.event.unsigned = { transaction_id: 'txn-3' };
    const confirmedWithoutTxn = makeMessageEvent('$remote', 10);

    expect(mergeThreadRenderEvents([confirmedWithTxn], [confirmedWithoutTxn])).toEqual([
      confirmedWithoutTxn,
    ]);
    expect(mergeThreadRenderEvents([confirmedWithoutTxn], [confirmedWithTxn])).toEqual([
      confirmedWithTxn,
    ]);
  });

  it('deduplicates local echo and confirmed event when confirmed lacks transaction_id but resolver provides the link', () => {
    const localEcho = makeMessageEvent('~local-txn-4', 10);
    localEcho.setTxnId('txn-4');
    const confirmed = makeMessageEvent('$remote-txn-4', 10);

    const resolver = (txnId: string) => (txnId === 'txn-4' ? '$remote-txn-4' : undefined);

    expect(mergeThreadRenderEvents([], [localEcho, confirmed], resolver)).toEqual([confirmed]);
    expect(mergeThreadRenderEvents([], [confirmed, localEcho], resolver)).toEqual([confirmed]);
    expect(mergeThreadRenderEvents([localEcho], [confirmed], resolver)).toEqual([confirmed]);
    expect(mergeThreadRenderEvents([confirmed], [localEcho], resolver)).toEqual([confirmed]);
  });

  it('keeps both events when resolver returns undefined (no confirmed id known)', () => {
    const localEcho = makeMessageEvent('~local-txn-5', 10);
    localEcho.setTxnId('txn-5');
    const unrelated = makeMessageEvent('$other', 10);

    const resolver = () => undefined;

    const result = mergeThreadRenderEvents([], [localEcho, unrelated], resolver);
    expect(result).toHaveLength(2);
  });

  it('deduplicates multiple local echoes each with their own confirmed counterpart', () => {
    const echo1 = makeMessageEvent('~local-a', 10);
    echo1.setTxnId('txn-a');
    const confirmed1 = makeMessageEvent('$remote-a', 10);

    const echo2 = makeMessageEvent('~local-b', 20);
    echo2.setTxnId('txn-b');
    const confirmed2 = makeMessageEvent('$remote-b', 20);

    const resolver = (txnId: string) => {
      if (txnId === 'txn-a') return '$remote-a';
      if (txnId === 'txn-b') return '$remote-b';
      return undefined;
    };

    const result = mergeThreadRenderEvents([], [echo1, confirmed1, echo2, confirmed2], resolver);
    expect(result).toEqual([confirmed1, confirmed2]);
  });

  it('resolver does not affect non-local-echo events', () => {
    const confirmed = makeMessageEvent('$remote', 10);
    confirmed.event.unsigned = { transaction_id: 'txn-6' };

    const resolver = (txnId: string) => (txnId === 'txn-6' ? '$other' : undefined);

    const result = mergeThreadRenderEvents([], [confirmed], resolver);
    expect(result).toEqual([confirmed]);
    expect(result).toHaveLength(1);
  });
});

describe('buildResolveConfirmedEventId', () => {
  it('falls back to non-local events when room lookup has not learned the confirmed id yet', () => {
    const localEcho = makeMessageEvent('~local-txn-fallback', 10);
    localEcho.setTxnId('txn-fallback');
    const confirmed = makeMessageEvent('$remote-txn-fallback', 10);
    confirmed.event.unsigned = { transaction_id: 'txn-fallback' };

    const resolveConfirmedId = buildResolveConfirmedEventId(makeRoom(), [localEcho, confirmed]);

    expect(resolveConfirmedId('txn-fallback')).toBe('$remote-txn-fallback');
  });
});

describe('dedupeThreadRenderEventEntries', () => {
  it('replaces a room local echo entry with its confirmed event entry', () => {
    const localEcho = makeMessageEvent('~local-txn-room', 10);
    localEcho.setTxnId('txn-room');
    const confirmed = makeMessageEvent('$remote-txn-room', 10);

    const entries = dedupeThreadRenderEventEntries(
      [
        { event: localEcho, absoluteIndex: 249 },
        { event: confirmed, absoluteIndex: 253 },
      ],
      (txnId: string) => (txnId === 'txn-room' ? '$remote-txn-room' : undefined)
    );

    expect(entries).toEqual([{ event: confirmed, absoluteIndex: 249 }]);
  });

  it('keeps unrelated room entries in order while removing the stale local echo duplicate', () => {
    const earlier = makeMessageEvent('$earlier', 5);
    const localEcho = makeMessageEvent('~local-txn-room-2', 10);
    localEcho.setTxnId('txn-room-2');
    const confirmed = makeMessageEvent('$remote-txn-room-2', 10);
    const later = makeMessageEvent('$later', 20);

    const entries = dedupeThreadRenderEventEntries(
      [
        { event: earlier, absoluteIndex: 10 },
        { event: localEcho, absoluteIndex: 11 },
        { event: confirmed, absoluteIndex: 12 },
        { event: later, absoluteIndex: 13 },
      ],
      (txnId: string) => (txnId === 'txn-room-2' ? '$remote-txn-room-2' : undefined)
    );

    expect(entries).toEqual([
      { event: earlier, absoluteIndex: 10 },
      { event: confirmed, absoluteIndex: 11 },
      { event: later, absoluteIndex: 13 },
    ]);
  });
});
