// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { createElement, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent, MatrixEventEvent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EMPTY_MEMBERSHIP_FOLD_VIEW,
  heldFoldHeight,
  planMembershipFolds,
  projectRoomRows,
  viewMembershipFolds,
} from './membershipFolds';
import { readMembershipRowSizes, useMembershipFolds, useRoomRowWindow } from './useMembershipFolds';
import type { TimelineRange } from '../event-store/timeline/timelinePagination';

const ROOM_ID = '!room:example.org';

const joinEvent = (id: string, user: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: user,
    state_key: user,
    type: 'm.room.member',
    origin_server_ts: 1_700_000_000_000,
    content: { membership: 'join', displayname: user },
  });

const msgEvent = (id: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: '@sam:example.org',
    type: 'm.room.message',
    origin_server_ts: 1_700_000_000_000,
    content: { msgtype: 'm.text', body: id },
  });

const encryptedEvent = (id: string, roomId = ROOM_ID) =>
  new MatrixEvent({
    event_id: id,
    room_id: roomId,
    sender: '@sam:example.org',
    type: 'm.room.encrypted',
    origin_server_ts: 1_700_000_000_000,
    content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'abc' },
  });

/** Decrypts `event` in place, as the client does, which emits its decryption again as its own. */
const decryptInPlace = async (
  mx: EventEmitter,
  event: MatrixEvent,
  clearEvent: { type: string; content: Record<string, unknown> }
) => {
  event.once(MatrixEventEvent.Decrypted, (decrypted) =>
    mx.emit(MatrixEventEvent.Decrypted, decrypted)
  );
  await act(async () => {
    await event.attemptDecryption({
      decryptEvent: () => Promise.resolve({ clearEvent }),
    } as unknown as Parameters<MatrixEvent['attemptDecryption']>[0]);
  });
};

const ids = (events: readonly MatrixEvent[]) => events.map((event) => event.getId());

type ProbeProps = {
  enabled?: boolean;
  events: MatrixEvent[];
  pinnedIds?: ReadonlySet<string>;
  isSkipped?: (event: MatrixEvent) => boolean;
};

const NOT_SKIPPED = () => false;
const NO_PINS: ReadonlySet<string> = new Set();

