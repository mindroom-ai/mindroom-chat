import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
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
});
