import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';

import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import arAdditions from '../../i18n/locales/additions/ar.json';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import {
  userDirectoryCacheAtom,
  type ServerUserDirectoryUser,
  type UserDirectoryCacheState,
} from '../userDirectoryCache';
import {
  beginModeratorGrantIntent,
  createDetachedGrantError,
  detachedGrantErrorAtom,
  evaluateRoomModeratorGrant,
  grantRoomModeratorRights,
  supersedeModeratorGrant,
} from './moderatorInvite';
import { ModeratorGrantErrorNotice } from './ModeratorGrantErrorNotice';
import { InviteUserPrompt } from './InviteUserPrompt';

const directUsersMock = vi.hoisted(() => ({
  users: [] as string[],
}));

/** How many folds icon buttons have mounted: a button that stays in place adds none. */
const iconButtonMounts = vi.hoisted(() => ({ count: 0 }));

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  const Wrapper = ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement('div', { className }, children);

  const IconButton = React.forwardRef(
    (props: React.ComponentProps<typeof actual.IconButton>, ref: React.Ref<HTMLButtonElement>) => {
      React.useEffect(() => {
        iconButtonMounts.count += 1;
      }, []);
      return React.createElement(actual.IconButton, { ...props, ref });
    }
  );

  return {
    ...actual,
    IconButton,
    Overlay: ({ children, backdrop }: { children?: React.ReactNode; backdrop?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, backdrop, children),
    OverlayBackdrop: Wrapper,
    OverlayCenter: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      React.createElement('div', { 'data-overlay-center': true, className }, children),
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('./InviteUserPrompt.css', () => ({
  ViewportCenter: 'InviteViewportCenter',
  Dialog: 'InviteDialog',
  TitleBar: 'InviteTitleBar',
  TitleBlock: 'InviteTitleBlock',
  Controls: 'InviteControls',
  SearchField: 'InviteSearchField',
  FilterRow: 'InviteFilterRow',
  FilterChip: 'InviteFilterChip',
  Body: 'InviteBody',
  GrantAlerts: 'InviteGrantAlerts',
  GrantAlert: 'InviteGrantAlert',
  GrantAlertText: 'InviteGrantAlertText',
  ListArea: 'InviteListArea',
  SectionHeader: 'InviteSectionHeader',
  List: 'InviteList',
  Row: 'InviteRow',
  AvatarWrap: 'InviteAvatarWrap',
  Identity: 'InviteIdentity',
  NameLine: 'InviteNameLine',
  AgentBadge: 'InviteAgentBadge',
  NameWrap: 'InviteNameWrap',
  Subtitle: 'InviteSubtitle',
  RowError: 'InviteRowError',
  RowAction: 'InviteRowAction',
  RowActionSent: 'InviteRowActionSent',
  InlineHint: 'InviteInlineHint',
  EmptyState: 'InviteEmptyState',
  DirectoryError: 'InviteDirectoryError',
  FetchingRow: 'InviteFetchingRow',
  Footer: 'InviteFooter',
  NoteToggle: 'InviteNoteToggle',
  ModeratorRow: 'InviteModeratorRow',
  ModeratorLabel: 'InviteModeratorLabel',
  VisuallyHidden: 'InviteVisuallyHidden',
}));

vi.mock('../../ui/Modal500.css', () => ({
  SafeOverlayCenter: 'SafeOverlayCenter',
  PhoneOverlayCenter: 'PhoneOverlayCenter',
  PhoneModal: 'PhoneModal',
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../matrix/hooks/useDirectUsers', () => ({
  useDirectUsers: () => directUsersMock.users,
}));

vi.mock('../../avatars/UserAvatar', () => ({
  UserAvatar: ({ userId, src, alt }: { userId: string; src?: string; alt?: string }) =>
    React.createElement('span', { 'data-user-id': userId, 'data-src': src, 'data-alt': alt }),
}));

type MockMatrixClient = Pick<
  MatrixClient,
  | 'baseUrl'
  | 'getSafeUserId'
  | 'getHomeserverUrl'
  | 'mxcUrlToHttp'
  | 'searchUserDirectory'
  | 'invite'
  | 'getStateEvent'
  | 'sendStateEvent'
  | 'getRoom'
  | 'on'
  | 'removeListener'
>;

const defaultCacheUsers = (): ServerUserDirectoryUser[] => [
  { userId: '@maya:example.org', displayName: 'Maya Chen' },
  { userId: '@liam:example.org', displayName: 'Liam Park' },
  { userId: '@mindroom_coder:example.org', displayName: 'Coder' },
  { userId: '@mindroom_helper:example.org', displayName: 'Helper' },
];

const readyCache = (
  users: ServerUserDirectoryUser[] = defaultCacheUsers(),
  status: UserDirectoryCacheState['status'] = 'ready'
): UserDirectoryCacheState => ({
  users,
  status,
  fetchedAt: status === 'ready' ? Date.now() : 0,
  limited: false,
  isBootstrapOnly: false,
  ownerKey: '@me:example.org|https://example.org',
});

type MockMember = {
  userId: string;
  membership: string;
};

type RoomOptions = {
  name?: string;
  isSpace?: boolean;
  roomVersion?: string;
  powerLevels?: Record<string, unknown>;
  powerLevelTags?: Record<string, unknown>;
  createContent?: Record<string, unknown>;
  createSender?: string;
  members?: MockMember[];
  joinedCount?: number;
  invitedCount?: number;
  membersLoaded?: boolean;
  loadMembersIfNeeded?: () => Promise<boolean>;
};

const defaultPowerLevels = (): Record<string, unknown> => ({
  users: { '@me:example.org': 100 },
  users_default: 0,
  state_default: 50,
  events: { 'm.room.power_levels': 100 },
});

const makeStateEvent = (content: Record<string, unknown>, sender?: string) => ({
  getContent: () => content,
  getSender: () => sender,
});

type EventListener = (...args: unknown[]) => void;

type PowerLevelsHolder = { state: { powerLevels: Record<string, unknown> } };

/** Lets every pending promise chain run, however many steps a grant takes. */
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const makeMx = (getRoom: (roomId: string) => Room | null) => {
  const listeners = new Map<string, Set<EventListener>>();
  const emit = (event: string, ...args: unknown[]) => {
    listeners.get(event)?.forEach((listener) => listener(...args));
  };
  const client: MockMatrixClient & { emit: typeof emit } = {
    baseUrl: 'https://example.org',
    getSafeUserId: vi.fn(() => '@me:example.org'),
    getHomeserverUrl: vi.fn(() => 'https://example.org'),
    mxcUrlToHttp: vi.fn((mxcUrl: string) => `https://example.org/media/${mxcUrl}`),
    searchUserDirectory: vi.fn(async () => ({
      limited: false,
      results: [],
    })),
    invite: vi.fn(async () => undefined) as unknown as MockMatrixClient['invite'],
    // The grant reads and writes `m.room.power_levels` on the homeserver; the room's mock state
    // stands in for it, so a test that changes that state changes what the grant finds.
    getStateEvent: vi.fn(async (roomId: string) => {
      const room = getRoom(roomId) as unknown as PowerLevelsHolder | null;
      if (!room) throw Object.assign(new Error('Not found'), { errcode: 'M_NOT_FOUND' });
      return structuredClone(room.state.powerLevels);
    }),
    sendStateEvent: vi.fn(
      async (roomId: string, _eventType: string, content: Record<string, unknown>) => {
        const room = getRoom(roomId) as unknown as PowerLevelsHolder | null;
        if (room) room.state.powerLevels = structuredClone(content);
        return { event_id: '$power_levels' };
      }
    ) as unknown as MockMatrixClient['sendStateEvent'],
    getRoom: vi.fn(getRoom),
    on: vi.fn((event: string, listener: EventListener) => {
      const set = listeners.get(event) ?? new Set<EventListener>();
      set.add(listener);
      listeners.set(event, set);
      return client as unknown as MatrixClient;
    }) as unknown as MockMatrixClient['on'],
    removeListener: vi.fn((event: string, listener: EventListener) => {
      listeners.get(event)?.delete(listener);
      return client as unknown as MatrixClient;
    }) as unknown as MockMatrixClient['removeListener'],
    emit,
  };
  return client;
};

const makeRoom = (mx: MockMatrixClient, options: RoomOptions = {}) => {
  const state = {
    members: [...(options.members ?? [])] as MockMember[],
    membersLoaded: options.membersLoaded ?? true,
    powerLevels: options.powerLevels ?? defaultPowerLevels(),
    joinedCount: options.joinedCount ?? 2,
    invitedCount: options.invitedCount ?? 0,
  };
  const createEvent = options.createContent
    ? makeStateEvent(options.createContent, options.createSender)
    : undefined;
  const roomListeners = new Map<string, Set<EventListener>>();
  return {
    roomId: '!room:example.org',
    name: options.name ?? 'Design Review',
    client: mx,
    state,
    on: vi.fn((event: string, listener: EventListener) => {
      const set = roomListeners.get(event) ?? new Set<EventListener>();
      set.add(listener);
      roomListeners.set(event, set);
    }),
    removeListener: vi.fn((event: string, listener: EventListener) => {
      roomListeners.get(event)?.delete(listener);
    }),
    emit: (event: string, ...args: unknown[]) => {
      roomListeners.get(event)?.forEach((listener) => listener(...args));
    },
    isSpaceRoom: () => options.isSpace ?? false,
    getVersion: () =>
      options.roomVersion ??
      (typeof options.createContent?.room_version === 'string'
        ? options.createContent.room_version
        : '12'),
    membersLoaded: () => state.membersLoaded,
    getJoinedMemberCount: () => state.joinedCount,
    getInvitedMemberCount: () => state.invitedCount,
    getMember: (userId: string) => state.members.find((entry) => entry.userId === userId) ?? null,
    getMembers: vi.fn(() => state.members),
    loadMembersIfNeeded: vi.fn(options.loadMembersIfNeeded ?? (async () => true)),
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (eventType: string) => {
          if (eventType === 'm.room.power_levels') return makeStateEvent(state.powerLevels);
          if (eventType === 'm.room.create') return createEvent;
          if (eventType === 'io.mindroom.power_level_tags' && options.powerLevelTags) {
            return makeStateEvent(options.powerLevelTags);
          }
          return undefined;
        },
      }),
    }),
  };
};

const focusInput = vi.fn();
/** What the sheet's scrolling body is in a test that watches it; the others have none. */
let bodyNode: { contains: (node: unknown) => boolean } | null = null;
const rowFocusElements: Array<{ focus: ReturnType<typeof vi.fn> }> = [];

/** The client, the room and the store a sheet was rendered with, to open it again on them. */
type PromptSession = {
  mx: ReturnType<typeof makeMx>;
  room: ReturnType<typeof makeRoom>;
  store: ReturnType<typeof createStore>;
};

type RenderOptions = RoomOptions & {
  screenSize?: ScreenSize;
  cache?: UserDirectoryCacheState;
  requestClose?: () => void;
  session?: PromptSession;
};

const renderPrompt = (options: RenderOptions = {}) => {
  let roomRef: ReturnType<typeof makeRoom> | null = options.session?.room ?? null;
  const mx =
    options.session?.mx ??
    makeMx((roomId) =>
      roomRef && roomRef.roomId === roomId ? (roomRef as unknown as Room) : null
    );
  const room = roomRef ?? makeRoom(mx, options);
  roomRef = room;
  const store = options.session?.store ?? createStore();
  if (!options.session) store.set(userDirectoryCacheAtom, options.cache ?? readyCache());
  const requestClose = options.requestClose ?? vi.fn();

  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(
      <Provider store={store}>
        <ScreenSizeProvider value={options.screenSize ?? ScreenSize.Desktop}>
          <MatrixClientProvider value={mx as unknown as MatrixClient}>
            <InviteUserPrompt room={room as unknown as Room} requestClose={requestClose} />
          </MatrixClientProvider>
        </ScreenSizeProvider>
      </Provider>,
      {
        createNodeMock: (element) => {
          if (element.type === 'input' && element.props.type === 'search') {
            return { focus: focusInput };
          }
          if (element.type === 'div' && element.props.className === 'InviteListArea') {
            return {
              querySelectorAll: () => rowFocusElements,
            };
          }
          if (element.type === 'div' && element.props.className === 'InviteBody') return bodyNode;
          return null;
        },
      }
    );
  });

  return { renderer: renderer!, mx, room, store, requestClose };
};

const extractText = (node: ReactTestInstance): string => {
  const parts: string[] = [];
  const walk = (child: ReactTestInstance | string) => {
    if (typeof child === 'string') {
      parts.push(child);
      return;
    }
    child.children.forEach(walk);
  };
  walk(node);
  return parts.join('');
};

const getDialog = (renderer: ReactTestRenderer) =>
  renderer.root.find((node) => typeof node.type === 'string' && node.props.role === 'dialog');

const getSearchInput = (renderer: ReactTestRenderer) =>
  renderer.root.find((node) => node.type === 'input' && node.props.type === 'search');

const getRows = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'li' && node.props.className === 'InviteRow');

const getRowByText = (renderer: ReactTestRenderer, needle: string) =>
  getRows(renderer).find((row) => extractText(row).includes(needle));

const getRowActionButton = (row: ReactTestInstance) =>
  row.find((node) => node.type === 'button' && node.props['data-invite-row-action'] !== undefined);

const getFilterButton = (renderer: ReactTestRenderer, label: 'All' | 'People' | 'Agents') =>
  renderer.root.find(
    (node) =>
      node.type === 'button' &&
      node.props['aria-pressed'] !== undefined &&
      extractText(node) === label
  );

const findModeratorCheckbox = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'input' && node.props.type === 'checkbox')[0];

