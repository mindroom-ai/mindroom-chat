// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel, ThreadRecord } from '../../event-store/threads/types';
import { standInForListMotion } from '../../ui/__tests__/listMotionStandIn';
import { CompactRoomView, type CompactRoomViewProps } from './CompactRoomView';
import { resolveThreadSortFreezeUpdate } from './threadSortFreezeController';
import {
  applyFrozenThreadOrder,
  createDefaultThreadFilterState,
} from '../../event-store/threads/roomThreadOverviewModel';
import { resolveThreadRecordOverviewRootIds } from '../../event-store/threads/threadRecordOverview';

const ROOM_ID = '!room:example.org';

const state = vi.hoisted(() => ({
  pinned: [] as string[],
  keeper: vi.fn<(props: { order: string[]; inputs: ReadonlyMap<string, string> }) => null>(
    () => null
  ),
}));
vi.mock('./CompactRowKeeper', () => ({ CompactRowKeeper: state.keeper }));

const viewModel = (threadRootId: string): CompactThreadCardViewModel => ({
  id: { roomId: ROOM_ID, threadRootId },
  titleText: threadRootId,
  displayTitleText: threadRootId,
  previewText: 'No replies yet',
  messageCount: 0,
  messageCountLabel: '0 replies',
  messageCountText: '0',
  attentionState: 'idle',
  attentionStatusText: 'Idle',
  participants: [],
  tags: [],
  isResolved: false,
  isUnread: false,
  isStreaming: false,
});