describe('useMembershipFolds', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const mountHook = (initial: ProbeProps) => {
    const mx = new EventEmitter();
    let latest!: ReturnType<typeof useMembershipFolds>;
    let renders = 0;
    function Probe({
      enabled = true,
      events,
      pinnedIds = NO_PINS,
      isSkipped = NOT_SKIPPED,
    }: ProbeProps) {
      // The entries pair with the events, as the room's do.
      const entriesRef = useRef<{
        events: MatrixEvent[];
        entries: { event: MatrixEvent; absoluteIndex: number }[];
      }>();
      if (entriesRef.current?.events !== events) {
        entriesRef.current = {
          events,
          entries: events.map((event, absoluteIndex) => ({ event, absoluteIndex })),
        };
      }
      renders += 1;
      latest = useMembershipFolds({
        mx: mx as unknown as MatrixClient,
        roomId: ROOM_ID,
        enabled,
        events,
        entries: entriesRef.current.entries,
        isSkipped,
        pinnedIds,
      });
      return null;
    }
    act(() => {
      renderer = create(createElement(Probe, initial));
    });
    return {
      mx,
      current: () => latest,
      renders: () => renders,
      rerender: (next: ProbeProps) => {
        act(() => {
          renderer!.update(createElement(Probe, next));
        });
      },
    };
  };

  it('toggles a fold open and closed and stays open across prepends and appends', () => {
    const m2 = joinEvent('$m2', '@b:x');
    const m3 = joinEvent('$m3', '@c:x');
    const m4 = joinEvent('$m4', '@d:x');
    const before = msgEvent('$before');
    const after = msgEvent('$after');
    const hook = mountHook({ events: [before, m2, m3, m4, after] });

    expect(hook.current().view.breaks.get('$m2')?.open).toBe(false);
    // Closed, the fold is one row: no row of the list is hidden.
    expect(ids(hook.current().rows.rows)).toEqual(['$before', '$m2', '$after']);

    const fold = hook.current().view.breaks.get('$m2')!.fold;
    act(() => hook.current().toggle(fold));
    expect(hook.current().view.breaks.get('$m2')?.open).toBe(true);
    expect(ids(hook.current().rows.rows)).toEqual(['$before', '$m2', '$m3', '$m4', '$after']);

    // Prepending older history shifts fold.key to $m1, yet the fold stays open via $m2 anchor.
    const m1 = joinEvent('$m1', '@a:x');
    hook.rerender({ events: [before, m1, m2, m3, m4, after] });
    expect(hook.current().view.breaks.get('$m1')?.open).toBe(true);
    expect(hook.current().view.breaks.get('$m1')?.fold.eventIds).toEqual([
      '$m1',
      '$m2',
      '$m3',
      '$m4',
    ]);

    // Appending a live join keeps the fold open too.
    const m5 = joinEvent('$m5', '@e:x');
    hook.rerender({ events: [before, m1, m2, m3, m4, m5, after] });
    const extendedFold = hook.current().view.breaks.get('$m1')!.fold;
    expect(hook.current().view.breaks.get('$m1')?.open).toBe(true);
    expect(extendedFold.summary.total).toBe(5);

    // Toggling closed clears all anchors for the fold.
    act(() => hook.current().toggle(extendedFold));
    expect(hook.current().view.breaks.get('$m1')?.open).toBe(false);
    expect(ids(hook.current().rows.rows)).toEqual(['$before', '$m1', '$after']);
  });

  it('produces an empty view and the loaded rows when disabled (thread timeline)', () => {
    const events = [joinEvent('$m1', '@a:x'), joinEvent('$m2', '@b:x'), joinEvent('$m3', '@c:x')];
    const hook = mountHook({ enabled: false, events });
    expect(hook.current().view).toBe(EMPTY_MEMBERSHIP_FOLD_VIEW);
    expect(hook.current().rows.rows).toBe(events);
  });

  it('unfolds the run of a jump target, which is then a row, and leaves other folds closed', () => {
    const events = [
      joinEvent('$m1', '@a:x'),
      joinEvent('$m2', '@b:x'),
      joinEvent('$m3', '@c:x'),
      msgEvent('$mid'),
      joinEvent('$m4', '@d:x'),
      joinEvent('$m5', '@e:x'),
      joinEvent('$m6', '@f:x'),
    ];
    const hook = mountHook({ events });
    expect([...hook.current().view.breaks.keys()]).toEqual(['$m1', '$m4']);
    // Closed, `$m2` is no row: a jump to it finds its fold's row instead.
    expect(ids(hook.current().rows.rows)).toEqual(['$m1', '$mid', '$m4']);
    expect(hook.current().rows.foldedRows.get('$m2')).toBe(0);

    // The jump pins it: its run is unfolded, and the row is where the fold's row was, one down.
    hook.rerender({ events, pinnedIds: new Set(['$m2']) });
    expect([...hook.current().view.breaks.keys()]).toEqual(['$m4']);
    expect(ids(hook.current().rows.rows)).toEqual(['$m1', '$m2', '$m3', '$mid', '$m4']);
    expect(hook.current().rows.foldedRows.has('$m2')).toBe(false);
    expect(hook.current().rows.foldedRows.get('$m5')).toBe(4);
  });

  it('folds again when a loaded event decrypts in place into one without a row', async () => {
    // An encrypted event between the joins parts the run below the threshold.
    const encrypted = encryptedEvent('$enc');
    // The same props for every render: only the decryption can plan the folds again.
    const props: ProbeProps = {
      events: [
        joinEvent('$m1', '@a:x'),
        joinEvent('$m2', '@b:x'),
        encrypted,
        joinEvent('$m3', '@c:x'),
      ],
      pinnedIds: NO_PINS,
      isSkipped: NOT_SKIPPED,
    };
    const hook = mountHook(props);
    expect(hook.current().view.breaks.size).toBe(0);
    expect(hook.current().rows.rows).toBe(props.events);

    // It decrypts into a call invite, which draws no row. No row of the window showed it, and
    // nothing renders the timeline again but the decryption itself.
    await decryptInPlace(hook.mx, encrypted, {
      type: 'm.call.invite',
      content: { call_id: 'c1', version: 1, lifetime: 60000, offer: { type: 'offer', sdp: '' } },
    });
    expect(encrypted.getType()).toBe('m.call.invite');
    expect([...hook.current().view.breaks.keys()]).toEqual(['$m1']);
    expect(hook.current().view.breaks.get('$m1')?.fold.eventIds).toEqual(['$m1', '$m2', '$m3']);
    expect(ids(hook.current().rows.rows)).toEqual(['$m1']);
  });

  it('leaves the folds alone when the decrypted event still parts its run, or is of another room', async () => {
    const encrypted = encryptedEvent('$enc');
    const props: ProbeProps = {
      events: [
        joinEvent('$m1', '@a:x'),
        joinEvent('$m2', '@b:x'),
        encrypted,
        joinEvent('$m3', '@c:x'),
      ],
    };
    const hook = mountHook(props);
    const rendersBefore = hook.renders();
    await decryptInPlace(hook.mx, encryptedEvent('$other', '!other:example.org'), {
      type: 'm.call.invite',
      content: {},
    });
    // A message is a row as the undecrypted event was.
    await decryptInPlace(hook.mx, encrypted, {
      type: 'm.room.message',
      content: { msgtype: 'm.text', body: 'hello' },
    });
    expect(hook.renders()).toBe(rendersBefore);
    expect(hook.current().view.breaks.size).toBe(0);
  });
});

