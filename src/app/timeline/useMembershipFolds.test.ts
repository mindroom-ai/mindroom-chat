// @vitest-environment jsdom
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent } from 'matrix-js-sdk';
import type { Virtualizer } from '@tanstack/react-virtual';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_MEMBERSHIP_FOLD_VIEW,
  planMembershipFolds,
  viewMembershipFolds,
  type MembershipFold,
  type MembershipFoldView,
} from './membershipFolds';
import { useMembershipFoldRowMeasurements, useMembershipFolds } from './useMembershipFolds';

const joinEvent = (id: string, user: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: user,
    state_key: user,
    type: 'm.room.member',
    origin_server_ts: 1_700_000_000_000,
    content: { membership: 'join', displayname: user },
  });

const msgEvent = (id: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@sam:example.org',
    type: 'm.room.message',
    origin_server_ts: 1_700_000_000_000,
    content: { msgtype: 'm.text', body: id },
  });

describe('useMembershipFolds', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const mountHook = (initial: {
    enabled?: boolean;
    events: MatrixEvent[];
    windowEvents?: MatrixEvent[];
    pinnedIds?: ReadonlySet<string>;
    rowRepaintRevision?: number;
  }) => {
    let latest!: ReturnType<typeof useMembershipFolds>;
    function Probe({
      enabled = true,
      events,
      windowEvents,
      pinnedIds = new Set<string>(),
      rowRepaintRevision,
    }: {
      enabled?: boolean;
      events: MatrixEvent[];
      windowEvents?: MatrixEvent[];
      pinnedIds?: ReadonlySet<string>;
      rowRepaintRevision?: number;
    }) {
      latest = useMembershipFolds({
        enabled,
        events,
        windowEvents: windowEvents ?? events,
        isSkipped: () => false,
        pinnedIds,
        rowRepaintRevision,
      });
      return null;
    }
    act(() => {
      renderer = create(createElement(Probe, initial));
    });
    return {
      current: () => latest,
      rerender: (next: {
        enabled?: boolean;
        events: MatrixEvent[];
        windowEvents?: MatrixEvent[];
        pinnedIds?: ReadonlySet<string>;
        rowRepaintRevision?: number;
      }) => {
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
    const hook = mountHook({ events: [msgEvent('$before'), m2, m3, m4, msgEvent('$after')] });

    expect(hook.current().view.breaks.get('$m2')?.open).toBe(false);
    expect([...hook.current().view.hiddenIds].sort()).toEqual(['$m3', '$m4']);

    const fold = hook.current().view.breaks.get('$m2')!.fold;
    act(() => hook.current().toggle(fold));
    expect(hook.current().view.breaks.get('$m2')?.open).toBe(true);
    expect(hook.current().view.hiddenIds.size).toBe(0);

    // Prepending older history shifts fold.key to $m1, yet the fold stays open via $m2 anchor.
    const m1 = joinEvent('$m1', '@a:x');
    hook.rerender({ events: [msgEvent('$before'), m1, m2, m3, m4, msgEvent('$after')] });
    expect(hook.current().view.breaks.get('$m1')?.open).toBe(true);
    expect(hook.current().view.breaks.get('$m1')?.fold.hiddenIds).toEqual([
      '$m1',
      '$m2',
      '$m3',
      '$m4',
    ]);

    // Appending a live join keeps the fold open too.
    const m5 = joinEvent('$m5', '@e:x');
    hook.rerender({ events: [msgEvent('$before'), m1, m2, m3, m4, m5, msgEvent('$after')] });
    const extendedFold = hook.current().view.breaks.get('$m1')!.fold;
    expect(hook.current().view.breaks.get('$m1')?.open).toBe(true);
    expect(extendedFold.summary.total).toBe(5);

    // Toggling closed clears all anchors for the fold.
    act(() => hook.current().toggle(extendedFold));
    expect(hook.current().view.breaks.get('$m1')?.open).toBe(false);
    expect([...hook.current().view.hiddenIds].sort()).toEqual(['$m2', '$m3', '$m4', '$m5']);
  });

  it('produces an empty view when disabled (thread timeline)', () => {
    const events = [joinEvent('$m1', '@a:x'), joinEvent('$m2', '@b:x'), joinEvent('$m3', '@c:x')];
    const hook = mountHook({ enabled: false, events });
    expect(hook.current().view).toBe(EMPTY_MEMBERSHIP_FOLD_VIEW);
  });

  it('unfolds a targeted fold when a jump pins one of its events while leaving other folds folded', () => {
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

    // Jumping to $m2 pins it and unfolds only the first run.
    hook.rerender({ events, pinnedIds: new Set(['$m2']) });
    expect([...hook.current().view.breaks.keys()]).toEqual(['$m4']);
    expect(hook.current().view.hiddenIds.has('$m2')).toBe(false);
    expect(hook.current().view.hiddenIds.has('$m3')).toBe(false);
    expect(hook.current().view.hiddenIds.has('$m5')).toBe(true);
  });

  it('recomputes folds when rowRepaintRevision bumps after an event decrypts in place', async () => {
    // Initially encrypted event sits between two joins, splitting the run below threshold.
    const encrypted = new MatrixEvent({
      event_id: '$enc',
      room_id: '!room:example.org',
      sender: '@sam:example.org',
      type: 'm.room.encrypted',
      origin_server_ts: 1_700_000_000_000,
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'abc' },
    });
    const events = [
      joinEvent('$m1', '@a:x'),
      joinEvent('$m2', '@b:x'),
      encrypted,
      joinEvent('$m3', '@c:x'),
    ];
    const hook = mountHook({ events, rowRepaintRevision: 0 });
    expect(hook.current().view.breaks.size).toBe(0);

    // Decryption mutates the MatrixEvent in place into a rowless reaction without changing array identity.
    await encrypted.attemptDecryption({
      decryptEvent: async () => ({
        clearEvent: {
          type: 'm.reaction',
          content: {
            'm.relates_to': { rel_type: 'm.annotation', event_id: '$other', key: '+' },
          },
        },
      }),
    } as any);
    expect(encrypted.getType()).toBe('m.reaction');

    hook.rerender({ events, rowRepaintRevision: 1 });
    expect([...hook.current().view.breaks.keys()]).toEqual(['$m1']);
    expect([...hook.current().view.hiddenIds].sort()).toEqual(['$m2', '$m3']);
  });
});

