import { createElement } from 'react';
// @vitest-environment jsdom
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
  }) => {
    let latest!: ReturnType<typeof useMembershipFolds>;
    function Probe({
      enabled = true,
      events,
      windowEvents,
      pinnedIds = new Set<string>(),
    }: {
      enabled?: boolean;
      events: MatrixEvent[];
      windowEvents?: MatrixEvent[];
      pinnedIds?: ReadonlySet<string>;
    }) {
      latest = useMembershipFolds({
        enabled,
        events,
        windowEvents: windowEvents ?? events,
        isSkipped: () => false,
        pinnedIds,
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
    // Window widens to include $m1: $m1 becomes the break row (was hidden -> estimate 51),
    // and $m2 and $m3 become hidden (resize to 0).
    const fullIds = new Set(fullEvents.map((event) => event.getId()!));
    render(
      fullEvents,
      viewMembershipFolds([fold], () => false, fullIds)
    );
    expect(resizeItem.mock.calls).toEqual([
      [1, 51],
      [2, 0],
      [3, 0],
    ]);
  });
});