const textContentByRole = (renderer: ReactTestRenderer, role: string) =>
  renderer.root
    .findAll((node) => typeof node.type === 'string' && node.props.role === role)
    .map(extractText)
    .filter((text) => text.length > 0)
    .join(' ');

/** The moderator grants that failed while the sheet is open, as its alert strip shows them. */
const getGrantAlerts = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) => node.type === 'div' && node.props.className === 'InviteGrantAlert'
  );

const getHeading = (renderer: ReactTestRenderer) =>
  extractText(renderer.root.findByProps({ id: 'invite-user-prompt-title' }));

/** A grant whose write stays pending until the returned function fails it. */
const holdNextGrant = (mx: ReturnType<typeof makeMx>) => {
  let fail: (error: Error) => void = () => undefined;
  vi.mocked(mx.sendStateEvent).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      })
  );
  return async (error: Error) => {
    await act(async () => {
      fail(error);
      await settle();
    });
  };
};

const getSubtitle = (renderer: ReactTestRenderer) =>
  extractText(
    renderer.root
      .find((node) => node.type === 'div' && node.props.className === 'InviteTitleBlock')
      .find((node) => node.type === 'p')
  );

const getNoteToggle = (renderer: ReactTestRenderer) =>
  renderer.root.find((node) => node.type === 'button' && node.props['aria-expanded'] !== undefined);

const getNoteInput = (renderer: ReactTestRenderer) =>
  renderer.root.find(
    (node) => node.type === 'input' && node.props.placeholder === 'Add a note to your invite...'
  );

const writeNote = (renderer: ReactTestRenderer, value: string) => {
  if (getNoteToggle(renderer).props['aria-expanded'] !== true) {
    act(() => {
      getNoteToggle(renderer).props.onClick();
    });
  }
  act(() => {
    getNoteInput(renderer).props.onChange({ target: { value } });
  });
};

/**
 * A membership event as the SDK applies it: the room has the member's new membership, then
 * `RoomMember.membership` fires if the membership itself changed.
 */
const emitMembership = (
  mx: ReturnType<typeof makeMx>,
  room: ReturnType<typeof makeRoom>,
  userId: string,
  membership: string
) => {
  act(() => {
    const previous = room.getMember(userId)?.membership;
    const member = { roomId: room.roomId, userId, membership };
    room.state.members = [...room.state.members.filter((entry) => entry.userId !== userId), member];
    if (previous !== membership) {
      mx.emit('RoomMember.membership', { getRoomId: () => room.roomId }, member, previous);
    }
  });
};

/** A room summary from /sync, which holds only the counts that changed. */
const emitSummary = (
  room: ReturnType<typeof makeRoom>,
  summary: { joined?: number; invited?: number }
) => {
  act(() => {
    if (summary.joined !== undefined) room.state.joinedCount = summary.joined;
    if (summary.invited !== undefined) room.state.invitedCount = summary.invited;
    room.emit('Room.Summary', {
      ...(summary.joined !== undefined ? { 'm.joined_member_count': summary.joined } : {}),
      ...(summary.invited !== undefined ? { 'm.invited_member_count': summary.invited } : {}),
    });
  });
};

/** Lets the debounced directory search of the homeserver run and answer. */
const waitForServerSearch = async () => {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 260);
    });
  });
};

/** An invite that stays pending until the returned function is called. */
const holdNextInvite = (mx: ReturnType<typeof makeMx>) => {
  let finish: () => void = () => undefined;
  vi.mocked(mx.invite).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({} as never);
      })
  );
  return async () => {
    await act(async () => {
      finish();
      await settle();
    });
  };
};

const expectGrant = (
  mx: ReturnType<typeof makeMx>,
  room: ReturnType<typeof makeRoom>,
  userId: string,
  level: number
) => {
  expect(mx.sendStateEvent).toHaveBeenCalledWith(
    room.roomId,
    'm.room.power_levels',
    expect.objectContaining({ users: expect.objectContaining({ [userId]: level }) }),
    ''
  );
};

const typeSearch = (renderer: ReactTestRenderer, value: string) => {
  act(() => {
    getSearchInput(renderer).props.onChange({ target: { value } });
  });
};

const pressKeyInSearch = async (
  renderer: ReactTestRenderer,
  key: string,
  extra: Record<string, unknown> = {}
) => {
  const preventDefault = vi.fn();
  await act(async () => {
    getSearchInput(renderer).props.onKeyDown({ key, preventDefault, ...extra });
    await settle();
  });
  return preventDefault;
};

const clickRowInvite = async (renderer: ReactTestRenderer, needle: string) => {
  const row = getRowByText(renderer, needle);
  expect(row, `expected row containing ${needle}`).toBeDefined();
  await act(async () => {
    getRowActionButton(row!).props.onClick?.();
    await settle();
  });
};

beforeEach(() => {
  bodyNode = null;
  directUsersMock.users = [];
  focusInput.mockClear();
  rowFocusElements.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('evaluateRoomModeratorGrant & grantRoomModeratorRights', () => {
  it('returns grant level for an admin in a v10+ non-Space room and forbidden otherwise', () => {
    const room = { isSpaceRoom: () => false, getVersion: () => '12' };
    const levels = {
      users: { '@me:example.org': 100 },
      users_default: 0,
      state_default: 50,
      events: { 'm.room.power_levels': 100, 'io.mindroom.router': 75 },
    };
    expect(evaluateRoomModeratorGrant(room, '@me:example.org', levels, new Set())).toEqual({
      kind: 'grant',
      level: 75,
    });
    expect(
      evaluateRoomModeratorGrant(
        { isSpaceRoom: () => true, getVersion: () => '12' },
        '@me:example.org',
        levels,
        new Set()
      )
    ).toEqual({ kind: 'forbidden' });
    expect(
      evaluateRoomModeratorGrant(
        { isSpaceRoom: () => false, getVersion: () => '9' },
        '@me:example.org',
        levels,
        new Set()
      )
    ).toEqual({ kind: 'forbidden' });
  });

  it('serializes concurrent room grants and merges against live server power levels before /sync arrives', async () => {
    // Homeserver state starts with only the admin; synced room state stays stale throughout.
    let serverPowerLevels: Record<string, unknown> = {
      users: { '@me:example.org': 100 },
      users_default: 0,
      state_default: 50,
      events: { 'm.room.power_levels': 100 },
    };
    let resolveFirstWrite!: () => void;
    const writtenUsersSnapshots: Array<Record<string, number>> = [];
    const getStateEvent = vi.fn(async () => structuredClone(serverPowerLevels));
    const sendStateEvent = vi.fn(
      async (_roomId: string, _eventType: string, content: Record<string, unknown>) => {
        if (writtenUsersSnapshots.length === 0) {
          await new Promise<void>((resolve) => {
            resolveFirstWrite = resolve;
          });
        }
        serverPowerLevels = structuredClone(content);
        writtenUsersSnapshots.push({ ...(content.users as Record<string, number>) });
        return { event_id: `$pl_${writtenUsersSnapshots.length}` };
      }
    );

    const mx = {
      ...makeMx(() => null),
      getStateEvent,
      sendStateEvent,
    };
    const room = makeRoom(mx as unknown as MockMatrixClient);

    // Fire two grants concurrently before /sync updates room.state.powerLevels.
    const first = grantRoomModeratorRights(
      mx as unknown as MatrixClient,
      room as unknown as Room,
      '@mindroom_coder:example.org',
      50
    );
    const second = grantRoomModeratorRights(
      mx as unknown as MatrixClient,
      room as unknown as Room,
      '@mindroom_helper:example.org',
      50
    );

    await Promise.resolve();
    await Promise.resolve();
    // Second grant must wait until the first write finishes before reading live state.
    expect(getStateEvent).toHaveBeenCalledTimes(1);

    resolveFirstWrite();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBeNull();
    expect(secondResult).toBeNull();
    expect(getStateEvent).toHaveBeenCalledTimes(2);
    expect(sendStateEvent).toHaveBeenCalledTimes(2);
    expect(writtenUsersSnapshots[1]).toEqual({
      '@me:example.org': 100,
      '@mindroom_coder:example.org': 50,
      '@mindroom_helper:example.org': 50,
    });
  });

  describe('a superseded grant', () => {
    const helper = '@mindroom_helper:example.org';
    const coder = '@mindroom_coder:example.org';

    const setup = () => {
      let roomRef: ReturnType<typeof makeRoom> | null = null;
      const mx = makeMx(() => roomRef as unknown as Room);
      const room = makeRoom(mx);
      roomRef = room;
      const client = mx as unknown as MatrixClient;
      const grant = (userId: string) =>
        grantRoomModeratorRights(client, room as unknown as Room, userId, 50);
      const supersede = (userId: string) => supersedeModeratorGrant(client, room.roomId, userId);
      /** The next read of the live power levels, pending until it is finished or failed. */
      const holdNextRead = () => {
        let finish: () => void = () => undefined;
        let fail: (error: Error) => void = () => undefined;
        vi.mocked(mx.getStateEvent).mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              finish = () => resolve(structuredClone(room.state.powerLevels));
              fail = reject;
            })
        );
        return { finish: () => finish(), fail: (error: Error) => fail(error) };
      };
      /** The next write of the power levels, pending until it is failed. */
      const holdNextWrite = () => {
        let fail: (error: Error) => void = () => undefined;
        vi.mocked(mx.sendStateEvent).mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              fail = reject;
            })
        );
        return { fail: (error: Error) => fail(error) };
      };
      return { mx, room, client, grant, supersede, holdNextRead, holdNextWrite };
    };

    it('reads and writes nothing when an invite without the grant supersedes it while it waits in the queue', async () => {
      const { mx, room, grant, supersede, holdNextRead } = setup();
      const coderRead = holdNextRead();
      const coderGrant = grant(coder);
      const helperGrant = grant(helper);
      await settle();
      expect(mx.getStateEvent).toHaveBeenCalledTimes(1);

      // An invite of someone else supersedes nothing; one of Helper does.
      supersede('@mindroom_scout:example.org');
      supersede(helper);
      coderRead.finish();
      expect(await coderGrant).toBeNull();
      expect(await helperGrant).toBeNull();
      expect(mx.getStateEvent).toHaveBeenCalledTimes(1);
      expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
      expectGrant(mx, room, coder, 50);
      expect(room.state.powerLevels.users).not.toHaveProperty(helper);
    });

    it('writes nothing when it is superseded while it reads the live state', async () => {
      const { mx, grant, supersede, holdNextRead } = setup();
      const read = holdNextRead();
      const result = grant(helper);
      await settle();
      supersede(helper);
      read.finish();
      expect(await result).toBeNull();
      expect(mx.sendStateEvent).not.toHaveBeenCalled();
    });

    it('reports no failure when it is superseded while it reads the live state and the read fails', async () => {
      const { mx, grant, supersede, holdNextRead } = setup();
      // A read that fails is a failure for a grant that still counts.
      const failedRead = holdNextRead();
      const current = grant(helper);
      await settle();
      failedRead.fail(new Error('Server down'));
      expect(await current).toEqual({ kind: 'failed', detail: 'Server down' });

      const supersededRead = holdNextRead();
      const superseded = grant(helper);
      await settle();
      supersede(helper);
      supersededRead.fail(new Error('Server down'));
      expect(await superseded).toBeNull();
      expect(mx.sendStateEvent).not.toHaveBeenCalled();
    });

    it('reports no changed requirement when it is superseded while it reads the live state', async () => {
      const { mx, room, grant, supersede, holdNextRead } = setup();
      const raise = () => {
        room.state.powerLevels = {
          ...room.state.powerLevels,
          events: { 'm.room.power_levels': 100, 'io.mindroom.router': 75 },
        };
      };
      const currentRead = holdNextRead();
      const current = grant(helper);
      await settle();
      raise();
      currentRead.finish();
      expect(await current).toEqual({ kind: 'levelRaised', level: 75 });

      const supersededRead = holdNextRead();
      const superseded = grant(helper);
      await settle();
      supersede(helper);
      supersededRead.finish();
      expect(await superseded).toBeNull();
      expect(mx.sendStateEvent).not.toHaveBeenCalled();
    });

    it('reports no failure when it is superseded while it writes and the write fails', async () => {
      const { mx, grant, supersede, holdNextWrite } = setup();
      // A write that fails is a failure for a grant that still counts.
      const failedWrite = holdNextWrite();
      const current = grant(helper);
      await settle();
      expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
      failedWrite.fail(new Error('Forbidden'));
      expect(await current).toEqual({ kind: 'failed', detail: 'Forbidden' });

      const supersededWrite = holdNextWrite();
      const superseded = grant(helper);
      await settle();
      expect(mx.sendStateEvent).toHaveBeenCalledTimes(2);
      supersede(helper);
      supersededWrite.fail(new Error('Forbidden'));
      expect(await superseded).toBeNull();
    });

    it('never enters the queue when an invite without the grant came while its own invite was on its way', async () => {
      const { mx, room, client, supersede } = setup();
      const begin = () => beginModeratorGrantIntent(client, room.roomId, helper);
      const run = (intent: ReturnType<typeof begin>) => intent.run(room as unknown as Room, 50);

      const withdrawn = begin();
      supersede(helper);
      expect(await run(withdrawn)).toBeNull();
      expect(mx.getStateEvent).not.toHaveBeenCalled();

      // An invite with the grant that fails gives up its own grant only, however often it says
      // so: the grant of the invite that waits beside it goes on.
      const sent = begin();
      const failed = begin();
      failed.release();
      failed.release();
      expect(await run(sent)).toBeNull();
      expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
      expectGrant(mx, room, helper, 50);

      // Nor does it hide the other from an invite without the grant.
      room.state.powerLevels = defaultPowerLevels();
      const pending = begin();
      const failedAgain = begin();
      failedAgain.release();
      failedAgain.release();
      supersede(helper);
      expect(await run(pending)).toBeNull();
      expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    });

    it('gives the rights of the invite submitted last, also when the earlier invite returns after it', async () => {
      const { mx, room, client, holdNextRead } = setup();
      // The room asks level 100 of its router: within the ceiling of the second invite only.
      room.state.powerLevels = {
        ...defaultPowerLevels(),
        events: { 'm.room.power_levels': 100, 'io.mindroom.router': 100 },
      };
      const begin = () => beginModeratorGrantIntent(client, room.roomId, helper);
      const first = begin();
      const second = begin();

      // The second invite returns first, and its grant reads the live state.
      const read = holdNextRead();
      const secondResult = second.run(room as unknown as Room, 100);
      await settle();
      expect(mx.getStateEvent).toHaveBeenCalledTimes(1);

      // The first returns late: it is the older one, gives way at once and takes nothing back.
      expect(await first.run(room as unknown as Room, 50)).toBeNull();

      read.finish();
      expect(await secondResult).toBeNull();
      expect(mx.getStateEvent).toHaveBeenCalledTimes(1);
      expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
      expectGrant(mx, room, helper, 100);
    });

    it('still gives the rights of an earlier invite when the invite submitted after it fails', async () => {
      const { mx, room, client } = setup();
      const begin = () => beginModeratorGrantIntent(client, room.roomId, helper);
      const first = begin();
      const second = begin();
      second.release();
      expect(await first.run(room as unknown as Room, 50)).toBeNull();
      expectGrant(mx, room, helper, 50);
    });

    it('leaves the write to the newest of two grants for one user, and takes a grant again once they finished', async () => {
      const { mx, room, grant, supersede } = setup();
      const [first, second] = await Promise.all([grant(helper), grant(helper)]);
      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(mx.getStateEvent).toHaveBeenCalledTimes(1);
      expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
      expectGrant(mx, room, helper, 50);

      // Nothing waits any more: an invite without the grant has nothing to supersede, and the
      // grant of a later invite writes as the first of its user.
      room.state.powerLevels = defaultPowerLevels();
      supersede(helper);
      expect(await grant(helper)).toBeNull();
      expect(mx.sendStateEvent).toHaveBeenCalledTimes(2);
    });
  });
});