describe('useRoomRowWindow', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const loaded = [
    joinEvent('$m1', '@a:x'),
    joinEvent('$m2', '@b:x'),
    joinEvent('$m3', '@c:x'),
    joinEvent('$m4', '@d:x'),
    msgEvent('$msg1'),
    msgEvent('$msg2'),
  ];
  const entries = loaded.map((event, absoluteIndex) => ({ event, absoluteIndex }));
  const project = (open: boolean) =>
    projectRoomRows(
      loaded,
      entries,
      viewMembershipFolds(
        planMembershipFolds(loaded, { isSkipped: () => false, pinnedIds: new Set() }),
        () => open
      )
    );

  const mountWindow = (projection: ReturnType<typeof project>, stateRange: TimelineRange) => {
    let latest!: ReturnType<typeof useRoomRowWindow>;
    function Probe(props: { projection: ReturnType<typeof project>; stateRange: TimelineRange }) {
      latest = useRoomRowWindow(props.projection, props.stateRange);
      return null;
    }
    act(() => {
      renderer = create(createElement(Probe, { projection, stateRange }));
    });
    return {
      current: () => latest,
      rerender: (next: ReturnType<typeof project>, range: TimelineRange) =>
        act(() => renderer!.update(createElement(Probe, { projection: next, stateRange: range }))),
    };
  };

  it('holds a closed fold whole when the state starts its window inside it', () => {
    // History brought `$m1` and `$m2` of the run the window started with: the state's window now
    // starts at `$m3`.
    const stateRange = { start: 2, end: 6 };
    const hook = mountWindow(project(false), stateRange);
    expect(hook.current().rowRange).toEqual({ start: 0, end: 3 });
    // The loaded rows of the window shown, for the state to follow.
    expect(hook.current().loadedRange).toEqual({ start: 0, end: 6 });
  });

  it("keeps one window object while it names the same rows, and the state's own when no fold is closed", () => {
    const stateRange = { start: 0, end: 6 };
    const hook = mountWindow(project(false), stateRange);
    const shown = hook.current().rowRange;
    expect(shown).toEqual({ start: 0, end: 3 });
    expect(hook.current().loadedRange).toBe(stateRange);
    // Another projection of the same rows, and an equal window from the state.
    hook.rerender(project(false), { start: 0, end: 6 });
    expect(hook.current().rowRange).toBe(shown);
    // Open, the rows are the loaded rows and the window is the state's.
    const openRange = { start: 0, end: 6 };
    hook.rerender(project(true), openRange);
    expect(hook.current().rowRange).toBe(openRange);
    expect(hook.current().loadedRange).toBe(openRange);
  });
});

describe('the heights a fold takes over from the rows it holds', () => {
  const m3 = joinEvent('$m3', '@c:x');
  const m4 = joinEvent('$m4', '@d:x');
  const m5 = joinEvent('$m5', '@e:x');
  const msg = msgEvent('$msg');
  const closedView = (events: MatrixEvent[]) =>
    viewMembershipFolds(
      planMembershipFolds(events, { isSkipped: () => false, pinnedIds: new Set() }),
      () => false
    );
  const list = (sizes: number[], measured: Record<string, number>, mounted: string[] = []) => ({
    itemSizeCache: new Map<string | number | bigint, number>(Object.entries(measured)),
    measurementsCache: sizes.map((size) => ({ size })),
    elementsCache: new Map(mounted.map((id) => [id, { isConnected: true }])),
  });
  type List = Parameters<typeof readMembershipRowSizes>[0];

  it('reads the membership rows of the window, measured or not, and no other row', () => {
    const virtualizer = list([30.5, 31, 50], { $m5: 31, $msg: 50 });
    const sizes = readMembershipRowSizes(
      virtualizer as unknown as List,
      [m4, m5, msg],
      EMPTY_MEMBERSHIP_FOLD_VIEW
    );
    expect([...sizes]).toEqual([
      ['$m4', 30.5],
      ['$m5', 31],
    ]);
    // A fold that history made of these rows takes their place at their height.
    const fold = planMembershipFolds([m3, m4, m5], {
      isSkipped: () => false,
      pinnedIds: new Set(),
    })[0]!;
    expect(heldFoldHeight(sizes, fold)).toBe(61.5);
    // One that holds no row of the last render has none to take.
    expect(heldFoldHeight(new Map(), fold)).toBe(0);
  });

  it("notes a mounted closed fold's height as measured, and leaves one that is not mounted", () => {
    const rows = [m3, msg];
    const view = closedView([m3, m4, m5, msg]);
    const mounted = list([60, 50], { $msg: 50 }, ['$m3']);
    expect([...readMembershipRowSizes(mounted as unknown as List, rows, view)]).toEqual([
      ['$m3', 60],
    ]);
    expect(mounted.itemSizeCache.get('$m3')).toBe(60);
    const unmounted = list([60, 50], { $msg: 50 });
    expect([...readMembershipRowSizes(unmounted as unknown as List, rows, view)]).toEqual([
      ['$m3', 60],
    ]);
    expect(unmounted.itemSizeCache.has('$m3')).toBe(false);
  });
});
