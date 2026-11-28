// @vitest-environment jsdom
import { Activity } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EventType, MatrixEvent, SyncState, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MINDROOM_THREAD_TAGS_EVENT,
  buildPerTagStateKey,
} from '../../event-store/threads/threadTags';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { LONG_PRESS_MS } from '../../lib/hooks/useLongPress';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { StateEvent } from '../../matrix/types/room';
import { stubCompactLayout, tickFrames } from '../../threads/overview/compactBlocks.test.shared';
import type { DesktopBridge, DesktopShellEvent } from '../../lib/desktopBridge';
import { installDesktopHistorySwipe } from '../../navigation/desktopHistorySwipe';
import { SwipeList } from '../../threads/overview/CompactCardSwipe.css';
import type { CompactThreadSection } from '../../threads/overview/compactThreadSections';
import { resetPendingThreadTagsForTests } from '../../threads/tags/threadTagPending';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { makeSpaceThreadEntry, SPACE_THREADS_TEST_NOW as NOW } from './spaceThreads.test.shared';
import type { SpaceRoomItem } from './spaceThreadsModel';
import { SpaceThreadsPassiveContext } from '../spaceUnderLayerContext';
import { SpaceThreadsList, type SpaceThreadsListProps } from './SpaceThreadsList';

const ME = '@me:example.org';
const ROOM_A = '!eng:example.org';
const ROOM_B = '!des:example.org';

const entry = (
  roomId: string,
  threadRootId: string,
  summaryText: string,
  extra?: Partial<Parameters<typeof makeSpaceThreadEntry>[0]>
) =>
  makeSpaceThreadEntry({
    roomId,
    roomName: roomId === ROOM_A ? 'Engineering' : 'Design',
    threadRootId,
    summaryText,
    ...extra,
  });

type MockMenuProps = {
  room: Room;
  rootId: string;
  summaryText?: string;
  anchor: { x: number; y: number; width: number; height: number };
  onClose: () => void;
  onOpenThread?: () => void;
  initialDialog?: 'snooze';
};

const { menuProps } = vi.hoisted(() => ({ menuProps: vi.fn<(props: MockMenuProps) => void>() }));

vi.mock('../../threads/ThreadActionsMenu', () => ({
  ThreadActionsMenu: (props: MockMenuProps) => {
    menuProps(props);
    return <div data-testid="mock-thread-actions-menu" data-root={props.rootId} />;
  },
}));

const badgeMocks = vi.hoisted(() => ({ renders: 0 }));
vi.mock('../../threads/overview/ThreadCardBadges', () => ({
  ThreadCardBadges: () => {
    badgeMocks.renders += 1;
    return <span data-testid="plugin-thread-badge" />;
  },
}));

const makeDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const makeRoom = (
  roomId: string,
  name: string,
  opts: {
    userLevel?: number;
    stateDefault?: number;
    knownRootIds?: string[];
    pinnedIds?: string[];
    tagEvents?: MatrixEvent[];
  } = {}
): Room => {
  const knownRoots = new Map(
    (opts.knownRootIds ?? []).map((id) => {
      const ev = new MatrixEvent({
        event_id: id,
        room_id: roomId,
        type: 'm.room.message',
        sender: ME,
        content: { msgtype: 'm.text', body: id },
      });
      Object.defineProperty(ev, 'isThreadRoot', { value: true });
      return [id, ev] as const;
    })
  );
  const powerEvent = {
    getContent: () => ({
      users_default: opts.userLevel ?? 50,
      state_default: opts.stateDefault ?? 50,
      events_default: 0,
    }),
  };
  const createEvent = { getContent: () => ({ room_version: '11' }), getSender: () => ME };
  const pinnedEvent = new MatrixEvent({
    event_id: `$pins-${roomId}`,
    room_id: roomId,
    type: StateEvent.RoomPinnedEvents,
    state_key: '',
    sender: ME,
    content: { pinned: opts.pinnedIds ?? [] },
  });
  const state = {
    getStateEvents: (type: string, stateKey?: string) => {
      if (type === (StateEvent.RoomPowerLevels as string)) return powerEvent;
      if (type === (StateEvent.RoomCreate as string)) return createEvent;
      if (type === (StateEvent.RoomPinnedEvents as string)) return pinnedEvent;
      if (type === MINDROOM_THREAD_TAGS_EVENT) return opts.tagEvents ?? [];
      return stateKey === undefined ? [] : null;
    },
  };
  return {
    roomId,
    name,
    getMember: () => null,
    getMembers: () => [],
    getThread: (id: string) => {
      const rootEvent = knownRoots.get(id);
      return rootEvent
        ? { rootEvent, findEventById: () => rootEvent, initialize: () => Promise.resolve() }
        : undefined;
    },
    findEventById: (id: string) => knownRoots.get(id),
    getUnfilteredTimelineSet: () => ({ findEventById: () => undefined }),
    getLiveTimeline: () => ({ getState: () => state }),
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as Room;
};

const renderScenario = ({
  rooms,
  entries,
  sendStateEvent = vi.fn().mockResolvedValue({ event_id: '$sent' }),
  sections,
  pinnedByRoom,
  scrollMemory,
  scrollMemoryKey = '!space:example.org',
  onOpenThread = vi.fn<(roomId: string, threadRootId: string) => void>(),
}: {
  rooms: Room[];
  entries: ReturnType<typeof makeSpaceThreadEntry>[];
  sendStateEvent?: ReturnType<typeof vi.fn>;
  sections?: readonly CompactThreadSection[];
  pinnedByRoom?: ReadonlyMap<string, readonly string[]>;
  scrollMemory?: ScrollAnchorMemory;
  scrollMemoryKey?: string;
  onOpenThread?: (roomId: string, threadRootId: string) => void;
}) => {
  const roomMap = new Map(rooms.map((r) => [r.roomId, r] as const));
  const roomsById = new Map<string, SpaceRoomItem>(
    rooms.map((room, i) => [
      room.roomId,
      { room, name: room.name, accentColor: i ? '#3ba66b' : '#4f8ff7' },
    ])
  );
  const mx = {
    getSafeUserId: () => ME,
    getUserId: () => ME,
    getHomeserverUrl: () => 'https://example.org',
    getRoom: (id: string) => roomMap.get(id) ?? null,
    getSyncState: () => SyncState.Syncing,
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
    mxcUrlToHttp: () => null,
    sendStateEvent,
    getStateEvent: vi.fn().mockImplementation(async (roomId: string, type: string) => {
      if (type !== (EventType.RoomPinnedEvents as string)) return {};
      return (
        roomMap
          .get(roomId)
          ?.getLiveTimeline()
          .getState('f' as never)
          ?.getStateEvents(type, '')
          ?.getContent() ?? { pinned: [] }
      );
    }),
  } as unknown as MatrixClient;
  rooms.forEach((room) => {
    Object.assign(room, { client: mx });
  });
  const baseProps: SpaceThreadsListProps = {
    entryKeys: entries.map((e) => e.key),
    entryByKey: new Map(entries.map((e) => [e.key, e])),
    sections,
    foldedSections: [],
    onToggleSectionFold: vi.fn(),
    roomsById,
    pinnedByRoom,
    showRoomBadge: true,
    snoozeNow: NOW,
    metaVersion: 1,
    showLoading: false,
    scrollMemory,
    scrollMemoryKey,
    onOpenThread,
  };
  const wrap = (props: SpaceThreadsListProps) => (
    <ScreenSizeProvider value={ScreenSize.Desktop}>
      <MatrixClientProvider value={mx}>
        <SpaceThreadsList {...props} />
      </MatrixClientProvider>
    </ScreenSizeProvider>
  );
  const view = render(wrap(baseProps));
  const shellOf = (roomId: string, rootId: string) =>
    view.container.querySelector<HTMLElement>(
      `[data-room-id="${roomId}"][data-scroll-anchor="${rootId}"]`
    )!;
  const rerenderProps = (overrides: Partial<SpaceThreadsListProps>) =>
    view.rerender(wrap({ ...baseProps, ...overrides }));
  return { ...view, mx, sendStateEvent, roomsById, onOpenThread, shellOf, rerenderProps };
};

const swipeCard = (shell: HTMLElement, toX = 70) => {
  const track = shell.querySelector<HTMLElement>('[data-compact-card-swipe="track"]')!;
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 100));
  track.setPointerCapture = vi.fn();
  const pointer = (type: string, x: number) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 60 });
    Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true });
    fireEvent(track, event);
  };
  pointer('pointerdown', 280);
  pointer('pointermove', 265);
  pointer('pointermove', toX);
  pointer('pointerup', toX);
};

