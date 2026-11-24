// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRoomInputDraftKey, roomIdToMsgDraftAtomFamily } from '../../composer/roomInputDrafts';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { SpaceProvider } from '../../matrix/hooks/useSpace';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import {
  crossRoomThreadIndexAtom,
  getCrossRoomThreadIndexKey,
  normalizeThreadSearchText,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import { SpaceThreadsPage } from './SpaceThreadsPage';

const mocks = vi.hoisted(() => ({
  navigateRoomThread: vi.fn(),
  roomInputProps: [] as Array<{
    roomId: string;
    onRoomMessageSent?: (id: string) => boolean | void;
  }>,
}));

vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoomThread: mocks.navigateRoomThread,
  }),
}));

vi.mock('../../composer/RoomInput', () => ({
  RoomInput: (props: { roomId: string; onRoomMessageSent?: (id: string) => boolean | void }) => {
    mocks.roomInputProps.push(props);
    return (
      <div data-testid="mock-room-input" data-room-id={props.roomId}>
        <button
          type="button"
          data-testid="mock-send-message"
          onClick={() => props.onRoomMessageSent?.('$sent-root')}
        >
          Send
        </button>
      </div>
    );
  },
}));

vi.mock('../../threads/overview/ThreadCardBadges', () => ({
  ThreadCardBadges: () => null,
}));

const ME = '@me:example.org';
const SPACE_ID = '!space:example.org';
const ROOM_ENG = '!eng:example.org';
const ROOM_DES = '!des:example.org';
const NOW = 1_700_000_000_000;

const makeRoom = (
  roomId: string,
  name: string,
  opts: { isSpace?: boolean; canSend?: boolean; hasAgent?: boolean } = {}
): Room => {
  const canSend = opts.canSend ?? true;
  const members = opts.hasAgent
    ? [{ userId: '@mindroom_code:example.org', membership: 'join', name: 'Code' }]
    : [{ userId: ME, membership: 'join', name: 'Me' }];
  const powerEvent = {
    getContent: () => ({ users_default: canSend ? 0 : 0, events_default: canSend ? 0 : 50 }),
  };
  const state = {
    getStateEvents: (type: string) => (type === 'm.room.power_levels' ? powerEvent : null),
  };
  return {
    roomId,
    name,
    isSpaceRoom: () => opts.isSpace === true,
    getType: () => (opts.isSpace ? 'm.space' : undefined),
    getMyMembership: () => 'join',
    getCanonicalAlias: () => null,
    getMembers: () => members,
    getMember: () => null,
    getThread: () => undefined,
    findEventById: () => undefined,
    getUnfilteredTimelineSet: () => ({ findEventById: () => undefined }),
    currentState: { getStateEvents: () => [] },
    getLiveTimeline: () => ({
      getEvents: () => [],
      getState: () => state,
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
    client: {
      on: vi.fn(),
      removeListener: vi.fn(),
    },
  } as unknown as Room;
};

const makeEntry = (
  roomId: string,
  roomName: string,
  threadRootId: string,
  summaryText: string,
  lastActivityTs: number
): CrossRoomThreadIndexEntry => ({
  key: getCrossRoomThreadIndexKey(roomId, threadRootId),
  roomId,
  roomName,
  threadRootId,
  indexedEventIds: [threadRootId],
  threadRecord: {
    roomId,
    threadRootId,
    rootEventId: threadRootId,
    absoluteIndex: 0,
    presentation: {
      summaryInfo: undefined,
      summaryText,
      primarySummaryText: summaryText,
      recentThreadSummaryText: summaryText,
      rootPreviewText: `Root: ${summaryText}`,
      latestReplyPreviewText: `Reply: ${summaryText}`,
      lastSenderId: ME,
      lastSenderDisplayName: 'Me',
      messageCount: 1,
      participantIds: [ME],
      replyParticipantIds: [ME],
      peopleIds: [ME],
    },
    status: {
      isKnownThreadRoot: true,
      replyCount: 1,
      lastActivityTs,
      isUnread: false,
      isResolved: false,
      isStreaming: false,
      scheduledTaskCount: 0,
      tags: [],
    },
    cache: { eventCount: 2, relationSnapshotComplete: true, tailLoaded: true },
  },
  rootSenderId: ME,
  lastActivityTs,
  isUnread: false,
  isResolved: false,
  hasAttention: false,
  isInvolved: true,
  isForUser: true,
  summaryText,
  rootPreviewText: summaryText,
  searchableText: normalizeThreadSearchText(summaryText),
  tags: [],
  generation: 1,
});

const renderSpaceThreads = ({
  rooms,
  entries,
  bootstrapped = true,
  screenSize = ScreenSize.Desktop,
  store = createStore(),
}: {
  rooms: Room[];
  entries: CrossRoomThreadIndexEntry[];
  bootstrapped?: boolean;
  screenSize?: ScreenSize;
  store?: ReturnType<typeof createStore>;
}) => {
  const space = makeRoom(SPACE_ID, 'Product', { isSpace: true });
  const roomMap = new Map<string, Room>([
    [SPACE_ID, space],
    ...rooms.map((r) => [r.roomId, r] as const),
  ]);
  const client = {
    getSafeUserId: () => ME,
    getUserId: () => ME,
    getRoom: (id: string) => roomMap.get(id) ?? null,
    getRooms: () => [...roomMap.values()],
    on: vi.fn(),
    removeListener: vi.fn(),
    mxcUrlToHttp: () => null,
  } as unknown as MatrixClient;

  store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [SPACE_ID, ...rooms.map((r) => r.roomId)] });
  store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
  store.set(roomToParentsAtom, {
    type: 'INITIALIZE',
    roomToParents: new Map(rooms.map((r) => [r.roomId, new Set([SPACE_ID])] as const)),
  });
  store.set(crossRoomThreadIndexAtom, {
    entries: new Map(entries.map((entry) => [entry.key, entry] as const)),
    eventIdToThreadRoots: new Map(),
    version: 1,
    bootstrapped,
  });

  const view = render(
    <Provider store={store}>
      <ScreenSizeProvider value={screenSize}>
        <MatrixClientProvider value={client}>
          <MemoryRouter initialEntries={[`/${encodeURIComponent(SPACE_ID)}/threads/`]}>
            <SpaceProvider value={space}>
              <SpaceThreadsPage />
            </SpaceProvider>
          </MemoryRouter>
        </MatrixClientProvider>
      </ScreenSizeProvider>
    </Provider>
  );
  return { ...view, store };
};

