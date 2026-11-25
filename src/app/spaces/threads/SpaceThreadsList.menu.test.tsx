// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { FocusTrap } from 'focus-trap-react';
import { MemoryRouter } from 'react-router-dom';
import { MatrixEvent, SyncState, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MINDROOM_THREAD_TAGS_EVENT } from '../../event-store/threads/threadTags';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { StateEvent } from '../../matrix/types/room';
import { makeSpaceThreadEntry, SPACE_THREADS_TEST_NOW as NOW } from './spaceThreads.test.shared';
import type { SpaceRoomItem } from './spaceThreadsModel';
import { SpaceThreadsList } from './SpaceThreadsList';

// Render PopOut content inline and bypass jsdom zero-layout visibility check on FocusTrap,
// keeping the real ThreadActionsMenu, PowerLevelsContextProvider, useThreadTags, and Escape handling.
vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  PopOut: ({ content }: { content: ReactNode }) => content,
}));

vi.mock('focus-trap-react', async (importOriginal) => {
  const { FocusTrap: RealTrap } = await importOriginal<{ FocusTrap: typeof FocusTrap }>();
  return {
    FocusTrap: ({ focusTrapOptions, ...props }: ComponentProps<typeof FocusTrap>) => (
      <RealTrap
        {...props}
        focusTrapOptions={{ ...focusTrapOptions, tabbableOptions: { displayCheck: 'none' } }}
      />
    ),
  };
});

const ME = '@me:example.org';
const ROOM_MOD = '!eng:example.org';
const ROOM_READONLY = '!ann:example.org';

