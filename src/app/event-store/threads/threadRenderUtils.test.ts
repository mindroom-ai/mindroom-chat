import { MatrixEvent } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCacheProbeSnapshot, resetCacheProbe } from '../cache/cacheProbe';
import {
  buildResolveConfirmedEventId,
  estimateThreadEventRowHeight,
  getThreadInitialRenderMode,
  mergeThreadRenderEvents,
  pickPreferredThreadRenderEvent,
  shouldAutoPaginateThreadBack,
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
  }) as never;

describe('getThreadInitialRenderMode', () => {
  it('shows a loading state while initialization is pending and no events are available', () => {
    expect(
      getThreadInitialRenderMode({
        initializationComplete: false,
        availableEventCount: 0,
      })
    ).toBe('loading');
  });

  it('renders available thread events while initialization is pending', () => {
    expect(
      getThreadInitialRenderMode({
        initializationComplete: false,
        availableEventCount: 3,
      })
    ).toBe('cached');
  });

  it('switches to the live render path once initialization completes', () => {
    expect(
      getThreadInitialRenderMode({
        initializationComplete: true,
        availableEventCount: 0,
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

  // Review candidate-3 (2026-07-04): the picker's local-echo branch
  // returns early, BEFORE the replacement-preference rules. A repaired
  // cache-hydrated instance has a real event id and isSending()=false,
  // so it must never classify as a local echo and lose to an
  // unrepaired sync-delivered instance — even when it carries local
  // send metadata (unsigned.transaction_id persisted at seed time),
  // which makes its key set intersect the incoming instance's on both
  // the event and txn dimensions.
  it('keeps a repaired confirmed instance over an unrepaired sync instance despite txn metadata', () => {
    const repairedHydrated = makeMessageEvent('$target');
    repairedHydrated.event.unsigned = { transaction_id: 'txn-repair-1' };
    // Foreign-sender raw replacement: the effective-replacement block
    // yields nothing for either side (sender-mismatch filter), so the
    // decision falls through the local-echo branch and the effective
    // block to the asymmetric raw-presence rule. The patched SDK
    // applies no foreign-sender edit, so the replacement is stubbed in.
    const foreignEdit = makeEditEvent('$target', '$edit-2', 2);
    foreignEdit.event.sender = '@mallory:example.org';
    vi.spyOn(repairedHydrated, 'replacingEvent').mockReturnValue(foreignEdit);
    const syncInstance = makeMessageEvent('$target');

    expect(repairedHydrated.isSending()).toBe(false);
    expect(syncInstance.isSending()).toBe(false);
    expect(pickPreferredThreadRenderEvent(repairedHydrated, syncInstance)).toBe(repairedHydrated);
    expect(pickPreferredThreadRenderEvent(syncInstance, repairedHydrated)).toBe(repairedHydrated);
  });
});

describe('shouldAutoPaginateThreadBack', () => {
  const base = {
    threadId: '$thread',
    firstRenderedIndex: 10,
    paginatingBack: false,
    showLoadOlder: true,
    hasUserScrollIntent: true,
    triggerRows: 15,
  };

  it('fires when the rendered window top is within the trigger headroom', () => {
    expect(shouldAutoPaginateThreadBack(base)).toBe(true);
    expect(shouldAutoPaginateThreadBack({ ...base, firstRenderedIndex: 15 })).toBe(true);
    expect(shouldAutoPaginateThreadBack({ ...base, firstRenderedIndex: 0 })).toBe(true);
  });

  it('does not fire while the rendered window is deeper than the headroom', () => {
    expect(shouldAutoPaginateThreadBack({ ...base, firstRenderedIndex: 16 })).toBe(false);
    expect(shouldAutoPaginateThreadBack({ ...base, firstRenderedIndex: 400 })).toBe(false);
  });

  it('does not fire outside a thread or before anything rendered', () => {
    expect(shouldAutoPaginateThreadBack({ ...base, threadId: undefined })).toBe(false);
    expect(shouldAutoPaginateThreadBack({ ...base, firstRenderedIndex: undefined })).toBe(false);
  });

  it('is single-flight: does not re-fire while a back-pagination is in progress', () => {
    expect(shouldAutoPaginateThreadBack({ ...base, paginatingBack: true })).toBe(false);
  });

  it('does not fire when no older content exists (chip condition is false)', () => {
    expect(shouldAutoPaginateThreadBack({ ...base, showLoadOlder: false })).toBe(false);
  });

  it('does not fire before any real user scroll gesture', () => {
    // Before a gesture, a low rendered index is the open-time pre-pin
    // transient (the virtualizer briefly renders from index 0), not a
    // user scrolled to the top. Note this gate is user intent, NOT the
    // open-lifecycle pending flag — that flag stays true for the whole
    // open-time backfill chain, which on slow networks is exactly when
    // a scrolling user needs the trigger live.
    expect(shouldAutoPaginateThreadBack({ ...base, hasUserScrollIntent: false })).toBe(false);
  });
});

describe('estimateThreadEventRowHeight', () => {
  const modern = { compact: false };

  it('estimates a one-liner at base + one text line', () => {
    expect(estimateThreadEventRowHeight(makeMessageEvent('$short'), modern)).toBe(8 + 22);
  });

  it('adds a line per newline for short bodies', () => {
    const event = new MatrixEvent({
      content: { body: 'a\nb\nc', msgtype: 'm.text' },
      event_id: '$multi',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    expect(estimateThreadEventRowHeight(event, modern)).toBe(8 + 3 * 22);
  });

  it('caps human messages past the fold at the collapsed height (long body)', () => {
    const event = new MatrixEvent({
      content: { body: 'x'.repeat(2000), msgtype: 'm.text' },
      event_id: '$long',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    expect(estimateThreadEventRowHeight(event, modern)).toBe(8 + 9 * 22);
  });

  it('caps short-but-many-lines human bodies at the collapsed height too', () => {
    const event = new MatrixEvent({
      content: { body: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj', msgtype: 'm.text' },
      event_id: '$lines',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    expect(estimateThreadEventRowHeight(event, modern)).toBe(8 + 9 * 22);
  });

  it('never caps MindRoom agent replies at the human fold and prices past 48 lines', () => {
    const body = Array.from({ length: 65 }, (_v, i) => `Step ${i + 1}: verify Service X`).join('\n');
    const agent = new MatrixEvent({
      content: { body, msgtype: 'm.text' },
      event_id: '$agent-long',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@mindroom_dev:example.org',
      type: 'm.room.message',
    });
    const px = estimateThreadEventRowHeight(agent, modern);
    expect(px).toBe(8 + 65 * 22);
    expect(px).toBeGreaterThan(960);
  });

  it('scans past 4 KiB for long always-expanded agent replies', () => {
    const body = Array.from(
      { length: 120 },
      (_v, i) => `Item ${i + 1}: Service X passed verification check with nominal latency.`
    ).join('\n');
    expect(body.length).toBeGreaterThan(4096);
    const agent = new MatrixEvent({
      content: { body, msgtype: 'm.text' },
      event_id: '$agent-very-long',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@mindroom_dev:example.org',
      type: 'm.room.message',
    });
    expect(estimateThreadEventRowHeight(agent, { compact: false, wrapChars: 38 })).toBe(
      8 + 240 * 22
    );
  });

  it.each(['m.replace', 'm.annotation'])('reserves no scroll space for %s relations', (relType) => {
    const edit = new MatrixEvent({
      content: {
        body: '* fixed',
        msgtype: 'm.text',
        'm.relates_to': { rel_type: relType, event_id: '$target' },
      },
      event_id: '$edit',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    expect(estimateThreadEventRowHeight(edit, modern)).toBe(0);
  });

  it('estimates a thread summary at its one-line marker', () => {
    const summary = 'Service X rollout summary\n'.repeat(4);
    const event = new MatrixEvent({
      content: {
        body: summary,
        msgtype: 'm.notice',
        'io.mindroom.thread_summary': { version: 1, summary, message_count: 21 },
      },
      event_id: '$summary',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@code:example.org',
      type: 'm.room.message',
    });
    expect(estimateThreadEventRowHeight(event, modern)).toBe(8 + 22);
  });

  it('uses the smaller compact base', () => {
    expect(estimateThreadEventRowHeight(makeMessageEvent('$compact'), { compact: true })).toBe(
      6 + 22
    );
  });

  it('estimates always-expanded legacy thread-summary rows uncapped', () => {
    const body = Array.from({ length: 10 }, (_v, line) => `answer line ${line}`).join('\n');
    const event = new MatrixEvent({
      content: {
        body,
        msgtype: 'm.text',
        'io.mindroom.thread_summary': true,
      },
      event_id: '$legacy-summary',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    expect(estimateThreadEventRowHeight(event, modern)).toBe(8 + 10 * 22);
  });

  it('bounds pathological always-expanded bodies at the line cap', () => {
    const event = new MatrixEvent({
      content: {
        body: 'x\n'.repeat(10_000),
        msgtype: 'm.text',
        'io.mindroom.thread_summary': true,
      },
      event_id: '$huge',
      origin_server_ts: 1,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    expect(estimateThreadEventRowHeight(event, modern)).toBe(8 + 240 * 22);
  });
});

describe('shouldPinThreadToBottomOnOpen', () => {
  it('pins a plain thread open once cached or live events are ready to render', () => {
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: true,
        threadOpenedAtLatest: true,
        hasUserScrollIntent: false,
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
        threadOpenedAtLatest: true,
        hasUserScrollIntent: false,
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
        threadOpenedAtLatest: false,
        hasUserScrollIntent: false,
        threadInitialRenderMode: 'live',
        threadEventCount: 3,
      })
    ).toBe(false);
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: true,
        threadOpenedAtLatest: true,
        hasUserScrollIntent: false,
        threadInitialRenderMode: 'live',
        threadEventCount: 0,
      })
    ).toBe(false);
  });

  it('keeps the pin through post-chain hydration bands until the first gesture', () => {
    // Device symptom (2026-07-06 trace round): open at the bottom, then
    // history bands landing AFTER the open chain completed dragged the
    // view to mid-thread. The latch holds the pin; a real gesture ends it.
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: false,
        threadOpenedAtLatest: true,
        hasUserScrollIntent: false,
        threadInitialRenderMode: 'live',
        threadEventCount: 300,
      })
    ).toBe(true);
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: false,
        threadOpenedAtLatest: true,
        hasUserScrollIntent: true,
        threadInitialRenderMode: 'live',
        threadEventCount: 300,
      })
    ).toBe(false);
  });

  it('does not pin while thread back-pagination suppresses open-bottom pinning', () => {
    expect(
      shouldPinThreadToBottomOnOpen({
        threadId: '$thread',
        threadLatestOpenPending: true,
        threadOpenedAtLatest: true,
        hasUserScrollIntent: false,
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

// ISSUE-207 AC2 render-gap RG5d (2026-07-04): key-canonicalization
// invariant. `mergeThreadRenderEvents` maintains one MatrixEvent
// instance per event identity in its internal `eventMap` regardless of
// how many key sets the incoming events arrive under. The tests below
// exercise the dual-key scenarios team-lead named in the B-approval /
// RG5c-approval messages: entry under {txnId, eventId} followed by a
// second instance under {eventId} only. Post-canonicalization, the map
// must resolve to exactly one instance reachable under both keys, and
// (per the replacement-preferring rule) that instance must be the one
// carrying an effective replacement.
describe('mergeThreadRenderEvents RG5d key canonicalization', () => {
  beforeEach(() => {
    resetCacheProbe();
  });

  const makeMessageEventWithReplacement = (eventId: string, ts: number, editTs: number) => {
    const target = makeMessageEvent(eventId, ts);
    const edit = makeEditEvent(eventId, `$edit-${eventId}`, editTs);
    target.makeReplaced(edit);
    return target;
  };

  it('collapses a dual-key entry and a same-id single-key entry to one instance under both keys', () => {
    // Team-lead's dual-key scenario, verbatim: event enters under
    // {txnId, id}, second instance arrives under {id} only, map ends
    // with exactly one instance reachable under both keys, and it's
    // the replacement-carrying one (per the picker's preference rule
    // from RG5-fix2).
    const dualKey = makeMessageEvent('$remote-dual', 10);
    dualKey.event.unsigned = { transaction_id: 'txn-dual' };
    const singleKeyRepaired = makeMessageEventWithReplacement('$remote-dual', 10, 15);

    // Existing = dual-key without replacement.
    // Incoming = single-key WITH replacement.
    // Picker must prefer the replacement-carrying instance (asymmetric
    // raw check from 3fbe8afd). Canonicalizer must displace the loser
    // from BOTH of its keys, and install the winner under the union.
    const result = mergeThreadRenderEvents([dualKey], [singleKeyRepaired]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(singleKeyRepaired);
    // Displacement was observable.
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(1);
  });

  it('does not bump the displacement counter when incoming has no conflict', () => {
    const first = makeMessageEvent('$a', 10);
    const second = makeMessageEvent('$b', 20);
    const result = mergeThreadRenderEvents([first], [second]);
    expect(result).toHaveLength(2);
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(0);
  });

  it('does not bump when the same instance is re-registered', () => {
    const shared = makeMessageEvent('$same', 10);
    // Both loops write the same instance under the same keys; no
    // conflict, no displacement.
    const result = mergeThreadRenderEvents([shared], [shared]);
    expect(result).toEqual([shared]);
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(0);
  });

  it('preserves the winner even when the loser held a key the winner did not', () => {
    // Losing instance has a txnId the winner never had. The
    // canonicalizer must reclaim that key onto the winner so any
    // consumer looking up by txnId still resolves to the winner.
    const withTxn = makeMessageEvent('$id', 10);
    withTxn.event.unsigned = { transaction_id: 'txn-lost' };
    const winnerRepaired = makeMessageEventWithReplacement('$id', 10, 15);

    const result = mergeThreadRenderEvents([withTxn], [winnerRepaired]);
    expect(result).toEqual([winnerRepaired]);
    // Downstream reachability check: the winner survives regardless
    // of which key a subsequent merge cycle happens to observe.
    // Simulate a subsequent merge that supplies only the loser's
    // txnId — the winner must still be the resolvable instance for
    // that id via the picker's normal `mergedKeys` logic.
    const later = makeMessageEvent('$id', 10);
    later.event.unsigned = { transaction_id: 'txn-lost' };
    const secondPass = mergeThreadRenderEvents(result, [later]);
    // The second-pass picker will prefer the raw-replacement carrier
    // (winnerRepaired) over `later` per the asymmetric rule from
    // RG5-fix2, so the survivor is still the repaired instance.
    expect(secondPass).toHaveLength(1);
    expect(secondPass[0]).toBe(winnerRepaired);
  });

  it('bumps displacements per losing instance in a 3-way conflict, not per key', () => {
    // Three instances of the same event id arrive across the two
    // input arrays, with partially overlapping keys. Two of them
    // must lose; the counter must bump exactly twice (per-instance).
    const a = makeMessageEvent('$same', 10);
    a.event.unsigned = { transaction_id: 'txn-a' };
    const b = makeMessageEvent('$same', 10);
    b.event.unsigned = { transaction_id: 'txn-b' };
    const cRepaired = makeMessageEventWithReplacement('$same', 10, 15);

    const result = mergeThreadRenderEvents([a, b], [cRepaired]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(cRepaired);
    // Two losers displaced (a and b). Note: existingEvents pass writes
    // a, then b — b already conflicts with a via `event:$same`, so b
    // triggers a displacement of a. Then incoming cRepaired displaces
    // b. Total per-instance displacements: 2.
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(2);
  });

  it('symmetric — replacement-carrier wins whether it is existing or incoming', () => {
    const bareA = makeMessageEvent('$id', 10);
    bareA.event.unsigned = { transaction_id: 'txn-x' };
    const repairedA = makeMessageEventWithReplacement('$id', 10, 15);

    // Existing repaired, incoming bare — repaired must win.
    expect(mergeThreadRenderEvents([repairedA], [bareA])).toEqual([repairedA]);
    resetCacheProbe();

    const bareB = makeMessageEvent('$id2', 10);
    bareB.event.unsigned = { transaction_id: 'txn-y' };
    const repairedB = makeMessageEventWithReplacement('$id2', 10, 15);

    // Existing bare, incoming repaired — repaired must win.
    expect(mergeThreadRenderEvents([bareB], [repairedB])).toEqual([repairedB]);
  });

  it('permanent must-stay-0 tripwire: registrySwappedRepairedForUnrepaired never fires under the picker rule', () => {
    // The RG5c tripwire re-homed at the canonicalization site (per
    // team-lead's F1 correction): must stay 0 across every scenario the
    // picker guards. Any non-zero reading names a picker-rule violation
    // (a loser carried `.replacingEvent()` non-null while the chosen
    // winner had it null — the RG5-fix2 raw-presence rule was
    // bypassed).
    //
    // Exercise every RG5d scenario in one describe-scoped assertion so
    // the invariant is checked against the full canonicalizer surface,
    // not just one path.
    resetCacheProbe();
    const scenarios: Array<() => void> = [
      // Simple dual-key + single-key collapse.
      () => {
        const dual = makeMessageEvent('$s1', 10);
        dual.event.unsigned = { transaction_id: 'txn-s1' };
        const repaired = makeMessageEventWithReplacement('$s1', 10, 15);
        mergeThreadRenderEvents([dual], [repaired]);
      },
      // Reversed: existing repaired, incoming bare.
      () => {
        const dual = makeMessageEvent('$s2', 10);
        dual.event.unsigned = { transaction_id: 'txn-s2' };
        const repaired = makeMessageEventWithReplacement('$s2', 10, 15);
        mergeThreadRenderEvents([repaired], [dual]);
      },
      // Three-way conflict.
      () => {
        const a = makeMessageEvent('$s3', 10);
        a.event.unsigned = { transaction_id: 'txn-3a' };
        const b = makeMessageEvent('$s3', 10);
        b.event.unsigned = { transaction_id: 'txn-3b' };
        const repaired = makeMessageEventWithReplacement('$s3', 10, 15);
        mergeThreadRenderEvents([a, b], [repaired]);
      },
      // Neither side carries replacement — tripwire must not fire.
      () => {
        const a = makeMessageEvent('$s4', 10);
        a.event.unsigned = { transaction_id: 'txn-4' };
        const b = makeMessageEvent('$s4', 10);
        mergeThreadRenderEvents([a], [b]);
      },
    ];
    scenarios.forEach((run) => run());
    expect(getCacheProbeSnapshot().registrySwappedRepairedForUnrepaired).toBe(0);
  });

  // Greptile P2 on PR #73: two DISTINCT confirmed events that happen to
  // share a transaction_id (server misbehavior / cross-device
  // coincidence) are separate identities. The shared `txn:` key must
  // not let one displace the other's `event:` entry — pre-fix, the
  // conflict scan treated any key collision as same-identity and
  // silently dropped one real message from the merge output.
  it('keeps two distinct confirmed events that share a transaction id', () => {
    const first = makeMessageEvent('$distinct-1', 10);
    first.event.unsigned = { transaction_id: 'txn-shared' };
    const second = makeMessageEvent('$distinct-2', 11);
    second.event.unsigned = { transaction_id: 'txn-shared' };

    const merged = mergeThreadRenderEvents([first], [second]);

    expect(merged).toHaveLength(2);
    expect(merged).toContain(first);
    expect(merged).toContain(second);
    // Distinct identities — no displacement work should be counted.
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(0);
  });

  it('still collapses a local echo with its own confirmed event across a shared txn key', () => {
    const { localEcho, remoteEcho } = makeLocalEchoPair('txn-collapse');

    const merged = mergeThreadRenderEvents([localEcho], [remoteEcho]);

    expect(merged).toEqual([remoteEcho]);
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(1);
  });

  // Greptile P1 on PR #73: an echo whose txn already RESOLVES to a
  // known confirmed id must not collapse a DIFFERENT confirmed event
  // that reuses its transaction key — the echo-confirmation bridge
  // only applies to the echo's own confirmation.
  it('does not let a resolved local echo collapse a different confirmed event reusing its txn key', () => {
    const localEcho = makeMessageEvent('~local-txn-x', 10);
    localEcho.setTxnId('txn-x');
    const impostor = makeMessageEvent('$real-b', 11);
    impostor.event.unsigned = { transaction_id: 'txn-x' };
    // Resolver knows txn-x confirms to $real-a — NOT the impostor.
    const resolver = (txnId: string) => (txnId === 'txn-x' ? '$real-a' : undefined);

    const merged = mergeThreadRenderEvents([localEcho], [impostor], resolver);

    expect(merged).toHaveLength(2);
    expect(merged).toContain(localEcho);
    expect(merged).toContain(impostor);
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(0);
  });

  it('collapses an unresolved local echo with a same-txn confirmed arrival (the confirmation)', () => {
    const localEcho = makeMessageEvent('~local-txn-y', 10);
    localEcho.setTxnId('txn-y');
    const confirmation = makeMessageEvent('$real-y', 10);
    confirmation.event.unsigned = { transaction_id: 'txn-y' };
    // No resolver: the echo's confirmed id is not yet known, so a
    // same-txn confirmed arrival IS the confirmation by definition.
    const merged = mergeThreadRenderEvents([localEcho], [confirmation]);

    expect(merged).toEqual([confirmation]);
    expect(getCacheProbeSnapshot().eventMapCanonicalizedDisplacements).toBe(1);
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