afterEach(() => {
  cleanup();
  mocks.navigateRoomThread.mockReset();
  mocks.roomInputProps.length = 0;
  localStorage.clear();
});

describe('SpaceThreadsPage', () => {
  it('shows room badges in multi-room view, hides them on Only downselect, updates composer, and restores on All', () => {
    const rooms = [
      makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true }),
      makeRoom(ROOM_DES, 'Design', { hasAgent: true }),
    ];
    const entries = [
      makeEntry(ROOM_ENG, 'Engineering', '$t-eng', 'Build failure', NOW),
      makeEntry(ROOM_DES, 'Design', '$t-des', 'New button spec', NOW - 1000),
    ];

    const { container } = renderSpaceThreads({ rooms, entries });

    // Multi-room: both threads shown, room badges visible, composer targets first sendable room.
    expect(screen.getByText('Build failure')).toBeTruthy();
    expect(screen.getByText('New button spec')).toBeTruthy();
    expect(container.querySelectorAll('[data-space-thread-room-badge]').length).toBe(2);
    expect(container.querySelector('[data-space-rooms-badge]')?.textContent).toBe('2 rooms');
    expect(screen.getByTestId('mock-room-input').getAttribute('data-room-id')).toBe(ROOM_ENG);

    // Clicking Only on Design filters to Design, hides room badge, and retargets composer to Design.
    fireEvent.click(container.querySelector(`[data-space-room-only="${ROOM_DES}"]`)!);
    expect(screen.queryByText('Build failure')).toBeNull();
    expect(screen.getByText('New button spec')).toBeTruthy();
    expect(container.querySelectorAll('[data-space-thread-room-badge]').length).toBe(0);
    expect(container.querySelector('[data-space-rooms-badge]')?.textContent).toBe('1 of 2 rooms');
    expect(screen.getByTestId('mock-room-input').getAttribute('data-room-id')).toBe(ROOM_DES);

    // Sending from the composer navigates to the newly created thread in Design.
    fireEvent.click(screen.getByTestId('mock-send-message'));
    expect(mocks.navigateRoomThread).toHaveBeenCalledWith(ROOM_DES, '$sent-root');

    // Clicking All restores both rooms and re-shows room badges.
    fireEvent.click(container.querySelector('[data-space-room-filter-all="true"]')!);
    expect(screen.getByText('Build failure')).toBeTruthy();
    expect(screen.getByText('New button spec')).toBeTruthy();
    expect(container.querySelectorAll('[data-space-thread-room-badge]').length).toBe(2);

    // Clicking a thread card opens that thread in Space context.
    fireEvent.click(container.querySelector('[data-thread-root-id="$t-eng"]')!);
    expect(mocks.navigateRoomThread).toHaveBeenCalledWith(ROOM_ENG, '$t-eng');
  });

  it('holds the composer target room when a draft is in progress and shows Draft for #room', () => {
    const rooms = [
      makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true }),
      makeRoom(ROOM_DES, 'Design', { hasAgent: true }),
    ];
    const entries = [
      makeEntry(ROOM_ENG, 'Engineering', '$t-eng', 'Build failure', NOW),
      makeEntry(ROOM_DES, 'Design', '$t-des', 'New button spec', NOW - 1000),
    ];
    const store = createStore();
    store.set(roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(ME, ROOM_ENG)), [
      { type: 'paragraph', children: [{ text: 'WIP deploy note' }] } as never,
    ]);

    const { container } = renderSpaceThreads({ rooms, entries, store });
    expect(screen.getByTestId('mock-room-input').getAttribute('data-room-id')).toBe(ROOM_ENG);

    // Downselect to Design while draft exists for Engineering.
    fireEvent.click(container.querySelector(`[data-space-room-only="${ROOM_DES}"]`)!);
    expect(screen.getByTestId('mock-room-input').getAttribute('data-room-id')).toBe(ROOM_ENG);
    const note = container.querySelector(`[data-space-composer-draft-pinned="${ROOM_ENG}"]`);
    expect(note?.textContent).toContain('Engineering');
  });

  it('renders searchable room dropdowns in large spaces (>6 rooms) and read-only notice when unsendable', () => {
    const sevenRooms = Array.from({ length: 7 }, (_, i) =>
      makeRoom(`!room${i}:example.org`, `Room ${i}`)
    );
    const { container } = renderSpaceThreads({ rooms: sevenRooms, entries: [] });
    expect(container.querySelector('[data-space-room-filter-button]')).toBeTruthy();
    expect(container.querySelector('[data-space-composer-picker="true"]')).toBeTruthy();

    cleanup();
    const readOnlyRooms = [makeRoom(ROOM_ENG, 'Read only', { canSend: false })];
    renderSpaceThreads({ rooms: readOnlyRooms, entries: [] });
    expect(screen.queryByTestId('mock-room-input')).toBeNull();
    expect(screen.getByText('No rooms in this space allow posting.')).toBeTruthy();
  });

  it('shows loading before bootstrap and renders newly created 0-reply roots from live timelines', () => {
    const eng = makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true });
    const { container } = renderSpaceThreads({ rooms: [eng], entries: [], bootstrapped: false });
    expect(container.querySelector('[data-space-threads-loading="true"]')).toBeTruthy();

    cleanup();
    const zeroReplyEvent = {
      getId: () => '$fresh-zero-reply',
      getType: () => 'm.room.message',
      getContent: () => ({ msgtype: 'm.text', body: 'Fresh zero reply root' }),
      getSender: () => ME,
      getTs: () => NOW,
      getRelation: () => undefined,
      getUnsigned: () => ({}),
      replacingEvent: () => null,
      isRedacted: () => false,
    };
    const engWithRoot = makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true });
    const origTimeline = engWithRoot.getLiveTimeline();
    (engWithRoot as unknown as { getLiveTimeline: () => unknown }).getLiveTimeline = () => ({
      ...origTimeline,
      getEvents: () => [zeroReplyEvent],
    });
    const { container: c2 } = renderSpaceThreads({ rooms: [engWithRoot], entries: [] });
    expect(c2.querySelector('[data-thread-root-id="$fresh-zero-reply"]')).toBeTruthy();
  });
});