const makeRoom = (
  roomId: string,
  name: string,
  rootId: string,
  userLevel: number,
  client: MatrixClient
): Room => {
  const rootEvent = new MatrixEvent({
    event_id: rootId,
    room_id: roomId,
    type: 'm.room.message',
    sender: ME,
    content: { msgtype: 'm.text', body: name },
  });
  Object.defineProperty(rootEvent, 'isThreadRoot', { value: true });
  const powerEvent = new MatrixEvent({
    type: StateEvent.RoomPowerLevels,
    state_key: '',
    sender: ME,
    content: { users_default: userLevel, state_default: 50, events_default: 0 },
  });
  const createEvent = new MatrixEvent({
    type: StateEvent.RoomCreate,
    state_key: '',
    sender: ME,
    content: { room_version: '11' },
  });
  const pinnedEvent = new MatrixEvent({
    event_id: `$pins-${roomId}`,
    room_id: roomId,
    type: StateEvent.RoomPinnedEvents,
    state_key: '',
    sender: ME,
    content: { pinned: [] },
  });
  const member = { userId: ME, name: 'Me', rawDisplayName: 'Me', membership: 'join' };
  const state = {
    getMembers: () => [member],
    maySendEvent: () => userLevel >= 0,
    getStateEvents: (type: string, stateKey?: string) => {
      if (type === (StateEvent.RoomPowerLevels as string)) return powerEvent;
      if (type === (StateEvent.RoomCreate as string)) return createEvent;
      if (type === (StateEvent.RoomPinnedEvents as string)) return pinnedEvent;
      if (type === MINDROOM_THREAD_TAGS_EVENT) return [];
      return stateKey === undefined ? [] : null;
    },
  };
  return {
    roomId,
    name,
    client,
    getMyMembership: () => 'join',
    getCanonicalAlias: () => null,
    membersLoaded: () => true,
    loadMembersIfNeeded: () => Promise.resolve(true),
    getMember: (id: string) => (id === ME ? member : null),
    getMembers: () => [member],
    getThread: (id: string) =>
      id === rootId
        ? { rootEvent, findEventById: () => rootEvent, initialize: () => Promise.resolve() }
        : undefined,
    findEventById: (id: string) => (id === rootId ? rootEvent : undefined),
    getUnfilteredTimelineSet: () => ({ findEventById: () => undefined }),
    getLiveTimeline: () => ({ getState: () => state }),
    currentState: state,
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as Room;
};

afterEach(() => {
  cleanup();
});

describe('SpaceThreadsList real ThreadActionsMenu integration', () => {
  it('opens the real ThreadActionsMenu with each card room power levels and restores focus on Escape', async () => {
    const roomMap = new Map<string, Room>();
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

    const modRoom = makeRoom(ROOM_MOD, 'Engineering', '$mod-root', 50, mx);
    const readOnlyRoom = makeRoom(ROOM_READONLY, 'Announcements', '$ro-root', 0, mx);
    roomMap.set(ROOM_MOD, modRoom);
    roomMap.set(ROOM_READONLY, readOnlyRoom);

    const modEntry = makeSpaceThreadEntry({
      roomId: ROOM_MOD,
      roomName: 'Engineering',
      threadRootId: '$mod-root',
      summaryText: 'Deploy pipeline',
    });
    const roEntry = makeSpaceThreadEntry({
      roomId: ROOM_READONLY,
      roomName: 'Announcements',
      threadRootId: '$ro-root',
      summaryText: 'Release notes',
    });
    const roomsById = new Map<string, SpaceRoomItem>([
      [ROOM_MOD, { room: modRoom, name: 'Engineering', accentColor: '#4f8ff7' }],
      [ROOM_READONLY, { room: readOnlyRoom, name: 'Announcements', accentColor: '#3ba66b' }],
    ]);

    const { container } = render(
      <MemoryRouter initialEntries={['/!space:example.org/threads']}>
        <ScreenSizeProvider value={ScreenSize.Desktop}>
          <MatrixClientProvider value={mx}>
            <SpaceThreadsList
              entryKeys={[modEntry.key, roEntry.key]}
              entryByKey={
                new Map([
                  [modEntry.key, modEntry],
                  [roEntry.key, roEntry],
                ])
              }
              foldedSections={[]}
              onToggleSectionFold={vi.fn()}
              roomsById={roomsById}
              showRoomBadge
              snoozeNow={NOW}
              metaVersion={1}
              showLoading={false}
              onOpenThread={vi.fn()}
            />
          </MatrixClientProvider>
        </ScreenSizeProvider>
      </MemoryRouter>
    );

    // 1. Moderator room card: real menu opens without PowerLevelsContext error and shows write actions.
    const modMore = container.querySelector<HTMLButtonElement>(
      `[data-room-id="${ROOM_MOD}"][data-scroll-anchor="$mod-root"] [data-compact-thread-more]`
    )!;
    fireEvent.click(modMore);
    const modMenu = await screen.findByRole('menu', {}, { timeout: 4000 });
    expect(within(modMenu).getByRole('menuitem', { name: 'Open thread' })).toBeTruthy();
    expect(within(modMenu).getByRole('menuitem', { name: 'Resolve' })).toBeTruthy();
    expect(within(modMenu).getByRole('menuitem', { name: /Pin thread/i })).toBeTruthy();
    expect(within(modMenu).getByRole('menuitem', { name: /Edit tags/i })).toBeTruthy();
    expect(within(modMenu).getByRole('menuitem', { name: 'Copy thread link' })).toBeTruthy();

    const openItem = within(modMenu).getByRole('menuitem', { name: 'Open thread' });
    act(() => openItem.focus());
    await act(async () => {
      openItem.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(modMore);

    // 2. Read-only room card: real menu reflects that room's level-0 permissions (omits write items).
    const roMore = container.querySelector<HTMLButtonElement>(
      `[data-room-id="${ROOM_READONLY}"][data-scroll-anchor="$ro-root"] [data-compact-thread-more]`
    )!;
    fireEvent.click(roMore);
    const roMenu = await screen.findByRole('menu');
    expect(within(roMenu).getByRole('menuitem', { name: 'Open thread' })).toBeTruthy();
    expect(within(roMenu).getByRole('menuitem', { name: 'Copy thread link' })).toBeTruthy();
    expect(within(roMenu).queryByRole('menuitem', { name: 'Resolve' })).toBeNull();
    expect(within(roMenu).queryByRole('menuitem', { name: /Pin thread/i })).toBeNull();
    expect(within(roMenu).queryByRole('menuitem', { name: /Edit tags/i })).toBeNull();

    const roOpenItem = within(roMenu).getByRole('menuitem', { name: 'Open thread' });
    act(() => roOpenItem.focus());
    await act(async () => {
      roOpenItem.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(roMore);
  });
});
