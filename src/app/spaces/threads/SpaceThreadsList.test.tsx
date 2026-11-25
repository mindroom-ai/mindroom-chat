// @vitest-environment jsdom
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
import { SwipeList } from '../../threads/overview/CompactCardSwipe.css';
import type { CompactThreadSection } from '../../threads/overview/compactThreadSections';
import { resetPendingThreadTagsForTests } from '../../threads/tags/threadTagPending';
import { makeSpaceThreadEntry, SPACE_THREADS_TEST_NOW as NOW } from './spaceThreads.test.shared';
import type { SpaceRoomItem } from './spaceThreadsModel';
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
};

const { menuProps } = vi.hoisted(() => ({ menuProps: vi.fn<(props: MockMenuProps) => void>() }));

vi.mock('../../threads/ThreadActionsMenu', () => ({
  ThreadActionsMenu: (props: MockMenuProps) => {
    menuProps(props);
    return <div data-testid="mock-thread-actions-menu" data-root={props.rootId} />;
  },
}));

vi.mock('../../threads/overview/ThreadCardBadges', () => ({ ThreadCardBadges: () => null }));

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
  onOpenThread = vi.fn<(roomId: string, threadRootId: string) => void>(),
}: {
  rooms: Room[];
  entries: ReturnType<typeof makeSpaceThreadEntry>[];
  sendStateEvent?: ReturnType<typeof vi.fn>;
  sections?: readonly CompactThreadSection[];
  pinnedByRoom?: ReadonlyMap<string, readonly string[]>;
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

const swipeCard = (shell: HTMLElement) => {
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
  pointer('pointermove', 120);
  pointer('pointerup', 120);
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
});