beforeEach(() => {
  menuProps.mockClear();
  resetPendingThreadTagsForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('SpaceThreadsList', () => {
  it('renders grouped sections and cards as flat siblings in the shared CompactCardList', () => {
    const e1 = entry(ROOM_A, '$a1', 'Alpha');
    const e2 = entry(ROOM_B, '$b1', 'Beta');
    const { container } = renderScenario({
      rooms: [makeRoom(ROOM_A, 'Engineering'), makeRoom(ROOM_B, 'Design')],
      entries: [e1, e2],
      sections: [
        { id: 'needsYou', rootIds: [e1.key] },
        { id: 'working', rootIds: [e2.key] },
      ],
    });

    const headers = [...container.querySelectorAll('[data-compact-section]')];
    const shells = [...container.querySelectorAll('[data-scroll-anchor]')];
    const listEl = headers[0]!.parentElement!;
    expect(listEl.className).toContain(SwipeList);
    expect([...listEl.children]).toEqual([headers[0], shells[0], headers[1], shells[1]]);
  });

  it('resolves in the right room, clears snooze, disables while in-flight, and hides Resolve on pinned/resolved/read-only cards', async () => {
    const snoozeEvent = new MatrixEvent({
      type: MINDROOM_THREAD_TAGS_EVENT,
      state_key: buildPerTagStateKey('$a1', 'snoozed'),
      sender: ME,
      content: {
        set_by: ME,
        set_at: '2026-11-24T10:00:00.000Z',
        data: { until: '2099-01-01T00:00:00.000Z' },
      },
    });
    const firstWrite = makeDeferred<{ event_id: string }>();
    const sendStateEvent = vi
      .fn()
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValue({ event_id: '$cleared' });
    const { shellOf } = renderScenario({
      rooms: [
        makeRoom(ROOM_A, 'Engineering', {
          knownRootIds: ['$a1', '$a2', '$a-pinned', '$a-done'],
          pinnedIds: ['$a-pinned'],
          tagEvents: [snoozeEvent],
        }),
        makeRoom(ROOM_B, 'Read Only', { userLevel: 0, knownRootIds: ['$b1'] }),
      ],
      entries: [
        entry(ROOM_A, '$a1', 'Snoozed', { snoozedUntilTs: Date.UTC(2099, 0, 1) }),
        entry(ROOM_A, '$a2', 'Open'),
        entry(ROOM_A, '$a-pinned', 'Pinned'),
        entry(ROOM_A, '$a-done', 'Done', { isResolved: true }),
        entry(ROOM_A, '~local-root', 'Sending locally'),
        entry(ROOM_B, '$b1', 'Read-only'),
      ],
      pinnedByRoom: new Map([[ROOM_A, ['$a-pinned']]]),
      sendStateEvent,
    });

    expect(shellOf(ROOM_A, '$a-pinned').querySelector('[data-compact-thread-resolve]')).toBeNull();
    expect(shellOf(ROOM_A, '$a-done').querySelector('[data-compact-thread-resolve]')).toBeNull();
    expect(
      shellOf(ROOM_A, '~local-root').querySelector('[data-compact-thread-resolve]')
    ).toBeNull();
    expect(shellOf(ROOM_A, '~local-root').querySelector('[data-compact-thread-pin]')).toBeNull();
    expect(shellOf(ROOM_B, '$b1').querySelector('[data-compact-thread-resolve]')).toBeNull();

    const a1Resolve = shellOf(ROOM_A, '$a1').querySelector<HTMLButtonElement>(
      '[data-compact-thread-resolve]'
    )!;
    const a2Resolve = shellOf(ROOM_A, '$a2').querySelector<HTMLButtonElement>(
      '[data-compact-thread-resolve]'
    )!;
    fireEvent.click(a1Resolve);
    expect(a1Resolve.disabled).toBe(true);
    expect(a2Resolve.disabled).toBe(false);
    expect(sendStateEvent).toHaveBeenCalledWith(
      ROOM_A,
      MINDROOM_THREAD_TAGS_EVENT,
      expect.objectContaining({ set_by: ME }),
      buildPerTagStateKey('$a1', 'resolved')
    );

    await act(async () => {
      firstWrite.resolve({ event_id: '$resolved' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sendStateEvent).toHaveBeenNthCalledWith(
      2,
      ROOM_A,
      MINDROOM_THREAD_TAGS_EVENT,
      {},
      buildPerTagStateKey('$a1', 'snoozed')
    );
    expect(a1Resolve.disabled).toBe(false);
  });

  it('pins and unpins in the right room according to per-room power levels and reports failure', async () => {
    const pinWrite = makeDeferred<{ event_id: string }>();
    const sendStateEvent = vi
      .fn()
      .mockReturnValueOnce(pinWrite.promise)
      .mockRejectedValueOnce(new Error('network error'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { shellOf } = renderScenario({
      rooms: [
        makeRoom(ROOM_A, 'Engineering', { pinnedIds: ['$a-pinned'] }),
        makeRoom(ROOM_B, 'Read Only', { userLevel: 0 }),
      ],
      entries: [
        entry(ROOM_A, '$a-open', 'Open'),
        entry(ROOM_A, '$a-pinned', 'Pinned'),
        entry(ROOM_B, '$b-open', 'Read-only'),
      ],
      pinnedByRoom: new Map([[ROOM_A, ['$a-pinned']]]),
      sendStateEvent,
    });

    const pinOpenBtn = shellOf(ROOM_A, '$a-open').querySelector<HTMLButtonElement>(
      '[data-compact-thread-pin]'
    )!;
    const unpinBtn = shellOf(ROOM_A, '$a-pinned').querySelector<HTMLButtonElement>(
      '[data-compact-thread-pin]'
    )!;
    expect(shellOf(ROOM_B, '$b-open').querySelector('[data-compact-thread-pin]')).toBeNull();

    fireEvent.click(pinOpenBtn);
    await act(async () => {
      await Promise.resolve();
    });
    expect(pinOpenBtn.disabled).toBe(true);
    expect(unpinBtn.disabled).toBe(true);
    expect(sendStateEvent).toHaveBeenCalledWith(
      ROOM_A,
      EventType.RoomPinnedEvents,
      { pinned: ['$a-pinned', '$a-open'] },
      ''
    );

    await act(async () => {
      pinWrite.resolve({ event_id: '$pin-ok' });
      await Promise.resolve();
    });
    expect(pinOpenBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(unpinBtn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sendStateEvent).toHaveBeenLastCalledWith(
      ROOM_A,
      EventType.RoomPinnedEvents,
      { pinned: [] },
      ''
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(consoleError).toHaveBeenCalled();
  });

  it('opens ThreadActionsMenu via ⋯, right-click, long-press, and Shift+F10, restores room-scoped focus, and closes when room disappears', async () => {
    vi.useFakeTimers();
    const roomA = makeRoom(ROOM_A, 'Engineering');
    const roomB = makeRoom(ROOM_B, 'Design');
    const { shellOf, roomsById, onOpenThread, rerenderProps } = renderScenario({
      rooms: [roomA, roomB],
      entries: [
        entry(ROOM_A, '$shared', 'Eng summary'),
        entry(ROOM_B, '$shared', 'Design summary'),
      ],
    });
    const shellB = shellOf(ROOM_B, '$shared');
    const moreB = shellB.querySelector<HTMLButtonElement>('[data-compact-thread-more]')!;
    const cardButtonB = shellB.querySelector<HTMLButtonElement>('[data-thread-root-id]')!;

    // ⋯ click and focus restoration
    await act(async () => {
      fireEvent.click(moreB);
      await Promise.resolve();
    });
    expect(menuProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ room: roomB, rootId: '$shared', summaryText: 'Design summary' })
    );
    act(() => menuProps.mock.lastCall![0].onClose());
    expect(document.activeElement).toBe(moreB);

    // Right-click opens at pointer coordinates
    await act(async () => {
      fireEvent.contextMenu(shellB, { clientX: 50, clientY: 80 });
      await Promise.resolve();
    });
    expect(menuProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        room: roomB,
        rootId: '$shared',
        anchor: { x: 50, y: 80, width: 0, height: 0 },
      })
    );
    act(() => menuProps.mock.lastCall![0].onClose());
    expect(document.activeElement).toBe(cardButtonB);

    // Shift+F10 on Resolve button, then button detaches -> room-scoped fallback focuses Room B card (not Room A)
    const resolveB = shellB.querySelector<HTMLButtonElement>('[data-compact-thread-resolve]')!;
    await act(async () => {
      fireEvent.keyDown(resolveB, { key: 'F10', shiftKey: true });
      await Promise.resolve();
    });
    rerenderProps({ pinnedByRoom: new Map([[ROOM_B, ['$shared']]]) });
    expect(resolveB.isConnected).toBe(false);
    act(() => menuProps.mock.lastCall![0].onClose());
    expect(document.activeElement).toBe(cardButtonB);

    // Shift+F10 + Open thread
    await act(async () => {
      fireEvent.keyDown(cardButtonB, { key: 'F10', shiftKey: true });
      await Promise.resolve();
    });
    act(() => menuProps.mock.lastCall![0].onOpenThread?.());
    expect(onOpenThread).toHaveBeenCalledWith(ROOM_B, '$shared');
    expect(screen.queryByTestId('mock-thread-actions-menu')).toBeNull();

    // Long-press opens menu; removing its room closes it cleanly
    fireEvent.touchStart(shellB, { touches: [{ clientX: 40, clientY: 60, identifier: 1 }] });
    await act(async () => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
      await Promise.resolve();
    });
    expect(screen.getByTestId('mock-thread-actions-menu')).toBeTruthy();
    rerenderProps({ roomsById: new Map([[ROOM_A, roomsById.get(ROOM_A)!]]) });
    expect(screen.queryByTestId('mock-thread-actions-menu')).toBeNull();
  });

  it('resolves/reopens non-pinned threads via touch swipe and blocks swipe for pinned or read-only cards', async () => {
    const sendStateEvent = vi.fn().mockResolvedValue({ event_id: '$ok' });
    const { shellOf } = renderScenario({
      rooms: [
        makeRoom(ROOM_A, 'Engineering', {
          knownRootIds: ['$a-open', '$a-done', '$a-pinned'],
          pinnedIds: ['$a-pinned'],
        }),
        makeRoom(ROOM_B, 'Read Only', { userLevel: 0, knownRootIds: ['$b-open'] }),
      ],
      entries: [
        entry(ROOM_A, '$a-open', 'Open'),
        entry(ROOM_A, '$a-done', 'Done', { isResolved: true }),
        entry(ROOM_A, '$a-pinned', 'Pinned'),
        entry(ROOM_B, '$b-open', 'Read-only'),
      ],
      pinnedByRoom: new Map([[ROOM_A, ['$a-pinned']]]),
      sendStateEvent,
    });

    await act(async () => {
      swipeCard(shellOf(ROOM_A, '$a-open'));
      await Promise.resolve();
    });
    expect(sendStateEvent).toHaveBeenCalledWith(
      ROOM_A,
      MINDROOM_THREAD_TAGS_EVENT,
      expect.objectContaining({ set_by: ME }),
      buildPerTagStateKey('$a-open', 'resolved')
    );

    await act(async () => {
      swipeCard(shellOf(ROOM_A, '$a-done'));
      await Promise.resolve();
    });
    expect(sendStateEvent).toHaveBeenCalledWith(
      ROOM_A,
      MINDROOM_THREAD_TAGS_EVENT,
      {},
      buildPerTagStateKey('$a-done', 'resolved')
    );

    sendStateEvent.mockClear();
    await act(async () => {
      swipeCard(shellOf(ROOM_A, '$a-pinned'));
      swipeCard(shellOf(ROOM_B, '$b-open'));
      await Promise.resolve();
    });
    expect(sendStateEvent).not.toHaveBeenCalled();
  });

  it('parks open on short swipe to open Snooze picker, Unsnooze directly, or Resolve in the right room', async () => {
    const sendStateEvent = vi.fn().mockResolvedValue({ event_id: '$ok' });
    const roomA = makeRoom(ROOM_A, 'Engineering', {
      knownRootIds: ['$a-open', '$a-snoozed'],
    });
    const { shellOf } = renderScenario({
      rooms: [roomA],
      entries: [
        entry(ROOM_A, '$a-open', 'Open'),
        entry(ROOM_A, '$a-snoozed', 'Snoozed', { snoozedUntilTs: Date.UTC(2099, 0, 1) }),
      ],
      sendStateEvent,
    });

    // Short swipe (100px) on open card parks open and Snooze opens SnoozePicker via ThreadActionsMenu.
    const openShell = shellOf(ROOM_A, '$a-open');
    swipeCard(openShell, 165);
    const snoozeBtn = openShell.querySelector<HTMLButtonElement>(
      '[data-compact-card-swipe-action="snooze"]'
    )!;
    expect(snoozeBtn.textContent).toBe('Snooze');
    await act(async () => {
      fireEvent.click(snoozeBtn);
      await Promise.resolve();
    });
    expect(menuProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ room: roomA, rootId: '$a-open', initialDialog: 'snooze' })
    );
    act(() => menuProps.mock.lastCall![0].onClose());

    // Short swipe on snoozed card shows Unsnooze and clears the snoozed tag directly.
    const snoozedShell = shellOf(ROOM_A, '$a-snoozed');
    swipeCard(snoozedShell, 165);
    const unsnoozeBtn = snoozedShell.querySelector<HTMLButtonElement>(
      '[data-compact-card-swipe-action="snooze"]'
    )!;
    expect(unsnoozeBtn.textContent).toBe('Unsnooze');
    await act(async () => {
      fireEvent.click(unsnoozeBtn);
      await Promise.resolve();
    });
    expect(sendStateEvent).toHaveBeenCalledWith(
      ROOM_A,
      MINDROOM_THREAD_TAGS_EVENT,
      {},
      buildPerTagStateKey('$a-snoozed', 'snoozed')
    );

    // Activating keyboard-focused Unsnooze restores focus to [data-thread-root-id].
    const snoozedCardBtn = snoozedShell.querySelector<HTMLButtonElement>(
      '[data-thread-root-id="$a-snoozed"]'
    )!;
    const snoozedFocusSpy = vi.spyOn(snoozedCardBtn, 'focus');
    swipeCard(snoozedShell, 165);
    const focusedUnsnoozeBtn = snoozedShell.querySelector<HTMLButtonElement>(
      '[data-compact-card-swipe-action="snooze"]'
    )!;
    focusedUnsnoozeBtn.focus();
    await act(async () => {
      fireEvent.click(focusedUnsnoozeBtn);
      await Promise.resolve();
    });
    expect(snoozedFocusSpy).toHaveBeenCalledWith({ preventScroll: true });

    // Touch return-swipe starting directly on the exposed Snooze button closes the tray cleanly.
    swipeCard(openShell, 165);
    const openTrack = openShell.querySelector<HTMLElement>('[data-compact-card-swipe="track"]')!;
    const exposedSnoozeBtn = openShell.querySelector<HTMLButtonElement>(
      '[data-compact-card-swipe-action="snooze"]'
    )!;
    expect(openTrack.style.transform).toBe('translateX(-156px)');
    const trayTouch = (type: string, clientX: number) => {
      const ev = new MouseEvent(type, { bubbles: true, clientX, clientY: 60 });
      Object.assign(ev, { pointerId: 2, pointerType: 'touch', isPrimary: true });
      fireEvent(exposedSnoozeBtn, ev);
    };
    sendStateEvent.mockClear();
    menuProps.mockClear();
    trayTouch('pointerdown', 220);
    trayTouch('pointermove', 235);
    trayTouch('pointermove', 300);
    trayTouch('pointerup', 300);
    expect(openTrack.style.transform).toBe('');
    expect(menuProps).not.toHaveBeenCalled();
    expect(sendStateEvent).not.toHaveBeenCalled();

    // Activating keyboard-focused Resolve restores focus to [data-thread-root-id] and resolves.
    const openCardBtn = openShell.querySelector<HTMLButtonElement>(
      '[data-thread-root-id="$a-open"]'
    )!;
    const openFocusSpy = vi.spyOn(openCardBtn, 'focus');
    swipeCard(openShell, 165);
    const resolveBtn = openShell.querySelector<HTMLButtonElement>(
      '[data-compact-card-swipe-action="resolve"]'
    )!;
    resolveBtn.focus();
    await act(async () => {
      fireEvent.click(resolveBtn);
      await Promise.resolve();
    });
    expect(openFocusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(sendStateEvent).toHaveBeenCalledWith(
      ROOM_A,
      MINDROOM_THREAD_TAGS_EVENT,
      expect.objectContaining({ set_by: ME }),
      buildPerTagStateKey('$a-open', 'resolved')
    );
  });

  it('bounds mounted cards for 3,000 sectioned threads', () => {
    vi.useFakeTimers();
    stubCompactLayout({ viewAttr: 'data-space-threads-list' });
    const entries = Array.from({ length: 3000 }, (_, i) =>
      entry(i % 2 === 0 ? ROOM_A : ROOM_B, `$t-${i}`, `Thread ${i}`)
    );
    const sections: CompactThreadSection[] = [
      { id: 'needsYou', rootIds: entries.slice(0, 1000).map((e) => e.key) },
      { id: 'working', rootIds: entries.slice(1000, 2000).map((e) => e.key) },
      { id: 'quiet', rootIds: entries.slice(2000).map((e) => e.key) },
    ];
    const { container } = renderScenario({
      rooms: [makeRoom(ROOM_A, 'Engineering'), makeRoom(ROOM_B, 'Design')],
      entries,
      sections,
    });
    const list = container.querySelector<HTMLElement>('[data-space-threads-list="true"]')!;
    expect(list.dataset.compactCardCount).toBe('3000');
    expect([...container.querySelectorAll('[data-compact-section]')]).toHaveLength(3);
    expect(container.querySelectorAll('[data-scroll-anchor]').length).toBeLessThanOrEqual(48);
    expect(container.querySelector('[data-thread-root-id="$t-2999"]')).toBeNull();
  }, 15_000);

  it('reaches far-down sectioned threads via End, Home, ArrowDown, and deep scroll', () => {
    vi.useFakeTimers();
    const layout = stubCompactLayout({ viewAttr: 'data-space-threads-list' });
    const entries = Array.from({ length: 150 }, (_, i) =>
      entry(i % 2 === 0 ? ROOM_A : ROOM_B, `$k-${i}`, `Thread ${i}`)
    );
    const sections: CompactThreadSection[] = [
      { id: 'needsYou', rootIds: entries.slice(0, 50).map((e) => e.key) },
      { id: 'working', rootIds: entries.slice(50, 100).map((e) => e.key) },
      { id: 'quiet', rootIds: entries.slice(100).map((e) => e.key) },
    ];
    const { container } = renderScenario({
      rooms: [makeRoom(ROOM_A, 'Engineering'), makeRoom(ROOM_B, 'Design')],
      entries,
      sections,
    });
    const list = container.querySelector<HTMLElement>('[data-space-threads-list="true"]')!;
    expect(container.querySelectorAll('[data-scroll-anchor]').length).toBeLessThanOrEqual(48);
    expect(container.querySelector('[data-thread-root-id="$k-149"]')).toBeNull();

    // End materializes and focuses the far-down thread in Quiet while keeping mounted cards bounded.
    const firstCard = container.querySelector<HTMLElement>('[data-thread-root-id="$k-0"]')!;
    firstCard.focus();
    fireEvent.keyDown(firstCard, { key: 'End' });
    tickFrames(16);
    const lastCard = container.querySelector<HTMLElement>('[data-thread-root-id="$k-149"]')!;
    expect(lastCard).not.toBeNull();
    expect(document.activeElement).toBe(lastCard);
    expect(container.querySelectorAll('[data-scroll-anchor]').length).toBeLessThanOrEqual(60);

    // Home returns to the top card, and ArrowDown moves to the next card.
    fireEvent.keyDown(lastCard, { key: 'Home' });
    expect(document.activeElement).toBe(
      container.querySelector<HTMLElement>('[data-thread-root-id="$k-0"]')
    );
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(
      container.querySelector<HTMLElement>('[data-thread-root-id="$k-1"]')
    );

    // Scrolling deep mounts the visible band and keeps mounted cards bounded.
    layout.scroll(list, 7_500);
    expect(container.querySelectorAll('[data-scroll-anchor]').length).toBeLessThanOrEqual(60);
    expect(container.querySelector('[data-thread-root-id="$k-75"]')).not.toBeNull();
  }, 30_000);

  it('restores a far-down scroll position and mounts its thread on return after unmount/remount', () => {
    vi.useFakeTimers();
    const layout = stubCompactLayout({ viewAttr: 'data-space-threads-list' });
    const scrollMemory: ScrollAnchorMemory = new Map();
    const entries = Array.from({ length: 96 }, (_, i) =>
      entry(i % 2 === 0 ? ROOM_A : ROOM_B, `$ret-${i}`, `Return thread ${i}`)
    );
    const rooms = [makeRoom(ROOM_A, 'Engineering'), makeRoom(ROOM_B, 'Design')];
    const first = renderScenario({
      rooms,
      entries,
      scrollMemory,
      scrollMemoryKey: '!space:example.org',
    });
    const firstList = first.container.querySelector<HTMLElement>(
      '[data-space-threads-list="true"]'
    )!;
    tickFrames(10);
    layout.scroll(firstList, 6000);
    expect(first.container.querySelector('[data-thread-root-id="$ret-60"]')).not.toBeNull();
    expect(first.container.querySelector('[data-thread-root-id="$ret-0"]')).toBeNull();

    // Unmount as when navigating into the thread, then remount on return (#923).
    first.unmount();
    expect(scrollMemory.get('!space:example.org')?.scrollTop).toBe(6000);

    const returned = renderScenario({
      rooms,
      entries,
      scrollMemory,
      scrollMemoryKey: '!space:example.org',
    });
    const returnedList = returned.container.querySelector<HTMLElement>(
      '[data-space-threads-list="true"]'
    )!;
    expect(returnedList.scrollTop).toBe(6000);
    expect(returned.container.querySelector('[data-thread-root-id="$ret-60"]')).not.toBeNull();
    expect(returned.container.querySelectorAll('[data-scroll-anchor]').length).toBeLessThanOrEqual(
      48
    );
  }, 30_000);
  it('preserves scrollTop and avoids block-0 flash across Activity visible -> hidden -> visible and suppresses plugin badges while passive', () => {
    vi.useFakeTimers();
    badgeMocks.renders = 0;
    const layout = stubCompactLayout({ viewAttr: 'data-space-threads-list' });
    const scrollMemory: ScrollAnchorMemory = new Map();
    const entries = Array.from({ length: 96 }, (_, i) =>
      entry(i % 2 === 0 ? ROOM_A : ROOM_B, `$act-${i}`, `Activity thread ${i}`)
    );
    const rooms = [makeRoom(ROOM_A, 'Engineering'), makeRoom(ROOM_B, 'Design')];
    const roomMap = new Map(rooms.map((r) => [r.roomId, r] as const));
    const mx = {
      getSafeUserId: () => ME,
      getUserId: () => ME,
      getHomeserverUrl: () => 'https://example.org',
      getRoom: (id: string) => roomMap.get(id) ?? null,
      getSyncState: () => SyncState.Syncing,
      on: vi.fn(),
      off: vi.fn(),
      removeListener: vi.fn(),
      mxcUrlToHttp: () => null,
    } as unknown as MatrixClient;
    rooms.forEach((room) => Object.assign(room, { client: mx }));
    const roomsById = new Map(
      rooms.map((room, i) => [
        room.roomId,
        { room, name: room.name, accentColor: i === 0 ? '#111' : '#222' },
      ])
    );
    const entryKeys = entries.map((e) => e.key);
    const entryByKey = new Map(entries.map((e) => [e.key, e]));

    const viewOf = (
      mode: 'visible' | 'hidden',
      passive: boolean,
      keys = entryKeys,
      byKey = entryByKey
    ) => (
      <MatrixClientProvider value={mx}>
        <SpaceThreadsPassiveContext.Provider value={passive}>
          <Activity mode={mode}>
            <SpaceThreadsList
              entryKeys={keys}
              entryByKey={byKey}
              foldedSections={[]}
              onToggleSectionFold={() => undefined}
              roomsById={roomsById}
              showRoomBadge
              snoozeNow={1_000}
              metaVersion={0}
              showLoading={false}
              scrollMemory={scrollMemory}
              scrollMemoryKey="!space:example.org"
              onOpenThread={() => undefined}
            />
          </Activity>
        </SpaceThreadsPassiveContext.Provider>
      </MatrixClientProvider>
    );

    const rendered = render(viewOf('visible', false));
    const list = rendered.container.querySelector<HTMLElement>('[data-space-threads-list="true"]')!;
    tickFrames(10);
    layout.scroll(list, 6000);
    expect(rendered.container.querySelector('[data-thread-root-id="$act-60"]')).not.toBeNull();
    expect(rendered.container.querySelector('[data-thread-root-id="$act-0"]')).toBeNull();

    // Hide via <Activity mode="hidden">.
    rendered.rerender(viewOf('hidden', false));
    expect(scrollMemory.get('!space:example.org')?.scrollTop).toBe(6000);

    // Simulate WebKit resetting scrollTop to 0 under display: none.
    list.scrollTop = 0;
    const rendersBeforePeek = badgeMocks.renders;

    // Reveal passively (as during a swipe-back peek): scrollTop restores synchronously before
    // useCompactBlocks layout(), block-0 never flashes, and plugin badges stay unmounted.
    rendered.rerender(viewOf('visible', true));
    expect(list.scrollTop).toBe(6000);
    expect(rendered.container.querySelector('[data-thread-root-id="$act-60"]')).not.toBeNull();
    expect(rendered.container.querySelector('[data-thread-root-id="$act-0"]')).toBeNull();
    expect(badgeMocks.renders).toBe(rendersBeforePeek);
    expect(rendered.container.querySelector('[data-testid="plugin-thread-badge"]')).toBeNull();

    // Reveal actively on commit: scrollTop stays at 6000 and plugin badges mount again.
    rendered.rerender(viewOf('visible', false));
    expect(list.scrollTop).toBe(6000);
    expect(badgeMocks.renders).toBeGreaterThan(rendersBeforePeek);

    // 2nd hide -> insert a new thread at the top while hidden -> reveal tracks anchored card
    // instead of keeping stale raw pixel scrollTop=6000.
    const anchorTopBefore2ndHide = rendered.container
      .querySelector<HTMLElement>('[data-scroll-anchor="$act-60"]')!
      .getBoundingClientRect().top;
    rendered.rerender(viewOf('hidden', false));
    list.scrollTop = 0;
    const inserted = entry(ROOM_A, '$act-new-top', 'Inserted while hidden');
    const nextKeys = [inserted.key, ...entryKeys];
    const nextByKey = new Map([[inserted.key, inserted], ...entryByKey]);
    rendered.rerender(viewOf('visible', false, nextKeys, nextByKey));
    tickFrames(4);
    expect(list.scrollTop).toBe(6100);
    const anchorTopAfter2ndReveal = rendered.container
      .querySelector<HTMLElement>('[data-scroll-anchor="$act-60"]')!
      .getBoundingClientRect().top;
    expect(Math.abs(anchorTopAfter2ndReveal - anchorTopBefore2ndHide)).toBeLessThanOrEqual(2);
  }, 30_000);

  it('arbitrates macOS Electron trackpad swipes with desktopHistorySwipe across non-cancelable wheels, horizontal scrollers, and swipe-tracking=false', async () => {
    const shellListeners = new Set<(event: DesktopShellEvent) => void>();
    const emitShell = (event: DesktopShellEvent) =>
      act(() => shellListeners.forEach((listener) => listener(event)));
    const bridge: Partial<DesktopBridge> = {
      onShellEvent: (listener) => {
        shellListeners.add(listener);
        return () => void shellListeners.delete(listener);
      },
    };
    const origPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
    const origUserAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Macintosh' });
    Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: bridge });
    Object.defineProperty(window, 'navigation', {
      configurable: true,
      value: { canGoBack: true, canGoForward: true },
    });
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const forwardSpy = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const stopHistory = installDesktopHistorySwipe(window, {
      isMac: () => true,
      allowUntrusted: true,
    });
    emitShell({ type: 'swipe-tracking', enabled: true });

    try {
      const sendStateEvent = vi.fn().mockResolvedValue({ event_id: '$ok' });
      const { shellOf } = renderScenario({
        rooms: [makeRoom(ROOM_A, 'Engineering', { knownRootIds: ['$a1'] })],
        entries: [entry(ROOM_A, '$a1', 'Alpha')],
        sendStateEvent,
      });
      const shell = shellOf(ROOM_A, '$a1');
      const track = shell.querySelector<HTMLElement>('[data-compact-card-swipe="track"]')!;
      vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 100));

      const wheel = (
        deltaX: number,
        opts: { deltaY?: number; cancelable?: boolean; target?: HTMLElement } = {}
      ) => {
        const event = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: opts.cancelable ?? true,
          deltaMode: 0,
          deltaX,
          deltaY: opts.deltaY ?? 0,
        });
        act(() => {
          (opts.target ?? track).dispatchEvent(event);
        });
      };

      // 1. Small initial wheel + cancelable:false follow-ups swiping LEFT on a closed card
      //    parks open and NEVER navigates Forward.
      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      wheel(4, { cancelable: true });
      wheel(50, { cancelable: false });
      wheel(60, { cancelable: false });
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(forwardSpy).not.toHaveBeenCalled();
      expect(track.style.transform).toBe('translateX(-156px)');

      // 2. Pressing Escape while focus is on the parked Snooze button closes the tray AND
      //    restores focus to the card button with preventScroll:true.
      const snoozeBtn = shell.querySelector<HTMLButtonElement>(
        '[data-compact-card-swipe-action="snooze"]'
      )!;
      const cardBtn = shell.querySelector<HTMLButtonElement>('[data-thread-root-id="$a1"]')!;
      const focusSpy = vi.spyOn(cardBtn, 'focus');
      snoozeBtn.focus();
      expect(document.activeElement).toBe(snoozeBtn);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(track.style.transform).toBe('');
      expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
      expect(document.activeElement).toBe(cardBtn);

      // 3. Re-park, then swipe RIGHT with cancelable:false follow-ups -> closes card and NEVER navigates Back.
      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      wheel(4, { cancelable: true });
      wheel(90, { cancelable: false });
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(track.style.transform).toBe('translateX(-156px)');

      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      wheel(-4, { cancelable: true });
      wheel(-40, { cancelable: false });
      wheel(-40, { cancelable: false });
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(backSpy).not.toHaveBeenCalled();
      expect(track.style.transform).toBe('');

      // 4. Swiping RIGHT on a closed card STILL triggers Back navigation.
      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      wheel(-30);
      wheel(-30);
      wheel(-30);
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(backSpy).toHaveBeenCalledTimes(1);
      expect(track.style.transform).toBe('');

      // 5. Horizontally scrollable ancestor (e.g. narrow board): closed card yields to horizontal scroll.
      const listEl = shell.parentElement!;
      Object.defineProperty(listEl, 'scrollWidth', { configurable: true, value: 800 });
      Object.defineProperty(listEl, 'clientWidth', { configurable: true, value: 300 });
      const origOverflowX = listEl.style.overflowX;
      listEl.style.overflowX = 'auto';
      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      wheel(80);
      wheel(120);
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(track.style.transform).toBe('');
      expect(sendStateEvent).not.toHaveBeenCalled();
      listEl.style.overflowX = origOverflowX;
      Object.defineProperty(listEl, 'scrollWidth', { configurable: true, value: 300 });

      // 6. With macOS "Swipe between pages" off (swipe-tracking=false), card swipe STILL parks
      //    and deep-resolves, while Back/Forward stays disabled.
      emitShell({ type: 'swipe-tracking', enabled: false });
      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      wheel(-30);
      wheel(-30);
      wheel(-30);
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(backSpy).toHaveBeenCalledTimes(1); // still 1 (Back disabled)

      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      wheel(90);
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(track.style.transform).toBe('translateX(-156px)');

      // Tiny <= 8px scrollTop drift right after parking does not dismiss the parked card,
      // while real > 8px vertical scrolling closes it immediately.
      const scrollEl = shell.closest<HTMLElement>('[data-space-threads-list="true"]')!;
      Object.defineProperty(scrollEl, 'scrollTop', {
        configurable: true,
        writable: true,
        value: 0,
      });
      scrollEl.scrollTop = 8;
      fireEvent.scroll(scrollEl);
      expect(track.style.transform).toBe('translateX(-156px)');
      scrollEl.scrollTop = 9;
      fireEvent.scroll(scrollEl);
      expect(track.style.transform).toBe('');

      // Sloppy diagonal scroll (|x| < 1.5 * |y|) does not claim or wiggle a closed card.
      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      wheel(12, { deltaY: 10 });
      wheel(30, { deltaY: 10 });
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(track.style.transform).toBe('');

      // Re-park, then send a mostly-vertical scroll starting (14, 8) -> (0, 80) + end:
      // even though +14px crosses the deep threshold from parked, cumulative diagonal drift cancels
      // the claim so vertical scrolling never resolves the thread.
      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      wheel(90);
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(track.style.transform).toBe('translateX(-156px)');
      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      wheel(14, { deltaY: 8 });
      wheel(0, { deltaY: 80 });
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(track.style.transform).toBe('');
      expect(sendStateEvent).not.toHaveBeenCalled();

      // Clicking the explicit More button on a parked card closes the tray AND opens the menu,
      // while clicking the card body closes the tray and swallows the click.
      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      wheel(90);
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(track.style.transform).toBe('translateX(-156px)');
      menuProps.mockClear();
      const moreBtn = shell.querySelector<HTMLButtonElement>('[data-compact-thread-more="true"]')!;
      await act(async () => {
        fireEvent.click(moreBtn, { detail: 1 });
        await Promise.resolve();
      });
      expect(track.style.transform).toBe('');
      expect(menuProps).toHaveBeenLastCalledWith(expect.objectContaining({ rootId: '$a1' }));
      act(() => menuProps.mock.lastCall![0].onClose());

      // Re-park and confirm trackpad vertical scroll gesture closes the parked card cleanly.
      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      wheel(90);
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(track.style.transform).toBe('translateX(-156px)');
      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      wheel(0, { deltaY: 30 });
      emitShell({ type: 'scroll-gesture', phase: 'end' });
      expect(track.style.transform).toBe('');

      // Deep left swipe commits Resolve even with swipe-tracking=false.
      await act(async () => {
        emitShell({ type: 'scroll-gesture', phase: 'begin' });
        wheel(100);
        wheel(100);
        emitShell({ type: 'scroll-gesture', phase: 'end' });
        await Promise.resolve();
      });
      expect(sendStateEvent).toHaveBeenCalledWith(
        ROOM_A,
        MINDROOM_THREAD_TAGS_EVENT,
        expect.objectContaining({ set_by: ME }),
        buildPerTagStateKey('$a1', 'resolved')
      );
      expect(forwardSpy).not.toHaveBeenCalled();
    } finally {
      stopHistory();
      Reflect.deleteProperty(window, 'mindroomDesktop');
      Reflect.deleteProperty(window, 'navigation');
      if (origPlatform) Object.defineProperty(navigator, 'platform', origPlatform);
      else Reflect.deleteProperty(navigator, 'platform');
      if (origUserAgent) Object.defineProperty(navigator, 'userAgent', origUserAgent);
      else Reflect.deleteProperty(navigator, 'userAgent');
    }
  });

  it('renders Columns mode with real layout geometry without render loops and preserves per-column scroll across Columns <-> Vertical toggles', () => {
    const room = makeRoom(ROOM_A, 'Engineering');
    const entries = Array.from({ length: 45 }, (_, i) =>
      entry(ROOM_A, `$space-col-${i}`, `Thread ${i}`, { lastActivityTs: 10_000 - i })
    );
    const sections: CompactThreadSection[] = [
      { id: 'needsYou', rootIds: entries.map((e) => e.key) },
    ];
    const scrollMemory: ScrollAnchorMemory = new Map();
    stubCompactLayout({
      width: () => 1000,
      clientHeight: 700,
      gap: 4,
      rowHeight: () => 84,
    });

    const { container, rerenderProps } = renderScenario({
      rooms: [room],
      entries,
      sections,
      scrollMemory,
    });

    rerenderProps({ columns: true });
    expect(container.querySelector('[data-compact-columns-board="true"]')).not.toBeNull();
    expect(container.querySelectorAll('button[data-thread-root-id]')).toHaveLength(40);

    // Reveal past 40 cards, save deep scrollTop, toggle to Vertical and back -> both limit & scrollTop restored.
    fireEvent.click(container.querySelector('[data-compact-column-show-more="needsYou"]')!);
    expect(container.querySelectorAll('button[data-thread-root-id]')).toHaveLength(45);
    const body = container.querySelector<HTMLDivElement>('[data-compact-column-body="needsYou"]')!;
    body.scrollTop = 3_400;
    fireEvent.scroll(body);
    rerenderProps({ columns: false });
    expect(container.querySelector('[data-compact-columns-board]')).toBeNull();
    rerenderProps({ columns: true });
    expect(container.querySelectorAll('button[data-thread-root-id]')).toHaveLength(45);
    expect(
      container.querySelector<HTMLDivElement>('[data-compact-column-body="needsYou"]')?.scrollTop
    ).toBe(3_400);
  });
});