vi.mock('./compactThreadCardViewModel', () => ({
  useCompactThreadCardViewModels: ({ threadRootIds }: { threadRootIds: string[] }) =>
    threadRootIds.map(viewModel),
}));
vi.mock('../tags/useRoomThreadTags', () => ({
  useToggleThreadResolution: () => ({
    canToggle: false,
    setResolved: vi.fn(),
    updatingThreadRootIds: new Set(),
    error: undefined,
  }),
}));
vi.mock('../../event-store/threads/useThreadPinning', () => ({
  useThreadPinning: () => ({
    canPin: true,
    pinnedEventIds: state.pinned,
    setPinned: vi.fn(),
    updating: false,
    error: undefined,
  }),
}));
vi.mock('../useInitializeShownThread', () => ({ useInitializeShownThread: () => undefined }));
vi.mock('./useThreadRootLiveCallRow', () => ({ useThreadRootLiveCallRow: () => undefined }));
vi.mock('./ThreadCardBadges', () => ({ ThreadCardBadges: () => null }));
vi.mock('./ThreadCardDetails', () => ({ ThreadCardDetails: () => null }));
vi.mock('../../ui/InsetScrollbar', () => ({ InsetScrollbar: () => null }));
vi.mock('../ThreadActionsMenu', () => ({ ThreadActionsMenu: () => null }));
vi.mock('../../i18n/useRelativeTime', () => ({ useRelativeTime: () => '' }));
// The sections read the threads' signals, whose modules load the app's translations.
vi.mock('./useCompactThreadSections', () => ({ useCompactThreadSections: () => undefined }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

const room = { roomId: ROOM_ID } as unknown as Room;
const list = (
  threadRootIds: string[],
  filterBarShown = false,
  props?: Partial<CompactRoomViewProps>
) => (
  <CompactRoomView
    room={room}
    filterBarShown={filterBarShown}
    threadRootIds={threadRootIds}
    threadRecordMap={new Map()}
    onThreadClick={vi.fn()}
    compactRoomScrollStateRef={{ current: new Map() }}
    {...props}
  />
);

let motion: ReturnType<typeof standInForListMotion>;
/** The cards whose moving part glided. */
const glided = () =>
  motion.glided().map((rootId) => {
    const row = document.querySelector(`[data-motion-row="${rootId ?? ''}"]`);
    // A card moves by the element inside the one the scroll position is measured on.
    expect(row?.hasAttribute('data-scroll-anchor')).toBe(false);
    return row?.parentElement?.getAttribute('data-scroll-anchor');
  });

beforeEach(() => {
  state.pinned = [];
  motion = standInForListMotion();
});

afterEach(() => {
  cleanup();
  motion.restore();
});

describe('the compact thread list in motion', () => {
  it('glides the cards after one that left, and fades that one where it stood', () => {
    const { rerender } = render(list(['$a', '$b', '$c']));
    rerender(list(['$a', '$c']));

    expect(glided()).toEqual(['$c']);
    const [left] = motion.left();
    expect(left?.textContent).toContain('$b');
    // The card that fades is no card to the list: nothing restores the scroll against it.
    expect(left?.closest('[data-scroll-anchor]')).toBeNull();
    expect(left?.querySelector('[data-scroll-anchor]')).toBeNull();
  });

  it('glides two cards that swap', () => {
    const { rerender } = render(list(['$a', '$b']));
    rerender(list(['$b', '$a']));

    expect(glided().sort()).toEqual(['$a', '$b']);
  });

  it('reads the cards when the filter bar comes or goes, which moves them all', () => {
    /** How often a card's moving part was measured. */
    const readsOfCards = () =>
      motion.rects.mock.contexts.filter((element) =>
        (element as HTMLElement).hasAttribute('data-motion-row')
      ).length;
    const { rerender } = render(list(['$a', '$b']));
    motion.rects.mockClear();
    rerender(list(['$a', '$b']));
    expect(readsOfCards()).toBe(0);

    rerender(list(['$a', '$b'], true));

    // Before the change and after it, to play each card from where it was.
    expect(readsOfCards()).toBeGreaterThan(0);
  });

  it('glides a card into the Pinned section', () => {
    const { rerender } = render(list(['$a', '$b', '$c']));
    state.pinned = ['$c'];
    rerender(list(['$a', '$b', '$c']));

    expect(glided().sort()).toEqual(['$a', '$b', '$c']);
  });
});

const keeper = () => state.keeper.mock.lastCall![0];
const capture = (ids: string[], sortInputOf: (id: string) => string | undefined) => {
  const options = {
    activeLiveOverviewThreadRootIds: ids,
    currentState: { controlSignature: null, orderedRootIds: [] },
    threadSortControlSignature: 'lastReply:desc',
    sortInputOf,
  };
  return resolveThreadSortFreezeUpdate(options)!;
};
const inputsFor = (
  activity: Record<string, number>,
  sortFreeze: ReturnType<typeof capture> | null = null
) => {
  const threadRecordMap = new Map(
    Object.entries(activity).map(([id, ts]) => [
      id,
      { status: { lastActivityTs: ts, tags: [] }, absoluteIndex: 0 } as unknown as ThreadRecord,
    ])
  );
  const { sortInputOf } = resolveThreadRecordOverviewRootIds({
    threadRootIds: Object.keys(activity),
    pinnedThreadRootIds: state.pinned,
    threadFilterState: createDefaultThreadFilterState(),
    searchQuery: '',
    recordMap: threadRecordMap,
    threadSortFreezeState: sortFreeze,
    threadSortControlSignature: 'lastReply:desc',
  });
  return { sortMode: 'lastReply:desc', sortFreeze, sortInputOf, threadRecordMap };
};

describe('comparison inputs reach the keeper with the applied order', () => {
  it("retains the last pin's held membership until its ordinary slot applies", () => {
    const ids = ['$a', '$b', '$p', '$c', '$d', '$e', '$f', '$g', '$h', '$i'];
    state.pinned = ['$a', '$b', '$p'];
    const activity = Object.fromEntries(ids.map((id, index) => [id, index]));
    const { container, rerender } = render(list(ids, false, inputsFor(activity)));
    fireEvent.pointerEnter(container.querySelector('[data-scroll-anchor]')!);
    const content = container.querySelector('[data-order-held]')!;
    expect(content).not.toBeNull();
    state.pinned = ['$a', '$b'];
    const live = ['$a', '$b', '$c', '$d', '$e', '$f', '$g', '$p', '$h', '$i'];
    rerender(list(live, false, inputsFor(activity)));
    expect(keeper().order).toEqual(ids);
    const held = keeper().inputs;
    fireEvent.pointerCancel(content);
    fireEvent.pointerLeave(content);
    expect(keeper().order).toEqual(live);
    expect(keeper().inputs.get('$p')).not.toBe(held.get('$p'));
    expect(keeper().inputs.get('$c')).toBe(held.get('$c'));
  });

  it('uses live inputs for 12 newcomers after freezing six incumbents', () => {
    const ids = Array.from({ length: 6 }, (_, index) => `$old${index}`);
    const joined = Array.from({ length: 12 }, (_, index) => `$new${index}`);
    const activity = Object.fromEntries([...ids, ...joined].map((id, index) => [id, 40 - index]));
    const frozen = capture(ids, inputsFor(activity).sortInputOf);
    const { rerender } = render(list(ids, false, inputsFor(activity)));
    rerender(list(ids, false, inputsFor(activity, frozen)));
    rerender(
      list(applyFrozenThreadOrder(ids, [...ids, ...joined]), false, inputsFor(activity, frozen))
    );
    const before = keeper().inputs;
    const mover = joined[5]!;
    const live = [mover, ...ids, ...joined.filter((id) => id !== mover)];
    rerender(
      list(
        applyFrozenThreadOrder(ids, live),
        false,
        inputsFor({ ...activity, [mover]: 99 }, frozen)
      )
    );
    expect(keeper().order[6]).toBe(mover);
    expect(keeper().inputs.get(mover)).not.toBe(before.get(mover));
    expect(keeper().inputs.get(joined[6]!)).toBe(before.get(joined[6]!));
  });

  it('keeps the captured key on return from a thread after the leader gets a reply', () => {
    const ids = ['$a', '$b', '$k', '$c'];
    const before = inputsFor({ $a: 4, $b: 3, $k: 2, $c: 1 });
    const first = render(list(ids, false, before));
    const liveKey = keeper().inputs.get('$k');
    const frozen = capture(ids, before.sortInputOf);
    first.rerender(list(ids, false, inputsFor({ $a: 4, $b: 3, $k: 2, $c: 1 }, frozen)));
    first.unmount();
    const activity = { $a: 4, $b: 3, $k: 6, $c: 1 };
    const { rerender } = render(list(ids, false, inputsFor(activity, frozen)));
    expect(keeper().inputs.get('$k')).toBe(liveKey);
    rerender(list(['$k', '$a', '$b', '$c'], false, inputsFor(activity)));
    expect(keeper().inputs.get('$k')).not.toBe(liveKey);
  });

  it('does not treat a captured mover as unchanged if freeze provenance was never recorded', () => {
    const ids = ['$a', '$b', '$k', '$c'];
    const activity = { $a: 4, $b: 3, $k: 6, $c: 1, $new: 2 };
    const { rerender } = render(
      list(
        [...ids, '$new'],
        false,
        inputsFor(activity, {
          controlSignature: 'lastReply:desc',
          orderedRootIds: ids,
        })
      )
    );
    const before = keeper().inputs;
    expect(before.has('$k')).toBe(false);
    expect(before.has('$new')).toBe(true);
    rerender(list(['$k', '$a', '$b', '$new', '$c'], false, inputsFor(activity)));
    expect(keeper().inputs.has('$k')).toBe(true);
  });
});