describe('useMembershipFoldRowMeasurements', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const fullEvents = [
    msgEvent('$before'),
    joinEvent('$m1', '@a:x'),
    joinEvent('$m2', '@b:x'),
    joinEvent('$m3', '@c:x'),
    msgEvent('$after'),
  ];
  const fold: MembershipFold = planMembershipFolds(fullEvents, {
    isSkipped: () => false,
    pinnedIds: new Set(),
  })[0]!;

  const setup = (mountedKeys: string[], detachedKeys: string[] = []) => {
    const virtualizer = {
      elementsCache: new Map<string, { isConnected: boolean }>([
        ...mountedKeys.map((key): [string, { isConnected: boolean }] => [
          key,
          { isConnected: true },
        ]),
        ...detachedKeys.map((key): [string, { isConnected: boolean }] => [
          key,
          { isConnected: false },
        ]),
      ]),
      resizeItem: vi.fn(),
    } as unknown as Virtualizer<HTMLDivElement, Element>;

    const estimate = (index: number) => 50 + index;

    function Probe({
      windowEvents,
      view,
    }: {
      windowEvents: readonly MatrixEvent[];
      view: MembershipFoldView;
    }) {
      useMembershipFoldRowMeasurements(virtualizer, windowEvents, view, estimate);
      return null;
    }

    const render = (windowEvents: readonly MatrixEvent[], view: MembershipFoldView) => {
      act(() => {
        if (!renderer) {
          renderer = create(createElement(Probe, { windowEvents, view }));
        } else {
          renderer.update(createElement(Probe, { windowEvents, view }));
        }
      });
    };

    return { resizeItem: vi.mocked(virtualizer.resizeItem), render };
  };

  it('resizes hidden rows to 0, newly unhidden rows to estimate, and disconnected break rows on state change', () => {
    const { resizeItem, render } = setup(['$before']);
    const closed = viewMembershipFolds([fold], () => false);
    const open = viewMembershipFolds([fold], () => true);

    // Closed fold: $m1 is a disconnected break row (index 1 -> 51), $m2 and $m3 resize to 0.
    render(fullEvents, closed);
    expect(resizeItem.mock.calls).toEqual([
      [1, 51],
      [2, 0],
      [3, 0],
    ]);

    resizeItem.mockClear();
    // Open fold: $m1 break changed while disconnected (51), $m2 and $m3 newly unhidden (52, 53).
    render(fullEvents, open);
    expect(resizeItem.mock.calls).toEqual([
      [1, 51],
      [2, 52],
      [3, 53],
    ]);

    resizeItem.mockClear();
    // Unfold completely (e.g. pinned): $m1 break removed while disconnected (51).
    render(fullEvents, EMPTY_MEMBERSHIP_FOLD_VIEW);
    expect(resizeItem.mock.calls).toEqual([[1, 51]]);
  });

  it('leaves a mounted break row to measure itself while still resizing hidden rows', () => {
    const { resizeItem, render } = setup(['$m1']);
    const closed = viewMembershipFolds([fold], () => false);
    const open = viewMembershipFolds([fold], () => true);

    render(fullEvents, closed);
    expect(resizeItem.mock.calls).toEqual([
      [2, 0],
      [3, 0],
    ]);

    resizeItem.mockClear();
    render(fullEvents, open);
    expect(resizeItem.mock.calls).toEqual([
      [2, 52],
      [3, 53],
    ]);
  });

  it('restores a previously zeroed row when it leaves the window, the fold opens off-window, and the window widens back', () => {
    const extendedEvents = [
      msgEvent('$before'),
      joinEvent('$m1', '@a:x'),
      joinEvent('$m2', '@b:x'),
      joinEvent('$m3', '@c:x'),
      joinEvent('$m4', '@d:x'),
      msgEvent('$after'),
    ];
    const extendedFold = planMembershipFolds(extendedEvents, {
      isSkipped: () => false,
      pinnedIds: new Set(),
    })[0]!;
    const { resizeItem, render } = setup(['$m1', '$m3']);

    // 1. Fold starts open (measured normal), then closes: $m2, $m3, $m4 are zeroed.
    const allIds = new Set(extendedEvents.map((event) => event.getId()!));
    render(
      extendedEvents,
      viewMembershipFolds([extendedFold], () => false, allIds)
    );
    expect(resizeItem.mock.calls).toEqual([
      [2, 0],
      [3, 0],
      [4, 0],
    ]);

    // 2. Window slides forward past $m1 and $m2 (window now starts at $m3).
    resizeItem.mockClear();
    const tailWindow = extendedEvents.slice(3);
    const tailIds = new Set(tailWindow.map((event) => event.getId()!));
    render(
      tailWindow,
      viewMembershipFolds([extendedFold], () => false, tailIds)
    );
    // $m3 was previously hidden and now becomes the break row -> restored to estimate(0) = 50.
    expect(resizeItem.mock.calls).toEqual([[0, 50]]);

    // 3. User opens the fold while $m2 is outside the window.
    resizeItem.mockClear();
    render(
      tailWindow,
      viewMembershipFolds([extendedFold], () => true, tailIds)
    );
    // $m4 (index 1 in tailWindow) was hidden -> restored to estimate(1) = 51; $m3 is mounted.
    expect(resizeItem.mock.calls).toEqual([[1, 51]]);

    // 4. Window widens back to include $m1 and $m2 while the fold is open.
    resizeItem.mockClear();
    render(
      extendedEvents,
      viewMembershipFolds([extendedFold], () => true, allIds)
    );
    // $m2 was zeroed in step 1 and left the window before step 3; re-entering must restore estimate(2) = 52!
    expect(resizeItem.mock.calls).toEqual([[2, 52]]);
  });

  it('updates measurements when the window shifts across a folded run', () => {
    const { resizeItem, render } = setup([]);
    // Window starts mid-run at $m2, so $m2 is the break row and $m3 is hidden.
    const partialWindow = fullEvents.slice(2);
    const partialIds = new Set(partialWindow.map((event) => event.getId()!));
    render(
      partialWindow,
      viewMembershipFolds([fold], () => false, partialIds)
    );
    expect(resizeItem.mock.calls).toEqual([
      [0, 50],
      [1, 0],
    ]);

    resizeItem.mockClear();
    // Window widens to include $m1: $m1 becomes the break row (estimate 51),
    // and $m2 becomes hidden (resize to 0); $m3 was already hidden.
    const fullIds = new Set(fullEvents.map((event) => event.getId()!));
    render(
      fullEvents,
      viewMembershipFolds([fold], () => false, fullIds)
    );
    expect(resizeItem.mock.calls).toEqual([
      [1, 51],
      [2, 0],
    ]);
  });
});