describe('InviteUserPrompt (Option A — Instant Directory Sheet)', () => {
  it('frames the dialog for desktop, tablet and phone, and follows the visual viewport at every width', () => {
    const centerClass = (renderer: ReactTestRenderer) =>
      String(renderer.root.findByProps({ 'data-overlay-center': true }).props.className);

    const desktop = renderPrompt({ screenSize: ScreenSize.Desktop });
    expect(getDialog(desktop.renderer).props['aria-modal']).toBe('true');
    expect(getDialog(desktop.renderer).props.className).toContain('InviteDialog');
    expect(getDialog(desktop.renderer).props.className).not.toContain('PhoneModal');
    expect(centerClass(desktop.renderer).split(' ')).toEqual([
      'SafeOverlayCenter',
      'InviteViewportCenter',
    ]);

    // A phone held sideways is as wide as a tablet and still needs the keyboard's viewport.
    const tablet = renderPrompt({ screenSize: ScreenSize.Tablet });
    expect(getDialog(tablet.renderer).props.className).not.toContain('PhoneModal');
    expect(centerClass(tablet.renderer).split(' ')).toEqual([
      'SafeOverlayCenter',
      'InviteViewportCenter',
    ]);

    const mobile = renderPrompt({ screenSize: ScreenSize.Mobile });
    expect(getDialog(mobile.renderer).props.className).toContain('PhoneModal');
    expect(centerClass(mobile.renderer).split(' ')).toEqual([
      'PhoneOverlayCenter',
      'InviteViewportCenter',
    ]);
  });

  it('keeps the search, the rows and the footer in one body below the title, so a short viewport can scroll them together', () => {
    const { renderer } = renderPrompt();
    const body = renderer.root.find(
      (node) => node.type === 'div' && node.props.className === 'InviteBody'
    );
    const sections = body.children
      .filter((child): child is ReactTestInstance => typeof child !== 'string')
      .map((child) => child.props.className);
    expect(sections).toEqual(['InviteControls', 'InviteListArea', 'InviteFooter']);

    // The moderator checkbox is in the controls, above the first row; the footer holds the note.
    const part = (className: string) =>
      body.find((node) => node.type === 'div' && node.props.className === className);
    const checkboxes = (node: ReactTestInstance) =>
      node.findAll((child) => child.type === 'input' && child.props.type === 'checkbox');
    expect(checkboxes(part('InviteControls'))).toHaveLength(1);
    expect(checkboxes(part('InviteControls'))[0]!.props.checked).toBe(true);
    expect(extractText(part('InviteControls'))).toContain('Give invited agents Moderator rights');
    expect(checkboxes(part('InviteListArea'))).toHaveLength(0);
    expect(checkboxes(part('InviteFooter'))).toHaveLength(0);
    expect(extractText(part('InviteFooter'))).toBe('+ Add invite note');
    expect(part('InviteListArea').findAllByType('li').length).toBeGreaterThan(0);
    expect(
      body.findAll((node) => node.props.id === 'invite-user-prompt-title', { deep: true })
    ).toHaveLength(0);
  });

  it("shows the isolated room title, the Done button, and the room's own member and invited counts", async () => {
    const requestClose = vi.fn();
    const { renderer, mx, room } = renderPrompt({
      name: 'Design Review',
      joinedCount: 2,
      invitedCount: 0,
      requestClose,
    });

    const heading = renderer.root.findByProps({ id: 'invite-user-prompt-title' });
    expect(extractText(heading)).toBe('Invite to \u2068Design Review\u2069');
    expect(getSubtitle(renderer)).toBe('2 Members');

    // An invite sent here is counted once the room counts it, not before.
    await clickRowInvite(renderer, 'Maya Chen');
    expect(getSubtitle(renderer)).toBe('2 Members');

    room.state.invitedCount = 1;
    emitMembership(mx, room, '@maya:example.org', 'invite');
    expect(getSubtitle(renderer)).toBe('2 Members · 1 Invited');

    // Maya declines: the count follows the room.
    room.state.invitedCount = 0;
    emitMembership(mx, room, '@maya:example.org', 'leave');
    expect(getSubtitle(renderer)).toBe('2 Members');

    // Clicking Done calls requestClose.
    const doneBtn = renderer.root.find(
      (node) => node.type === 'button' && extractText(node) === 'Done'
    );
    act(() => {
      doneBtn.props.onClick();
    });
    expect(requestClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the room's own counts through a joined-only summary and a summary that counts only part of the invites", async () => {
    // Three people are invited already; two more are invited from the sheet.
    const { renderer, mx, room } = renderPrompt({ joinedCount: 2, invitedCount: 3 });
    expect(getSubtitle(renderer)).toBe('2 Members · 3 Invited');

    await clickRowInvite(renderer, 'Maya Chen');
    await clickRowInvite(renderer, 'Liam Park');
    expect(getSubtitle(renderer)).toBe('2 Members · 3 Invited');

    // Someone joins: the summary names the joined count only, and the invited count stays.
    emitSummary(room, { joined: 3 });
    expect(getSubtitle(renderer)).toBe('3 Members · 3 Invited');

    // The next summary counts Maya's invite and not yet Liam's: nothing is added on top.
    emitSummary(room, { invited: 4 });
    expect(getSubtitle(renderer)).toBe('3 Members · 4 Invited');
    emitMembership(mx, room, '@maya:example.org', 'invite');
    expect(getSubtitle(renderer)).toBe('3 Members · 4 Invited');

    emitSummary(room, { invited: 5 });
    emitMembership(mx, room, '@liam:example.org', 'invite');
    expect(getSubtitle(renderer)).toBe('3 Members · 5 Invited');
  });

  it('falls back to "Invite" when room name is empty or whitespace', () => {
    const { renderer } = renderPrompt({ name: '   ' });
    const heading = renderer.root.findByProps({ id: 'invite-user-prompt-title' });
    expect(extractText(heading)).toBe('Invite');
  });

  it('shows browsable Recent & Direct and Directory sections on open, filters People / Agents, and keeps consent checkbox visible on People tab', () => {
    directUsersMock.users = ['@maya:example.org', '@mindroom_coder:example.org'];
    const { renderer } = renderPrompt({
      cache: readyCache([
        { userId: '@maya:example.org', displayName: 'Maya Chen' },
        { userId: '@liam:example.org', displayName: 'Liam Park' },
        { userId: '@mindroom_coder:example.org', displayName: 'Coder' },
        { userId: '@mindroom_helper:example.org', displayName: 'Helper' },
        { userId: '@mindroom_foreign:other.org', displayName: 'Foreign Bot' },
      ]),
    });

    const sectionHeadings = renderer.root
      .findAll(
        (node) =>
          node.type === 'h3' && String(node.props.className ?? '').includes('InviteSectionHeader')
      )
      .map(extractText);
    expect(sectionHeadings).toEqual(['Recent & Direct', 'Directory']);
    expect(getRows(renderer)).toHaveLength(5);

    // Same-server agent has Agent badge; human & foreign agent do not.
    expect(extractText(getRowByText(renderer, 'Coder')!)).toContain('Agent');
    expect(extractText(getRowByText(renderer, 'Maya Chen')!)).not.toContain('Agent');
    expect(extractText(getRowByText(renderer, 'Foreign Bot')!)).not.toContain('Agent');

    // People tab: flat list (no section headers), hides same-server agents, keeps moderator checkbox visible.
    act(() => {
      getFilterButton(renderer, 'People').props.onClick();
    });
    expect(getFilterButton(renderer, 'People').props['aria-pressed']).toBe(true);
    expect(
      renderer.root.findAll(
        (node) =>
          node.type === 'h3' && String(node.props.className ?? '').includes('InviteSectionHeader')
      )
    ).toHaveLength(0);
    expect(getRows(renderer).map(extractText).join(' ')).toContain('Maya Chen');
    expect(getRows(renderer).map(extractText).join(' ')).toContain('Liam Park');
    expect(getRows(renderer).map(extractText).join(' ')).toContain('Foreign Bot');
    expect(getRows(renderer).map(extractText).join(' ')).not.toContain('Coder');
    expect(findModeratorCheckbox(renderer)).toBeDefined();

    // Agents tab: flat list of same-server agents only, moderator checkbox visible.
    act(() => {
      getFilterButton(renderer, 'Agents').props.onClick();
    });
    expect(getRows(renderer)).toHaveLength(2);
    expect(getRows(renderer).map(extractText).join(' ')).toContain('Coder');
    expect(getRows(renderer).map(extractText).join(' ')).toContain('Helper');
    expect(findModeratorCheckbox(renderer)).toBeDefined();
  });

  it('on People tab, typing a listed agent MXID shows its directory name (not External Matrix ID) and respects checkbox toggle on both Enter and click', async () => {
    const { renderer, mx } = renderPrompt();
    act(() => {
      getFilterButton(renderer, 'People').props.onClick();
    });

    typeSearch(renderer, '@mindroom_coder:example.org');
    const coderRow = getRowByText(renderer, 'Coder');
    expect(coderRow).toBeDefined();
    expect(extractText(coderRow!)).not.toContain('External Matrix ID');
    expect(extractText(coderRow!)).toContain('@mindroom_coder:example.org');

    // Uncheck consent checkbox (always visible on People tab) -> Enter does not grant.
    const checkbox = findModeratorCheckbox(renderer);
    expect(checkbox?.props.checked).toBe(true);
    act(() => {
      checkbox?.props.onClick();
    });
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(false);

    await pressKeyInSearch(renderer, 'Enter');
    expect(mx.invite).toHaveBeenCalledWith(
      '!room:example.org',
      '@mindroom_coder:example.org',
      undefined
    );
    expect(mx.sendStateEvent).not.toHaveBeenCalled();

    // Also verify button click on another listed agent while checkbox is OFF skips grant.
    typeSearch(renderer, '@mindroom_helper:example.org');
    await clickRowInvite(renderer, 'Helper');
    expect(mx.invite).toHaveBeenCalledWith(
      '!room:example.org',
      '@mindroom_helper:example.org',
      undefined
    );
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
  });

  it('finds a matching agent under Agents tab even when 10 higher-ranked people match the query', () => {
    const tenPeople: ServerUserDirectoryUser[] = Array.from({ length: 10 }, (_, index) => ({
      userId: `@alpha_${String(index).padStart(2, '0')}:example.org`,
      displayName: `Alpha Person ${String(index).padStart(2, '0')}`,
    }));
    const agent: ServerUserDirectoryUser = {
      userId: '@mindroom_ops:example.org',
      displayName: 'Operations Alpha',
    };
    const { renderer } = renderPrompt({ cache: readyCache([...tenPeople, agent]) });

    act(() => {
      getFilterButton(renderer, 'Agents').props.onClick();
    });
    typeSearch(renderer, 'alpha');

    expect(getRows(renderer)).toHaveLength(1);
    expect(getRowByText(renderer, 'Operations Alpha')).toBeDefined();
  });

  it('caps browse directory rows at 100 entries including carried-over attempts, and deduplicates across sections', async () => {
    const manyUsers: ServerUserDirectoryUser[] = Array.from({ length: 130 }, (_, index) => ({
      userId: `@user_${String(index).padStart(3, '0')}:example.org`,
      displayName: `User ${String(index).padStart(3, '0')}`,
    }));
    const { renderer, mx } = renderPrompt({ cache: readyCache(manyUsers) });
    expect(getRows(renderer)).toHaveLength(100);

    // Search for a directory user, fail the invite, then clear search:
    // MXID must appear ONCE (as Retry) and total rows must stay <= 100.
    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Temporary outage'));
    typeSearch(renderer, 'User 005');
    await clickRowInvite(renderer, 'User 005');

    typeSearch(renderer, '');
    const matchingRows = getRows(renderer).filter((row) => extractText(row).includes('User 005'));
    expect(matchingRows).toHaveLength(1);
    expect(extractText(getRowActionButton(matchingRows[0]!))).toBe('Retry');
    expect(getRowActionButton(matchingRows[0]!).props['aria-label']).toBe(
      'Retry inviting User 005'
    );
    expect(getRows(renderer).length).toBeLessThanOrEqual(100);
  });

  it('carries invites on their way and failed ones to another filter or query, and leaves a sent invite behind', async () => {
    const { renderer, mx, room } = renderPrompt();
    const action = (name: string) => getRowActionButton(getRowByText(renderer, name)!);

    // Coder's invite is sent and in the room's state, Liam's fails, Maya's is still on its way.
    await clickRowInvite(renderer, 'Coder');
    emitMembership(mx, room, '@mindroom_coder:example.org', 'invite');
    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Network down'));
    await clickRowInvite(renderer, 'Liam Park');
    const finishMaya = holdNextInvite(mx);
    await clickRowInvite(renderer, 'Maya Chen');
    expect(mx.invite).toHaveBeenCalledTimes(3);

    // In the view they were started from, all three keep their rows.
    expect(extractText(action('Coder'))).toBe('Invited');
    expect(extractText(action('Liam Park'))).toBe('Retry');
    expect(action('Maya Chen').props['aria-disabled']).toBe(true);
    // A row whose invite is on its way or sent takes no second click.
    await clickRowInvite(renderer, 'Maya Chen');
    await clickRowInvite(renderer, 'Coder');
    expect(mx.invite).toHaveBeenCalledTimes(3);

    const expectCarried = () => {
      expect(getRowByText(renderer, 'Coder')).toBeUndefined();
      expect(extractText(action('Liam Park'))).toBe('Retry');
      expect(extractText(action('Maya Chen'))).toBe('Invite');
      expect(action('Maya Chen').props['aria-disabled']).toBe(true);
    };
    // Another filter, also one that would not list them: Liam and Maya come along, Coder does not.
    act(() => {
      getFilterButton(renderer, 'Agents').props.onClick();
    });
    expectCarried();
    // Another query.
    typeSearch(renderer, 'helper');
    expectCarried();
    expect(getRowByText(renderer, 'Helper')).toBeDefined();

    // Maya's invite returns in the view it was carried to, and stays behind in the next.
    await finishMaya();
    expect(extractText(action('Maya Chen'))).toBe('Invited');
    emitMembership(mx, room, '@maya:example.org', 'invite');
    typeSearch(renderer, '');
    act(() => {
      getFilterButton(renderer, 'All').props.onClick();
    });
    expect(getRowByText(renderer, 'Maya Chen')).toBeUndefined();
    expect(getRowByText(renderer, 'Coder')).toBeUndefined();
    expect(extractText(action('Liam Park'))).toBe('Retry');

    // The room's state says who is invited: no second invite for Maya.
    typeSearch(renderer, '@maya:example.org');
    expect(extractText(getDialog(renderer))).toContain('Already invited');
    await pressKeyInSearch(renderer, 'Enter');
    expect(mx.invite).toHaveBeenCalledTimes(3);
  });

  it('shows inline hints for already-joined, banned, and invalid Enter queries', async () => {
    const { renderer, mx } = renderPrompt({
      members: [
        { userId: '@joined:example.org', membership: 'join' },
        { userId: '@banned:example.org', membership: 'ban' },
      ],
    });

    typeSearch(renderer, '@joined:example.org');
    expect(extractText(getDialog(renderer))).toContain('Already in this room');
    expect(extractText(getDialog(renderer))).not.toContain('No matching users');

    typeSearch(renderer, '@banned:example.org');
    expect(extractText(getDialog(renderer))).toContain('Banned from this room');

    // While the homeserver is still asked, the text may yet find someone.
    typeSearch(renderer, 'not-a-matrix-id');
    await pressKeyInSearch(renderer, 'Enter');
    expect(extractText(getDialog(renderer))).not.toContain('Please enter a valid User ID.');

    await waitForServerSearch();
    await pressKeyInSearch(renderer, 'Enter');
    expect(mx.invite).not.toHaveBeenCalled();
    expect(extractText(getDialog(renderer))).toContain('Please enter a valid User ID.');
  });

  it('shows a direct-invite row with External Matrix ID subtitle for unlisted typed MXIDs regardless of filter', async () => {
    const { renderer, mx, room } = renderPrompt();
    act(() => {
      getFilterButton(renderer, 'Agents').props.onClick();
    });

    typeSearch(renderer, '@external:other.org');
    const row = getRowByText(renderer, '@external:other.org');
    expect(row).toBeDefined();
    expect(extractText(row!)).toContain('External Matrix ID');

    await clickRowInvite(renderer, '@external:other.org');
    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@external:other.org', undefined);
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
  });

  it('immediately invites a typed eligible MXID on Enter, clears search, and keeps focus in search input', async () => {
    const { renderer, mx, room } = renderPrompt();
    focusInput.mockClear();

    typeSearch(renderer, '@alice:example.org');
    const preventDefault = await pressKeyInSearch(renderer, 'Enter');

    expect(preventDefault).toHaveBeenCalled();
    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@alice:example.org', undefined);
    expect(getSearchInput(renderer).props.value).toBe('');
    expect(focusInput).toHaveBeenCalled();
    expect(textContentByRole(renderer, 'status')).toContain('@alice:example.org');
  });

  it('ignores Enter and ArrowDown while IME composition is active', async () => {
    const focusFirst = vi.fn();
    rowFocusElements.push({ focus: focusFirst });
    const { renderer, mx } = renderPrompt();

    typeSearch(renderer, '@alice:example.org');
    await pressKeyInSearch(renderer, 'Enter', { nativeEvent: { isComposing: true, keyCode: 13 } });
    await pressKeyInSearch(renderer, 'Enter', { keyCode: 229 });
    await pressKeyInSearch(renderer, 'ArrowDown', {
      nativeEvent: { isComposing: true, keyCode: 40 },
    });

    expect(mx.invite).not.toHaveBeenCalled();
    expect(focusFirst).not.toHaveBeenCalled();
    expect(getSearchInput(renderer).props.value).toBe('@alice:example.org');
  });

  it('moves focus between search input and row actions with ArrowDown / ArrowUp and clears search', async () => {
    const originalDocument = globalThis.document;
    const activeDoc: { activeElement: unknown } = { activeElement: null };
    const firstEl = {
      focus: vi.fn(() => {
        activeDoc.activeElement = firstEl;
      }),
    };
    const secondEl = {
      focus: vi.fn(() => {
        activeDoc.activeElement = secondEl;
      }),
    };
    rowFocusElements.push(firstEl, secondEl);
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: activeDoc,
    });

    try {
      const { renderer } = renderPrompt();
      const listArea = renderer.root.find(
        (node) => node.type === 'div' && node.props.className === 'InviteListArea'
      );

      // Clear button empties search and refocuses the search input.
      typeSearch(renderer, 'maya');
      expect(getSearchInput(renderer).props.value).toBe('maya');
      const clearBtn = renderer.root.find(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Clear'
      );
      focusInput.mockClear();
      act(() => {
        clearBtn.props.onClick();
      });
      expect(getSearchInput(renderer).props.value).toBe('');
      expect(focusInput).toHaveBeenCalled();

      // ArrowDown from search input moves focus to the first row action, then second.
      const preventDown1 = await pressKeyInSearch(renderer, 'ArrowDown');
      expect(preventDown1).toHaveBeenCalled();
      expect(firstEl.focus).toHaveBeenCalledTimes(1);

      const preventDown2 = vi.fn();
      act(() => {
        listArea.props.onKeyDown({ key: 'ArrowDown', preventDefault: preventDown2 });
      });
      expect(preventDown2).toHaveBeenCalled();
      expect(secondEl.focus).toHaveBeenCalledTimes(1);

      // ArrowUp moves back to first row, then back to search input.
      act(() => {
        listArea.props.onKeyDown({ key: 'ArrowUp', preventDefault: vi.fn() });
      });
      expect(firstEl.focus).toHaveBeenCalledTimes(2);

      focusInput.mockClear();
      act(() => {
        listArea.props.onKeyDown({ key: 'ArrowUp', preventDefault: vi.fn() });
      });
      expect(focusInput).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
    }
  });

  it('keeps an invited row in place after Matrix sync and supports Retry on invite failure', async () => {
    const { renderer, mx, room } = renderPrompt();

    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Network down'));
    await clickRowInvite(renderer, 'Maya Chen');

    const failedRow = getRowByText(renderer, 'Maya Chen')!;
    expect(extractText(getRowActionButton(failedRow))).toBe('Retry');
    expect(textContentByRole(renderer, 'alert')).toContain('Network down');

    typeSearch(renderer, 'liam');
    expect(getRowByText(renderer, 'Maya Chen')).toBeDefined();

    await clickRowInvite(renderer, 'Maya Chen');
    expect(mx.invite).toHaveBeenCalledTimes(2);
    emitMembership(mx, room, '@maya:example.org', 'invite');
    const sentRow = getRowByText(renderer, 'Maya Chen')!;
    expect(extractText(getRowActionButton(sentRow))).toBe('Invited');
    expect(getRowActionButton(sentRow).props['aria-disabled']).toBe(true);
  });

  it('drops a failed attempt automatically if the user joins or gets invited externally', async () => {
    const { renderer, mx, room } = renderPrompt();
    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Temporary failure'));
    await clickRowInvite(renderer, 'Maya Chen');
    expect(textContentByRole(renderer, 'alert')).toContain('Temporary failure');

    emitMembership(mx, room, '@maya:example.org', 'join');
    expect(getRowByText(renderer, 'Maya Chen')).toBeUndefined();
    expect(textContentByRole(renderer, 'alert')).toBe('');
  });

  it('handles invite note lifecycle: clears after success, does not send when collapsed, Retry preserves original note, and never erases a newer draft', async () => {
    const { renderer, mx, room } = renderPrompt();
    expect(getNoteToggle(renderer).props['aria-expanded']).toBe(false);
    expect(extractText(getNoteToggle(renderer))).toBe('+ Add invite note');

    // Expand note, type reason, invite Maya -> sends trimmed note and clears input afterward.
    act(() => {
      getNoteToggle(renderer).props.onClick();
    });
    expect(getNoteToggle(renderer).props['aria-expanded']).toBe(true);
    expect(extractText(getNoteToggle(renderer))).toBe('− Hide invite note');
    act(() => {
      getNoteInput(renderer).props.onChange({ target: { value: '  Welcome aboard!  ' } });
    });

    await clickRowInvite(renderer, 'Maya Chen');
    expect(mx.invite).toHaveBeenNthCalledWith(
      1,
      room.roomId,
      '@maya:example.org',
      'Welcome aboard!'
    );
    expect(getNoteInput(renderer).props.value).toBe('');

    // Second invite with empty note sends undefined.
    await clickRowInvite(renderer, 'Liam Park');
    expect(mx.invite).toHaveBeenNthCalledWith(2, room.roomId, '@liam:example.org', undefined);

    // Type a note, collapse the note field -> hidden note is NOT sent.
    act(() => {
      getNoteInput(renderer).props.onChange({ target: { value: 'Hidden secret note' } });
    });
    act(() => {
      getNoteToggle(renderer).props.onClick();
    });
    expect(getNoteToggle(renderer).props['aria-expanded']).toBe(false);
    typeSearch(renderer, '@alice:example.org');
    await pressKeyInSearch(renderer, 'Enter');
    expect(mx.invite).toHaveBeenNthCalledWith(3, room.roomId, '@alice:example.org', undefined);

    // Expand note again, fail invite to @bob:example.org with original note, then edit note;
    // Retry must send @bob's original note, not the edited draft.
    act(() => {
      getNoteToggle(renderer).props.onClick();
    });
    act(() => {
      getNoteInput(renderer).props.onChange({ target: { value: 'Note for Bob' } });
    });
    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Failed once'));
    typeSearch(renderer, '@bob:example.org');
    await pressKeyInSearch(renderer, 'Enter');
    expect(mx.invite).toHaveBeenNthCalledWith(4, room.roomId, '@bob:example.org', 'Note for Bob');

    act(() => {
      getNoteInput(renderer).props.onChange({ target: { value: 'Different draft for Carol' } });
    });
    await clickRowInvite(renderer, '@bob:example.org');
    expect(mx.invite).toHaveBeenNthCalledWith(5, room.roomId, '@bob:example.org', 'Note for Bob');
    expect(getNoteInput(renderer).props.value).toBe('Different draft for Carol');

    // Start an invite with current draft, edit draft while invite is in flight -> newer draft is preserved.
    let resolveCarol!: () => void;
    vi.mocked(mx.invite).mockImplementationOnce(
      () => new Promise((resolve) => (resolveCarol = () => resolve({} as never)))
    );
    typeSearch(renderer, '@carol:example.org');
    await pressKeyInSearch(renderer, 'Enter');
    act(() => {
      getNoteInput(renderer).props.onChange({ target: { value: 'Newer draft while in flight' } });
    });
    await act(async () => {
      resolveCarol();
      await settle();
    });
    expect(getNoteInput(renderer).props.value).toBe('Newer draft while in flight');
  });

  it('defaults moderator rights ON for MindRoom agents when none holds moderator power, and invites before granting', async () => {
    const { renderer, mx, room } = renderPrompt();
    const calls: string[] = [];
    vi.mocked(mx.invite).mockImplementation(async () => {
      calls.push('invite');
      return {} as never;
    });
    vi.mocked(mx.getStateEvent).mockImplementation(async () => {
      calls.push('readPowerLevels');
      return structuredClone(room.state.powerLevels) as never;
    });
    vi.mocked(mx.sendStateEvent).mockImplementation(async () => {
      calls.push('writePowerLevels');
      return {} as never;
    });

    const checkbox = findModeratorCheckbox(renderer);
    expect(checkbox).toBeDefined();
    expect(checkbox?.props.checked).toBe(true);

    await clickRowInvite(renderer, 'Helper');

    expect(calls).toEqual(['invite', 'readPowerLevels', 'writePowerLevels']);
    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', undefined);
    expectGrant(mx, room, '@mindroom_helper:example.org', 50);
  });

  it('never writes power levels for humans, owner account, foreign-server agents, or agents already at moderator power', async () => {
    const { renderer, mx } = renderPrompt({
      powerLevels: {
        users: { '@me:example.org': 100, '@mindroom_already:example.org': 50 },
        users_default: 0,
        state_default: 50,
        events: { 'm.room.power_levels': 100 },
      },
    });
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(true);

    for (const target of [
      '@alice:example.org',
      '@mindroom_router:example.org',
      '@mindroom_helper:other.org',
      '@mindroom_already:example.org',
    ]) {
      typeSearch(renderer, target);
      await pressKeyInSearch(renderer, 'Enter');
    }

    expect(mx.invite).toHaveBeenCalledTimes(4);
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
  });

  it('defaults moderator rights OFF when a MindRoom agent in the room already holds moderator power', async () => {
    const { renderer, mx, room } = renderPrompt({
      members: [{ userId: '@mindroom_steward:example.org', membership: 'join' }],
      powerLevels: {
        users: { '@me:example.org': 100, '@mindroom_steward:example.org': 50 },
        users_default: 0,
        state_default: 50,
        events: { 'm.room.power_levels': 100 },
      },
    });

    const checkbox = findModeratorCheckbox(renderer);
    expect(checkbox).toBeDefined();
    expect(checkbox?.props.checked).toBe(false);

    await clickRowInvite(renderer, 'Helper');

    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', undefined);
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
  });

  it('skips the grant when the user unchecks the moderator checkbox', async () => {
    const { renderer, mx, room } = renderPrompt();
    const checkbox = findModeratorCheckbox(renderer);
    expect(checkbox?.props.checked).toBe(true);
    act(() => {
      checkbox?.props.onClick();
    });
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(false);

    await clickRowInvite(renderer, 'Helper');

    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', undefined);
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
  });

  it('uses the room router state power level when higher than 50', async () => {
    const { renderer, mx, room } = renderPrompt({
      powerLevels: {
        users: { '@me:example.org': 100 },
        users_default: 0,
        state_default: 50,
        events: { 'm.room.power_levels': 100, 'io.mindroom.router': 75 },
      },
    });

    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(true);
    await clickRowInvite(renderer, 'Helper');
    expectGrant(mx, room, '@mindroom_helper:example.org', 75);
  });

  it.each([
    { label: 'Space room', options: { isSpace: true } },
    {
      label: 'viewer cannot change power levels',
      options: {
        powerLevels: {
          users: { '@me:example.org': 50 },
          users_default: 0,
          state_default: 50,
          events: { 'm.room.power_levels': 100 },
        },
      },
    },
    {
      label: 'viewer can send power_levels but sits below grant level',
      options: {
        powerLevels: {
          users: { '@me:example.org': 50 },
          users_default: 0,
          state_default: 50,
          events: { 'm.room.power_levels': 50, 'io.mindroom.router': 75 },
        },
      },
    },
    { label: 'v9 room', options: { roomVersion: '9' } },
    { label: 'unknown non-numeric room version', options: { roomVersion: 'org.example.unstable' } },
  ])(
    'hides the moderator checkbox and still loads the member list for $label',
    async ({ options }) => {
      let resolveLoad: (loaded: boolean) => void = () => undefined;
      const { renderer, room } = renderPrompt({
        membersLoaded: false,
        loadMembersIfNeeded: () =>
          new Promise<boolean>((resolve) => {
            resolveLoad = resolve;
          }),
        ...options,
      });
      expect(findModeratorCheckbox(renderer)).toBeUndefined();
      expect(room.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
      // Maya has posted nothing lately, so the lazy-loaded room does not know her yet.
      expect(getRowByText(renderer, 'Maya Chen')).toBeDefined();

      // The member list arrives without a membership event of its own.
      room.state.members.push({ userId: '@maya:example.org', membership: 'join' });
      room.state.membersLoaded = true;
      await act(async () => {
        resolveLoad(true);
        await settle();
      });

      expect(getRowByText(renderer, 'Maya Chen')).toBeUndefined();
      expect(getRowByText(renderer, 'Liam Park')).toBeDefined();
      typeSearch(renderer, '@maya:example.org');
      expect(extractText(getDialog(renderer))).toContain('Already in this room');
      expect(findModeratorCheckbox(renderer)).toBeUndefined();
      expect(room.getMembers).not.toHaveBeenCalled();
    }
  );

  it('drops members who arrive with the lazy-loaded list before the search limits its results', async () => {
    const people: ServerUserDirectoryUser[] = [
      { userId: '@alpha:example.org', displayName: 'Alpha' },
      ...Array.from({ length: 8 }, (_, index) => ({
        userId: `@alpha_${index}:example.org`,
        displayName: `Alpha Person ${index}`,
      })),
    ];
    let resolveLoad: (loaded: boolean) => void = () => undefined;
    const { renderer, room } = renderPrompt({
      cache: readyCache(people),
      membersLoaded: false,
      loadMembersIfNeeded: () =>
        new Promise<boolean>((resolve) => {
          resolveLoad = resolve;
        }),
    });

    typeSearch(renderer, 'alpha');
    expect(getRows(renderer)).toHaveLength(8);
    expect(getRowByText(renderer, '@alpha:example.org')).toBeDefined();

    room.state.members.push({ userId: '@alpha:example.org', membership: 'join' });
    room.state.membersLoaded = true;
    await act(async () => {
      resolveLoad(true);
      await settle();
    });

    expect(getRowByText(renderer, '@alpha:example.org')).toBeUndefined();
    expect(getRows(renderer)).toHaveLength(8);

    // The directory that opens without a search no longer lists the member either.
    typeSearch(renderer, '');
    expect(getRows(renderer)).toHaveLength(8);
    expect(getRowByText(renderer, '@alpha:example.org')).toBeUndefined();
  });

  it('keeps the invite (Invited button) and shows a non-blocking error when granting moderator rights fails', async () => {
    const { renderer, mx, room } = renderPrompt();
    vi.mocked(mx.sendStateEvent).mockRejectedValueOnce(new Error('Forbidden'));
    focusInput.mockClear();

    typeSearch(renderer, '@mindroom_helper:example.org');
    await pressKeyInSearch(renderer, 'Enter');

    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', undefined);
    expectGrant(mx, room, '@mindroom_helper:example.org', 50);
    expect(getSearchInput(renderer).props.value).toBe('');
    expect(focusInput).toHaveBeenCalled();
    // The invite is announced as sent; the failed grant is the sheet's alert, in no row.
    expect(textContentByRole(renderer, 'status')).toBe('Invited @mindroom_helper:example.org.');
    expect(textContentByRole(renderer, 'alert')).toBe(
      'Invited @mindroom_helper:example.org, but could not give Moderator rights: Forbidden'
    );
    expect(getGrantAlerts(renderer)).toHaveLength(1);

    const helperRow = getRowByText(renderer, 'Helper')!;
    expect(extractText(getRowActionButton(helperRow))).toBe('Invited');
    expect(extractText(helperRow)).not.toContain('Forbidden');
  });

  it('loads members lazily, ignores out-of-band membership events during hydration, takes one snapshot, and flips ON', async () => {
    let resolveLoad: (loaded: boolean) => void = () => undefined;
    const loadPromise = new Promise<boolean>((resolve) => {
      resolveLoad = resolve;
    });
    const { renderer, mx, room } = renderPrompt({
      membersLoaded: false,
      loadMembersIfNeeded: () => loadPromise,
    });

    expect(room.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(false);

    act(() => {
      mx.emit('RoomMember.membership', undefined, { roomId: room.roomId });
      mx.emit('RoomMember.membership', undefined, { roomId: room.roomId });
    });
    expect(room.getMembers).not.toHaveBeenCalled();

    room.state.membersLoaded = true;
    await act(async () => {
      resolveLoad(true);
      await settle();
    });
    expect(room.getMembers).toHaveBeenCalledTimes(1);
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(true);
  });

  it('allows explicit opt-in while room members are still loading', async () => {
    const { renderer, mx, room } = renderPrompt({
      membersLoaded: false,
      loadMembersIfNeeded: () => new Promise<boolean>(() => undefined),
    });

    const checkbox = findModeratorCheckbox(renderer);
    expect(checkbox?.props.checked).toBe(false);
    act(() => {
      checkbox?.props.onClick();
    });
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(true);

    await clickRowInvite(renderer, 'Helper');

    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', undefined);
    expectGrant(mx, room, '@mindroom_helper:example.org', 50);
  });

  it('derives the default from live state once a previous grant syncs and that agent leaves', async () => {
    const { renderer, mx, room } = renderPrompt();
    vi.mocked(mx.sendStateEvent).mockImplementationOnce(async () => {
      room.state.members = [{ userId: '@mindroom_helper:example.org', membership: 'invite' }];
      room.state.powerLevels = {
        ...room.state.powerLevels,
        users: { '@me:example.org': 100, '@mindroom_helper:example.org': 50 },
      };
      mx.emit('RoomState.events', {
        getRoomId: () => room.roomId,
        getType: () => 'm.room.power_levels',
        getStateKey: () => '',
        getId: () => '$pl1',
        getContent: () => room.state.powerLevels,
      });
      mx.emit('RoomMember.membership', undefined, {
        roomId: room.roomId,
        userId: '@mindroom_helper:example.org',
        events: {},
      });
      return { event_id: '$pl1' };
    });

    await clickRowInvite(renderer, 'Helper');
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(false);

    emitMembership(mx, room, '@mindroom_helper:example.org', 'leave');
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(true);
  });

  it('finishes the submitted grant even when the dialog closes while invite is pending', async () => {
    let finishInvite: () => void = () => undefined;
    const { renderer, mx, room } = renderPrompt();
    vi.mocked(mx.invite).mockImplementationOnce(
      () => new Promise((resolve) => (finishInvite = () => resolve({} as never)))
    );

    act(() => {
      getRowActionButton(getRowByText(renderer, 'Helper')!).props.onClick();
    });
    act(() => {
      renderer.unmount();
    });

    await act(async () => {
      finishInvite();
      await settle();
    });

    expectGrant(mx, room, '@mindroom_helper:example.org', 50);
  });

  it('gives no rights when the sheet closes while an invite with the grant is on its way, opens again and invites the agent without the grant', async () => {
    const helper = '@mindroom_helper:example.org';
    const first = renderPrompt();
    const { mx, room } = first;
    const finishFirstInvite = holdNextInvite(mx);
    await clickRowInvite(first.renderer, 'Helper');
    act(() => {
      first.renderer.unmount();
    });

    // The sheet opens again on the same room, and invites Helper with the checkbox cleared.
    const second = renderPrompt({ session: first });
    act(() => {
      findModeratorCheckbox(second.renderer)!.props.onClick();
    });
    expect(findModeratorCheckbox(second.renderer)!.props.checked).toBe(false);
    await clickRowInvite(second.renderer, 'Helper');
    expect(mx.invite).toHaveBeenCalledTimes(2);
    expect(mx.invite).toHaveBeenLastCalledWith(room.roomId, helper, undefined);

    // The first invite returns: its grant is withdrawn, and tells of nothing.
    await finishFirstInvite();
    expect(mx.getStateEvent).not.toHaveBeenCalled();
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
    expect(getGrantAlerts(second.renderer)).toHaveLength(0);
    expect(second.store.get(detachedGrantErrorAtom)).toEqual([]);

    // Nothing is left of it: a later invite with the grant gives the rights.
    emitMembership(mx, room, helper, 'invite');
    emitMembership(mx, room, helper, 'leave');
    act(() => {
      findModeratorCheckbox(second.renderer)!.props.onClick();
    });
    await clickRowInvite(second.renderer, 'Helper');
    expect(mx.invite).toHaveBeenCalledTimes(3);
    expectGrant(mx, room, helper, 50);
  });

  it('re-reads live power levels before writing and writes nothing if target was already promoted', async () => {
    const { renderer, mx, room } = renderPrompt();
    vi.mocked(mx.invite).mockImplementationOnce(async () => {
      room.state.powerLevels = {
        ...room.state.powerLevels,
        users: { '@me:example.org': 100, '@mindroom_helper:example.org': 75 },
      };
      return {} as never;
    });

    await clickRowInvite(renderer, 'Helper');

    expect(mx.invite).toHaveBeenCalledTimes(1);
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
  });

  it('allows a room v12 creator with no explicit user power entry to grant moderator rights', async () => {
    const { renderer, mx, room } = renderPrompt({
      createContent: { room_version: '12' },
      createSender: '@me:example.org',
      powerLevels: {
        users: {},
        users_default: 0,
        state_default: 50,
        events: { 'm.room.power_levels': 100 },
      },
    });

    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(true);
    await clickRowInvite(renderer, 'Helper');
    expectGrant(mx, room, '@mindroom_helper:example.org', 50);
  });

  it('names Admin (100) in the checkbox label and help when the grant level is 100', () => {
    const { renderer } = renderPrompt({
      powerLevels: {
        users: { '@me:example.org': 100 },
        users_default: 0,
        state_default: 50,
        events: { 'm.room.power_levels': 100, 'io.mindroom.router': 100 },
      },
    });

    const allText = extractText(getDialog(renderer));
    expect(allText).toContain('Give invited agents Admin (100) rights');
    expect(allText).toContain('This room requires Admin (100) rights');
    expect(allText).not.toContain('Give invited agents Moderator rights');
  });

  it('shows the numeric level when a custom level-100 tag is named Moderator, including on requirement rise', async () => {
    const { renderer } = renderPrompt({
      powerLevelTags: { '100': { name: 'Moderator' } },
      powerLevels: {
        users: { '@me:example.org': 100 },
        users_default: 0,
        state_default: 50,
        events: { 'm.room.power_levels': 100, 'io.mindroom.router': 100 },
      },
    });

    const allText = extractText(getDialog(renderer));
    expect(allText).toContain('Give invited agents Moderator (100) rights');
    expect(allText).toContain('This room requires Moderator (100) rights');

    const rising = renderPrompt({
      powerLevelTags: { '100': { name: 'Moderator' } },
    });
    vi.mocked(rising.mx.invite).mockImplementationOnce(async () => {
      rising.room.state.powerLevels = {
        ...rising.room.state.powerLevels,
        events: { 'm.room.power_levels': 100, 'io.mindroom.router': 100 },
      };
      return {} as never;
    });
    await clickRowInvite(rising.renderer, 'Helper');
    expect(rising.mx.sendStateEvent).not.toHaveBeenCalled();
    expect(textContentByRole(rising.renderer, 'alert')).toContain(
      'This room now requires Moderator (100) rights.'
    );
  });

  it('queues multiple detached grant failures after dialog closes without overwriting', async () => {
    let finishFirst: () => void = () => undefined;
    let finishSecond: () => void = () => undefined;
    const { renderer, mx, store } = renderPrompt();
    vi.mocked(mx.invite)
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishFirst = () => resolve({} as never)))
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishSecond = () => resolve({} as never)))
      );
    vi.mocked(mx.sendStateEvent)
      .mockRejectedValueOnce(new Error('Forbidden 1'))
      .mockRejectedValueOnce(new Error('Forbidden 2'));

    act(() => {
      getRowActionButton(getRowByText(renderer, 'Coder')!).props.onClick();
      getRowActionButton(getRowByText(renderer, 'Helper')!).props.onClick();
    });
    act(() => {
      renderer.unmount();
    });

    await act(async () => {
      finishFirst();
      finishSecond();
      await settle();
    });

    expect(store.get(detachedGrantErrorAtom).map((item) => item.message)).toEqual([
      'Invited @mindroom_coder:example.org, but could not give Moderator rights: Forbidden 1',
      'Invited @mindroom_helper:example.org, but could not give Moderator rights: Forbidden 2',
    ]);
  });

  it('writes nothing and reports a changed requirement if the router level rises while invite is in flight', async () => {
    const { renderer, mx, room } = renderPrompt();
    vi.mocked(mx.invite).mockImplementationOnce(async () => {
      room.state.powerLevels = {
        ...room.state.powerLevels,
        events: { 'm.room.power_levels': 100, 'io.mindroom.router': 75 },
      };
      return {} as never;
    });

    await clickRowInvite(renderer, 'Helper');

    expect(mx.invite).toHaveBeenCalledTimes(1);
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
    expect(textContentByRole(renderer, 'alert')).toContain('Team 75');
  });

  it('reports a changed requirement in a detached notice if the router level rises after the dialog closes', async () => {
    let finishInvite: () => void = () => undefined;
    const { renderer, mx, room, store } = renderPrompt();
    vi.mocked(mx.invite).mockImplementationOnce(
      () => new Promise((resolve) => (finishInvite = () => resolve({} as never)))
    );

    act(() => {
      getRowActionButton(getRowByText(renderer, 'Helper')!).props.onClick();
    });
    act(() => {
      renderer.unmount();
    });

    room.state.powerLevels = {
      ...room.state.powerLevels,
      events: { 'm.room.power_levels': 100, 'io.mindroom.router': 100 },
    };
    await act(async () => {
      finishInvite();
      await settle();
    });

    expect(mx.sendStateEvent).not.toHaveBeenCalled();
    const notices = store.get(detachedGrantErrorAtom);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.message).toContain('@mindroom_helper:example.org');
    expect(notices[0]?.message).toContain('Admin');
  });

  it('uses the localized forbidden error if viewer loses permission while invite is in flight', async () => {
    const { renderer, mx, room } = renderPrompt();
    vi.mocked(mx.invite).mockImplementationOnce(async () => {
      room.state.powerLevels = {
        ...room.state.powerLevels,
        users: { '@me:example.org': 0 },
      };
      return {} as never;
    });

    await clickRowInvite(renderer, 'Helper');

    expect(mx.sendStateEvent).not.toHaveBeenCalled();
    expect(textContentByRole(renderer, 'alert')).toContain("You don't have permission to do this.");
  });

  it('offers moderator rights in a v10 room', async () => {
    const { renderer, mx, room } = renderPrompt({ roomVersion: '10' });
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(true);
    await clickRowInvite(renderer, 'Helper');
    expectGrant(mx, room, '@mindroom_helper:example.org', 50);
  });

  it('gives an invite note to the invite it was written for only, also while that invite is pending', async () => {
    const { renderer, mx, room } = renderPrompt();
    writeNote(renderer, '  For Maya only  ');

    const finishMaya = holdNextInvite(mx);
    await clickRowInvite(renderer, 'Maya Chen');
    // The note left with Maya's invite at once.
    expect(getNoteInput(renderer).props.value).toBe('');

    await clickRowInvite(renderer, 'Liam Park');
    await finishMaya();

    expect(mx.invite).toHaveBeenCalledTimes(2);
    expect(mx.invite).toHaveBeenNthCalledWith(1, room.roomId, '@maya:example.org', 'For Maya only');
    expect(mx.invite).toHaveBeenNthCalledWith(2, room.roomId, '@liam:example.org', undefined);
    expect(getNoteInput(renderer).props.value).toBe('');
  });

  it('gives the note to the first of two invites started before the next render', async () => {
    const { renderer, mx, room } = renderPrompt();
    writeNote(renderer, 'For Maya only');

    await act(async () => {
      getRowActionButton(getRowByText(renderer, 'Maya Chen')!).props.onClick();
      getRowActionButton(getRowByText(renderer, 'Liam Park')!).props.onClick();
      await settle();
    });

    expect(mx.invite).toHaveBeenNthCalledWith(1, room.roomId, '@maya:example.org', 'For Maya only');
    expect(mx.invite).toHaveBeenNthCalledWith(2, room.roomId, '@liam:example.org', undefined);
  });

  it('keeps a failed invite’s note for its retry and never passes it on to the next person', async () => {
    const { renderer, mx, room } = renderPrompt();
    writeNote(renderer, 'For Maya only');

    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Network down'));
    await clickRowInvite(renderer, 'Maya Chen');
    expect(extractText(getRowActionButton(getRowByText(renderer, 'Maya Chen')!))).toBe('Retry');
    expect(getNoteInput(renderer).props.value).toBe('');

    await clickRowInvite(renderer, 'Maya Chen');
    expect(extractText(getRowActionButton(getRowByText(renderer, 'Maya Chen')!))).toBe('Invited');
    await clickRowInvite(renderer, 'Liam Park');

    expect(mx.invite).toHaveBeenCalledTimes(3);
    expect(mx.invite).toHaveBeenNthCalledWith(1, room.roomId, '@maya:example.org', 'For Maya only');
    expect(mx.invite).toHaveBeenNthCalledWith(2, room.roomId, '@maya:example.org', 'For Maya only');
    expect(mx.invite).toHaveBeenNthCalledWith(3, room.roomId, '@liam:example.org', undefined);
  });

  it('leaves a draft typed while an invite is pending alone, on success and on a retry', async () => {
    const { renderer, mx, room } = renderPrompt();
    writeNote(renderer, 'For Maya');
    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Network down'));
    await clickRowInvite(renderer, 'Maya Chen');

    writeNote(renderer, 'Draft for Liam');
    const finishRetry = holdNextInvite(mx);
    await clickRowInvite(renderer, 'Maya Chen');
    expect(getNoteInput(renderer).props.value).toBe('Draft for Liam');
    writeNote(renderer, 'Draft for Liam, longer');
    await finishRetry();

    expect(mx.invite).toHaveBeenNthCalledWith(2, room.roomId, '@maya:example.org', 'For Maya');
    expect(getNoteInput(renderer).props.value).toBe('Draft for Liam, longer');
  });

  it.each(['leave', 'knock'] as const)(
    'offers the invite again in its row once the room has the invitee as %s, and leaves the other rows alone',
    async (membership) => {
      const maya = '@maya:example.org';
      const { renderer, mx, room } = renderPrompt();
      const action = (name: string) => getRowActionButton(getRowByText(renderer, name)!);
      await clickRowInvite(renderer, 'Maya Chen');
      await clickRowInvite(renderer, 'Liam Park');
      vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Network down'));
      await clickRowInvite(renderer, 'Coder');
      expect(mx.invite).toHaveBeenCalledTimes(3);

      // The room has Maya's invite: her row stays as it is.
      emitMembership(mx, room, maya, 'invite');
      expect(extractText(action('Maya Chen'))).toBe('Invited');
      expect(action('Maya Chen').props['aria-disabled']).toBe(true);

      // She declines (or declines and knocks): her row offers the invite again.
      emitMembership(mx, room, maya, membership);
      expect(extractText(action('Maya Chen'))).toBe('Invite');
      expect(action('Maya Chen').props['aria-disabled']).toBe(false);
      // Nothing about Liam or Coder arrived: a sent invite and a failed one stay.
      expect(extractText(action('Liam Park'))).toBe('Invited');
      expect(extractText(action('Coder'))).toBe('Retry');
      // A failed invite is no sent one: the same event for Coder leaves the row to retry.
      emitMembership(mx, room, '@mindroom_coder:example.org', membership);
      expect(extractText(action('Coder'))).toBe('Retry');

      await clickRowInvite(renderer, 'Maya Chen');
      expect(mx.invite).toHaveBeenCalledTimes(4);
      expect(mx.invite).toHaveBeenLastCalledWith(room.roomId, maya, undefined);
      expect(extractText(action('Maya Chen'))).toBe('Invited');
    }
  );

  it('ignores a membership event of another room', async () => {
    const { renderer, mx } = renderPrompt();
    await clickRowInvite(renderer, 'Maya Chen');
    act(() => {
      mx.emit(
        'RoomMember.membership',
        { getRoomId: () => '!other:example.org' },
        { roomId: '!other:example.org', userId: '@maya:example.org', membership: 'leave' }
      );
    });
    expect(extractText(getRowActionButton(getRowByText(renderer, 'Maya Chen')!))).toBe('Invited');
  });

  it('still writes the grant of a first invite when a second invite with the grant fails while that grant waits behind another', async () => {
    const helper = '@mindroom_helper:example.org';
    const { renderer, mx, room } = renderPrompt();

    // Coder's grant is being written and stays unanswered; Helper's waits behind it.
    let finishCoderGrant: () => void = () => undefined;
    vi.mocked(mx.sendStateEvent).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCoderGrant = () => resolve({ event_id: '$power_levels' });
        })
    );
    await clickRowInvite(renderer, 'Coder');
    await clickRowInvite(renderer, 'Helper');
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);

    // Helper declines and is invited again, with the rights as before: that invite fails.
    emitMembership(mx, room, helper, 'invite');
    emitMembership(mx, room, helper, 'leave');
    expect(findModeratorCheckbox(renderer)!.props.checked).toBe(true);
    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Network down'));
    await clickRowInvite(renderer, 'Helper');
    expect(mx.invite).toHaveBeenCalledTimes(3);
    expect(extractText(getRowActionButton(getRowByText(renderer, 'Helper')!))).toBe('Retry');

    // The queue moves on: the first invite's grant is written, as if no second had been tried.
    await act(async () => {
      finishCoderGrant();
      await settle();
    });
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(2);
    expectGrant(mx, room, helper, 50);
    expect(getGrantAlerts(renderer)).toHaveLength(0);
  });

  it('gives no rights to an agent invited again with the checkbox cleared, while the first invite’s grant still waits behind another', async () => {
    const helper = '@mindroom_helper:example.org';
    const { renderer, mx, room } = renderPrompt();

    // Coder's grant is being written and stays unanswered; Helper's waits behind it.
    let finishCoderGrant: () => void = () => undefined;
    vi.mocked(mx.sendStateEvent).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCoderGrant = () => resolve({ event_id: '$power_levels' });
        })
    );
    await clickRowInvite(renderer, 'Coder');
    await clickRowInvite(renderer, 'Helper');
    expect(mx.invite).toHaveBeenCalledTimes(2);
    expect(mx.getStateEvent).toHaveBeenCalledTimes(1);
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expectGrant(mx, room, '@mindroom_coder:example.org', 50);

    // Helper declines, and is invited again without the rights.
    emitMembership(mx, room, helper, 'invite');
    emitMembership(mx, room, helper, 'leave');
    act(() => {
      findModeratorCheckbox(renderer)!.props.onClick();
    });
    expect(findModeratorCheckbox(renderer)!.props.checked).toBe(false);
    await clickRowInvite(renderer, 'Helper');
    expect(mx.invite).toHaveBeenCalledTimes(3);
    expect(mx.invite).toHaveBeenLastCalledWith(room.roomId, helper, undefined);

    // The queue moves on: the first invite's grant reads and writes nothing, and says nothing.
    await act(async () => {
      finishCoderGrant();
      await settle();
    });
    expect(mx.getStateEvent).toHaveBeenCalledTimes(1);
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(mx.sendStateEvent).not.toHaveBeenCalledWith(
      room.roomId,
      'm.room.power_levels',
      expect.objectContaining({ users: expect.objectContaining({ [helper]: expect.anything() }) }),
      ''
    );
    expect(getGrantAlerts(renderer)).toHaveLength(0);
    expect(extractText(getRowActionButton(getRowByText(renderer, 'Helper')!))).toBe('Invited');
  });

  it('shows the row as Invited and announces it as soon as the invite call returns, before the grant settles', async () => {
    const helper = '@mindroom_helper:example.org';
    const { renderer, mx, room } = renderPrompt();
    const failGrant = holdNextGrant(mx);
    const finishInvite = holdNextInvite(mx);
    await clickRowInvite(renderer, 'Helper');

    const action = () => getRowActionButton(getRowByText(renderer, 'Helper')!);
    expect(extractText(action())).toBe('Invite');
    expect(action().props['aria-disabled']).toBe(true);
    expect(textContentByRole(renderer, 'status')).toBe('');
    expect(mx.sendStateEvent).not.toHaveBeenCalled();

    // The invite call returns; the grant is being written and stays unanswered.
    await finishInvite();
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(extractText(action())).toBe('Invited');
    expect(textContentByRole(renderer, 'status')).toBe(`Invited ${helper}.`);
    expect(getGrantAlerts(renderer)).toHaveLength(0);

    await failGrant(new Error('Forbidden'));
    expect(extractText(action())).toBe('Invited');
    expect(textContentByRole(renderer, 'status')).toBe(`Invited ${helper}.`);
    expect(textContentByRole(renderer, 'alert')).toBe(
      `Invited ${helper}, but could not give Moderator rights: Forbidden`
    );
    expectGrant(mx, room, helper, 50);
  });

  // An agent of this homeserver that no directory lists: its row exists only while it is invited.
  const UNLISTED_AGENT = '@mindroom_scout:example.org';

  describe.each([
    { agent: '@mindroom_helper:example.org', listed: true, start: 'click' },
    { agent: '@mindroom_helper:example.org', listed: true, start: 'Enter' },
    { agent: UNLISTED_AGENT, listed: false, start: 'Enter' },
  ] as const)('a failed grant for $agent invited by $start', ({ agent, listed, start }) => {
    const warning = `Invited ${agent}, but could not give Moderator rights: Forbidden`;
    const rowName = listed ? 'Helper' : agent;

    const startInvite = async (renderer: ReactTestRenderer) => {
      if (start === 'click') {
        await clickRowInvite(renderer, rowName);
      } else {
        typeSearch(renderer, agent);
        await pressKeyInSearch(renderer, 'Enter');
      }
    };

    /** The agent left: the sheet's alert is still there, and the agent can be invited again. */
    const expectAlertAndNewInvite = async (
      renderer: ReactTestRenderer,
      mx: ReturnType<typeof makeMx>,
      room: ReturnType<typeof makeRoom>
    ) => {
      expect(getGrantAlerts(renderer).map(extractText)).toEqual([warning]);
      expect(textContentByRole(renderer, 'alert')).toBe(warning);
      const row = getRowByText(renderer, rowName);
      if (listed) {
        // No row holds the warning; the agent's own row offers the invite.
        expect(extractText(row!)).not.toContain('Forbidden');
        expect(extractText(getRowActionButton(row!))).toBe('Invite');
        expect(getRowActionButton(row!).props['aria-disabled']).toBe(false);
      } else {
        expect(row).toBeUndefined();
      }

      await startInvite(renderer);
      expect(mx.invite).toHaveBeenCalledTimes(2);
      expect(mx.invite).toHaveBeenLastCalledWith(room.roomId, agent, undefined);
      expect(extractText(getRowActionButton(getRowByText(renderer, rowName)!))).toBe('Invited');
      // The new invite's grant went through; the alert about the first stays until dismissed.
      expect(mx.sendStateEvent).toHaveBeenCalledTimes(2);
      expect(getGrantAlerts(renderer).map(extractText)).toEqual([warning]);
    };

    it('keeps the alert in the sheet and takes a new invite when the agent declines after the grant failed', async () => {
      const { renderer, mx, room } = renderPrompt();
      vi.mocked(mx.sendStateEvent).mockRejectedValueOnce(new Error('Forbidden'));
      await startInvite(renderer);
      expect(extractText(getRowActionButton(getRowByText(renderer, rowName)!))).toBe('Invited');
      expect(getGrantAlerts(renderer).map(extractText)).toEqual([warning]);

      emitMembership(mx, room, agent, 'invite');
      emitMembership(mx, room, agent, 'leave');
      await expectAlertAndNewInvite(renderer, mx, room);
    });

    it('shows the alert in the sheet and takes a new invite when the agent declines while the grant is on its way', async () => {
      const { renderer, mx, room } = renderPrompt();
      const failGrant = holdNextGrant(mx);
      await startInvite(renderer);
      // The invite is out and announced; the grant is still being written.
      expect(mx.invite).toHaveBeenCalledTimes(1);
      expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
      expect(extractText(getRowActionButton(getRowByText(renderer, rowName)!))).toBe('Invited');
      expect(textContentByRole(renderer, 'status')).toBe(`Invited ${agent}.`);

      emitMembership(mx, room, agent, 'invite');
      emitMembership(mx, room, agent, 'leave');
      // The row is gone or offers the invite again, and nothing told of the grant yet.
      expect(getGrantAlerts(renderer)).toHaveLength(0);

      await failGrant(new Error('Forbidden'));
      await expectAlertAndNewInvite(renderer, mx, room);
    });
  });

  it('keeps a grant alert in the sheet across filters and searches until it is dismissed, and leaves the sent invite behind', async () => {
    const warning =
      'Invited @mindroom_helper:example.org, but could not give Moderator rights: Forbidden';
    const { renderer, mx } = renderPrompt();
    const failGrant = holdNextGrant(mx);
    await clickRowInvite(renderer, 'Helper');

    // Another filter, then a search, while the grant is still on its way: the row stays behind.
    act(() => {
      getFilterButton(renderer, 'People').props.onClick();
    });
    typeSearch(renderer, 'liam');
    expect(getRowByText(renderer, 'Helper')).toBeUndefined();

    await failGrant(new Error('Forbidden'));
    expect(getGrantAlerts(renderer).map(extractText)).toEqual([warning]);
    expect(getRowByText(renderer, 'Helper')).toBeUndefined();
    expect(getRowByText(renderer, 'Liam Park')).toBeDefined();

    typeSearch(renderer, '');
    act(() => {
      getFilterButton(renderer, 'Agents').props.onClick();
    });
    expect(getGrantAlerts(renderer).map(extractText)).toEqual([warning]);

    // The strip scrolls, so the keyboard can focus it, as a region its own text names.
    const strip = renderer.root.find(
      (node) => node.type === 'div' && node.props.className === 'InviteGrantAlerts'
    );
    expect(strip.props.tabIndex).toBe(0);
    expect(strip.props.role).toBe('region');
    expect(strip.props.id).toEqual(expect.any(String));
    expect(strip.props['aria-labelledby']).toBe(strip.props.id);

    // The strip sits between the controls and the rows.
    const body = renderer.root.find(
      (node) => node.type === 'div' && node.props.className === 'InviteBody'
    );
    expect(
      body.children
        .filter((child): child is ReactTestInstance => typeof child !== 'string')
        .map((child) => child.props.className)
    ).toEqual(['InviteControls', 'InviteGrantAlerts', 'InviteListArea', 'InviteFooter']);

    const dismiss = getGrantAlerts(renderer)[0]!.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Dismiss notice'
    );
    act(() => {
      dismiss.props.onClick();
    });
    expect(getGrantAlerts(renderer)).toHaveLength(0);
    expect(textContentByRole(renderer, 'alert')).toBe('');
  });

  it('clears the hint that asks for a valid ID when the filter changes', async () => {
    const { renderer } = renderPrompt();
    act(() => {
      getFilterButton(renderer, 'Agents').props.onClick();
    });
    typeSearch(renderer, '@maya');
    await pressKeyInSearch(renderer, 'Enter');
    expect(extractText(getDialog(renderer))).toContain('Please enter a valid User ID.');

    act(() => {
      getFilterButton(renderer, 'People').props.onClick();
    });
    expect(getRowByText(renderer, 'Maya Chen')).toBeDefined();
    expect(extractText(getDialog(renderer))).not.toContain('Please enter a valid User ID.');
  });

  it('says that the directory failed to load and loads it again on Retry', async () => {
    const { renderer, mx } = renderPrompt({ cache: readyCache([], 'error') });
    const retryButton = () =>
      renderer.root.findAll((node) => node.type === 'button' && extractText(node) === 'Retry');
    expect(mx.searchUserDirectory).not.toHaveBeenCalled();
    expect(textContentByRole(renderer, 'alert')).toBe('Something went wrong. Try again.');
    expect(extractText(getDialog(renderer))).not.toContain('No users to invite yet');
    expect(retryButton()).toHaveLength(1);

    // A search is the search's own business: the directory's failure shows while browsing only.
    typeSearch(renderer, 'maya');
    expect(retryButton()).toHaveLength(0);
    typeSearch(renderer, '');

    vi.mocked(mx.searchUserDirectory).mockResolvedValueOnce({
      limited: false,
      results: [{ user_id: '@nora:example.org', display_name: 'Nora Quinn' }],
    });
    await act(async () => {
      retryButton()[0]!.props.onClick();
      await settle();
    });
    expect(mx.searchUserDirectory).toHaveBeenCalledWith(expect.objectContaining({ term: '@' }));
    expect(getRowByText(renderer, 'Nora Quinn')).toBeDefined();
    expect(retryButton()).toHaveLength(0);
    expect(textContentByRole(renderer, 'alert')).toBe('');
  });

  it('offers Retry above the rows it loaded before when the directory fails to load again, also when none of them is left to invite', async () => {
    const retryButton = () =>
      renderer.root.findAll((node) => node.type === 'button' && extractText(node) === 'Retry');
    const { renderer, mx } = renderPrompt({ cache: readyCache(defaultCacheUsers(), 'error') });
    expect(getRows(renderer)).toHaveLength(4);
    expect(textContentByRole(renderer, 'alert')).toBe('Something went wrong. Try again.');
    expect(retryButton()).toHaveLength(1);
    // The failure stands before the rows, not below the last of them.
    const listArea = renderer.root.find(
      (node) => node.type === 'div' && node.props.className === 'InviteListArea'
    );
    const parts = listArea.findAll(
      (node) =>
        typeof node.type === 'string' &&
        ['InviteDirectoryError', 'InviteList'].includes(String(node.props.className))
    );
    expect(parts[0]!.props.className).toBe('InviteDirectoryError');
    expect(parts.length).toBeGreaterThan(1);

    // While searching, the search speaks for itself.
    typeSearch(renderer, 'maya');
    expect(retryButton()).toHaveLength(0);
    typeSearch(renderer, '');

    vi.mocked(mx.searchUserDirectory).mockResolvedValueOnce({
      limited: false,
      results: [{ user_id: '@nora:example.org', display_name: 'Nora Quinn' }],
    });
    await act(async () => {
      retryButton()[0]!.props.onClick();
      await settle();
    });
    expect(mx.searchUserDirectory).toHaveBeenCalledWith(expect.objectContaining({ term: '@' }));
    expect(getRowByText(renderer, 'Nora Quinn')).toBeDefined();
    expect(retryButton()).toHaveLength(0);
    expect(textContentByRole(renderer, 'alert')).toBe('');

    // Everyone the directory had is in the room already: no row, and still the way to retry.
    const everyone = renderPrompt({
      cache: readyCache(defaultCacheUsers(), 'error'),
      members: defaultCacheUsers().map(({ userId }) => ({ userId, membership: 'join' })),
    });
    expect(getRows(everyone.renderer)).toHaveLength(0);
    expect(textContentByRole(everyone.renderer, 'alert')).toBe('Something went wrong. Try again.');
    expect(extractText(getDialog(everyone.renderer))).not.toContain('No users to invite yet');
  });

  it('scrolls the focused field into view when the body, which scrolls what does not fit, changes its size', () => {
    const observers: { run: () => void; observed: unknown[]; connected: boolean }[] = [];
    class FakeResizeObserver {
      private readonly entry: (typeof observers)[number];

      constructor(callback: () => void) {
        this.entry = { run: callback, observed: [], connected: true };
        observers.push(this.entry);
      }

      observe(target: unknown) {
        this.entry.observed.push(target);
      }

      disconnect() {
        this.entry.connected = false;
      }
    }
    const field = { tagName: 'INPUT', scrollIntoView: vi.fn() };
    const button = { tagName: 'BUTTON', scrollIntoView: vi.fn() };
    const page = { activeElement: field as unknown };
    const body = { contains: (node: unknown) => node === field || node === button };
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('document', page);
    bodyNode = body;

    try {
      const { renderer } = renderPrompt();
      expect(observers).toHaveLength(1);
      const observer = observers[0]!;
      expect(observer.observed).toEqual([body]);

      // The keyboard comes up: the field goes to the nearest place in sight, which is where it
      // is if it is in sight already.
      observer.run();
      expect(field.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(field.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

      // Only a field someone types in is followed, and only one of the sheet.
      page.activeElement = button;
      observer.run();
      expect(button.scrollIntoView).not.toHaveBeenCalled();
      bodyNode = null;
      page.activeElement = { tagName: 'INPUT', scrollIntoView: field.scrollIntoView };
      observer.run();
      expect(field.scrollIntoView).toHaveBeenCalledTimes(1);

      act(() => {
        renderer.unmount();
      });
      expect(observer.connected).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('drops a user invited here from the search before it limits its results to eight, once the room has the invite', async () => {
    const people: ServerUserDirectoryUser[] = [
      { userId: '@alpha:example.org', displayName: 'Alpha' },
      ...Array.from({ length: 8 }, (_, index) => ({
        userId: `@alpha_${index}:example.org`,
        displayName: `Alpha Person ${index}`,
      })),
    ];
    const { renderer, mx, room } = renderPrompt({ cache: readyCache(people) });

    typeSearch(renderer, 'alpha');
    expect(getRows(renderer)).toHaveLength(8);
    expect(getRowByText(renderer, '@alpha:example.org')).toBeDefined();

    // Invited from the directory; /sync brings the invite.
    typeSearch(renderer, '');
    await clickRowInvite(renderer, '@alpha:example.org');
    emitMembership(mx, room, '@alpha:example.org', 'invite');

    typeSearch(renderer, 'alpha');
    expect(getRowByText(renderer, '@alpha:example.org')).toBeUndefined();
    const shown = getRows(renderer).map(extractText);
    expect(shown).toHaveLength(8);
    for (let index = 0; index < 8; index += 1) {
      expect(shown.some((text) => text.includes(`Alpha Person ${index}`))).toBe(true);
    }
  });

  it('wraps an unlisted Matrix ID whole instead of truncating it, also on its Retry row', async () => {
    const longId = `@${'someone.with.a.very.long.localpart'.repeat(2)}:matrix.example.org`;
    const { renderer, mx } = renderPrompt();
    const nameOf = (row: ReactTestInstance) =>
      row
        .find((node) => node.type === 'div' && node.props.className === 'InviteNameLine')
        .find((node) => node.type === 'span' && typeof node.props.title === 'string');

    const listedName = nameOf(getRowByText(renderer, 'Maya Chen')!);
    const truncating = String(listedName.props.className)
      .split(' ')
      .filter((name) => name.length > 0);
    expect(truncating).not.toContain('InviteNameWrap');

    typeSearch(renderer, longId);
    const unlistedName = nameOf(getRowByText(renderer, 'External Matrix ID')!);
    expect(extractText(unlistedName)).toBe(longId);
    const wrapping = String(unlistedName.props.className).split(' ');
    expect(wrapping).toContain('InviteNameWrap');
    // The listed name carries folds' truncating class; the unlisted one must not.
    const truncateOnly = truncating.filter((name) => !wrapping.includes(name));
    expect(truncateOnly.length).toBeGreaterThan(0);

    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Network down'));
    await pressKeyInSearch(renderer, 'Enter');
    const retryRow = getRowByText(renderer, longId)!;
    expect(extractText(getRowActionButton(retryRow))).toBe('Retry');
    expect(String(nameOf(retryRow).props.className).split(' ')).toContain('InviteNameWrap');
  });

  it('isolates the room name once in Arabic, whose catalog isolates the placeholder itself', async () => {
    const template = arAdditions.sharedUi.inviteUserPrompt.inviteToRoom;
    expect(template).toContain('\u2068{{room}}\u2069');
    i18next.addResourceBundle('ar', 'translation', arAdditions, true, true);
    await act(async () => {
      await i18next.changeLanguage('ar');
    });
    try {
      const { renderer } = renderPrompt({ name: 'Design Review' });
      const heading = extractText(renderer.root.findByProps({ id: 'invite-user-prompt-title' }));
      expect(heading).toBe(template.replace('{{room}}', 'Design Review'));
      expect(heading.split('\u2068')).toHaveLength(2);
      expect(heading.split('\u2069')).toHaveLength(2);

      // A "$" in the name is no replacement pattern.
      const budget = renderPrompt({ name: 'Budget $$' });
      expect(
        extractText(budget.renderer.root.findByProps({ id: 'invite-user-prompt-title' }))
      ).toBe(template.replace('{{room}}', () => 'Budget $$'));
    } finally {
      await act(async () => {
        await i18next.changeLanguage('en');
      });
      i18next.removeResourceBundle('ar', 'translation');
    }
  });

  it('shows direction controls in the room name as code points inside one isolate, and keeps a "$" as written', async () => {
    // A right-to-left override, and an isolate's end that would close the heading's own early.
    const hostile = renderPrompt({ name: 'Plans \u202Efdp.exe\u2069 $$' });
    expect(getHeading(hostile.renderer)).toBe(
      'Invite to \u2068Plans <U+202E>fdp.exe<U+2069> $$\u2069'
    );
    expect(getHeading(renderPrompt({ name: 'Budget $$' }).renderer)).toBe(
      'Invite to \u2068Budget $$\u2069'
    );
    // A name of controls alone is still a name.
    expect(getHeading(renderPrompt({ name: '\u202E' }).renderer)).toBe(
      'Invite to \u2068<U+202E>\u2069'
    );

    const template = arAdditions.sharedUi.inviteUserPrompt.inviteToRoom;
    i18next.addResourceBundle('ar', 'translation', arAdditions, true, true);
    await act(async () => {
      await i18next.changeLanguage('ar');
    });
    try {
      const heading = getHeading(renderPrompt({ name: 'Plans \u202Efdp.exe\u2069 $$' }).renderer);
      expect(heading).toBe(template.replace('{{room}}', () => 'Plans <U+202E>fdp.exe<U+2069> $$'));
      expect(heading).not.toMatch(/[\u202A-\u202E]/);
      expect(heading.split('\u2068')).toHaveLength(2);
      expect(heading.split('\u2069')).toHaveLength(2);
    } finally {
      await act(async () => {
        await i18next.changeLanguage('en');
      });
      i18next.removeResourceBundle('ar', 'translation');
    }
  });

  it('follows a rename of the room in the heading while the sheet is open', () => {
    const { renderer, room } = renderPrompt({ name: 'Design Review' });
    const heading = () =>
      extractText(renderer.root.findByProps({ id: 'invite-user-prompt-title' }));
    expect(heading()).toBe('Invite to \u2068Design Review\u2069');

    act(() => {
      room.name = 'Design Critique';
      room.emit('Room.name', room);
    });
    expect(heading()).toBe('Invite to \u2068Design Critique\u2069');
  });

  it('says the inline hint in a status region, and asks for a valid ID on Enter only when the text is no search with matches', async () => {
    const { renderer, mx } = renderPrompt({
      members: [{ userId: '@joined:example.org', membership: 'join' }],
    });
    const hintRegion = () =>
      renderer.root.find((node) => node.type === 'div' && node.props.className === 'InviteListArea')
        .children[0] as ReactTestInstance;
    expect(hintRegion().props.role).toBe('status');
    expect(extractText(hintRegion())).toBe('');

    typeSearch(renderer, '@joined:example.org');
    expect(extractText(hintRegion())).toBe('Already in this room');

    // Plain text that finds people is a search: Enter says nothing.
    typeSearch(renderer, 'maya');
    expect(getRowByText(renderer, 'Maya Chen')).toBeDefined();
    const preventDefault = await pressKeyInSearch(renderer, 'Enter');
    expect(preventDefault).not.toHaveBeenCalled();
    expect(extractText(hintRegion())).toBe('');

    // An unfinished ID is a mistake, also while it lists matches.
    typeSearch(renderer, '@maya');
    expect(getRowByText(renderer, 'Maya Chen')).toBeDefined();
    await pressKeyInSearch(renderer, 'Enter');
    expect(extractText(hintRegion())).toBe('Please enter a valid User ID.');

    // Text without a match is no mistake while the homeserver is still asked for one.
    typeSearch(renderer, 'qqqqzzzz');
    expect(extractText(hintRegion())).toBe('');
    expect(getRows(renderer)).toHaveLength(0);
    await pressKeyInSearch(renderer, 'Enter');
    expect(extractText(hintRegion())).toBe('');

    await waitForServerSearch();
    expect(getRows(renderer)).toHaveLength(0);
    await pressKeyInSearch(renderer, 'Enter');
    expect(extractText(hintRegion())).toBe('Please enter a valid User ID.');
    expect(mx.invite).not.toHaveBeenCalled();
  });

  it('announces every invite that finishes, two at once included, also one whose grant fails', async () => {
    const { renderer, mx } = renderPrompt();
    const announcementRegion = () =>
      renderer.root.find(
        (node) => node.type === 'div' && node.props.className === 'InviteVisuallyHidden'
      );
    const lines = () => announcementRegion().findAllByType('p').map(extractText);
    expect(announcementRegion().props.role).toBe('status');
    expect(announcementRegion().props['aria-atomic']).toBe('false');

    let finishMaya: () => void = () => undefined;
    let finishLiam: () => void = () => undefined;
    vi.mocked(mx.invite)
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishMaya = () => resolve({} as never)))
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishLiam = () => resolve({} as never)))
      );
    await clickRowInvite(renderer, 'Maya Chen');
    await clickRowInvite(renderer, 'Liam Park');
    expect(lines()).toEqual([]);

    await act(async () => {
      finishMaya();
      finishLiam();
      await settle();
    });
    expect(lines()).toEqual(['Invited @maya:example.org.', 'Invited @liam:example.org.']);

    vi.mocked(mx.sendStateEvent).mockRejectedValueOnce(new Error('Forbidden'));
    await clickRowInvite(renderer, 'Helper');
    expect(textContentByRole(renderer, 'alert')).toContain('Invited @mindroom_helper:example.org');
    expect(lines()).toEqual([
      'Invited @maya:example.org.',
      'Invited @liam:example.org.',
      'Invited @mindroom_helper:example.org.',
    ]);

    await clickRowInvite(renderer, 'Coder');
    expect(lines()).toEqual([
      'Invited @maya:example.org.',
      'Invited @liam:example.org.',
      'Invited @mindroom_helper:example.org.',
      'Invited @mindroom_coder:example.org.',
    ]);
  });

  it('pins rows invited with Enter newest first, in a named list, and keeps that order across filters', async () => {
    const { renderer, mx } = renderPrompt();
    vi.mocked(mx.invite).mockRejectedValue(new Error('Network down'));
    const pinnedIds = () =>
      getRows(renderer)
        .slice(0, 3)
        .map((row) => extractText(row).match(/@\w+:other\.org/)?.[0]);

    for (const userId of ['@first:other.org', '@second:other.org', '@third:other.org']) {
      typeSearch(renderer, userId);
      await pressKeyInSearch(renderer, 'Enter');
    }
    expect(pinnedIds()).toEqual(['@third:other.org', '@second:other.org', '@first:other.org']);

    const lists = renderer.root.findAll(
      (node) => node.type === 'ul' && node.props.className === 'InviteList'
    );
    expect(lists[0]!.props['aria-label']).toBe('Invite');
    // Stated, since Safari's VoiceOver drops the role of a list without markers.
    expect(lists.map((list) => list.props.role)).toEqual(lists.map(() => 'list'));
    expect(lists[0]!.findAllByType('li')).toHaveLength(3);
    // The sections below take their names from their headings.
    lists.slice(1).forEach((list) => {
      expect(list.props['aria-label']).toBeUndefined();
      expect(list.props['aria-labelledby']).toEqual(expect.any(String));
    });

    act(() => {
      getFilterButton(renderer, 'People').props.onClick();
    });
    expect(pinnedIds()).toEqual(['@third:other.org', '@second:other.org', '@first:other.org']);

    act(() => {
      getFilterButton(renderer, 'All').props.onClick();
    });
    expect(pinnedIds()).toEqual(['@third:other.org', '@second:other.org', '@first:other.org']);
  });

  it('shows queued detached grant failures one at a time, the next when one is dismissed', () => {
    const coderFailure =
      'Invited @mindroom_coder:example.org, but could not give Moderator rights: Forbidden';
    const helperFailure =
      'Invited @mindroom_helper:example.org, but could not give Moderator rights: Forbidden';
    const store = createStore();
    store.set(detachedGrantErrorAtom, [
      createDetachedGrantError(coderFailure),
      createDetachedGrantError(helperFailure),
    ]);
    let notice: ReactTestRenderer;
    act(() => {
      notice = create(
        <Provider store={store}>
          <ModeratorGrantErrorNotice />
        </Provider>
      );
    });
    const findAlerts = () =>
      notice!.root.findAll((node) => typeof node.type === 'string' && node.props.role === 'alert');
    const findDismissButtons = () =>
      notice!.root.findAll(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Dismiss notice'
      );
    expect(findAlerts().map(extractText)).toEqual([coderFailure]);
    expect(findDismissButtons()).toHaveLength(1);
    // The message scrolls past three lines, so the keyboard can focus it, as a named region.
    const message = findAlerts()[0]!.find(
      (node) => typeof node.type === 'string' && node.props.tabIndex === 0
    );
    expect(extractText(message)).toBe(coderFailure);
    expect(message.props.role).toBe('region');
    expect(message.props['aria-labelledby']).toBe(message.props.id);
    expect(message.props.id).toEqual(expect.any(String));
    const mountsBefore = iconButtonMounts.count;

    act(() => {
      findDismissButtons()[0]!.props.onClick();
    });
    expect(store.get(detachedGrantErrorAtom)).toHaveLength(1);
    expect(findAlerts().map(extractText)).toEqual([helperFailure]);
    expect(findDismissButtons()).toHaveLength(1);
    // The card stays, and with it the Dismiss button that had the focus: nothing mounted anew.
    expect(iconButtonMounts.count).toBe(mountsBefore);

    act(() => {
      findDismissButtons()[0]!.props.onClick();
    });
    expect(store.get(detachedGrantErrorAtom)).toEqual([]);
    expect(notice!.toJSON()).toBeNull();
  });
});
