import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';

import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import {
  userDirectoryCacheAtom,
  type ServerUserDirectoryUser,
  type UserDirectoryCacheState,
} from '../userDirectoryCache';
import {
  createDetachedGrantError,
  detachedGrantErrorAtom,
  evaluateRoomModeratorGrant,
  grantRoomModeratorRights,
} from './moderatorInvite';
import { ModeratorGrantErrorNotice } from './ModeratorGrantErrorNotice';
import { InviteUserPrompt } from './InviteUserPrompt';

const directUsersMock = vi.hoisted(() => ({
  users: [] as string[],
}));

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  const Wrapper = ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement('div', { className }, children);

  return {
    ...actual,
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
  PhoneViewportCenter: 'PhoneViewportCenter',
  Dialog: 'InviteDialog',
  TitleBar: 'InviteTitleBar',
  TitleBlock: 'InviteTitleBlock',
  Controls: 'InviteControls',
  SearchField: 'InviteSearchField',
  FilterRow: 'InviteFilterRow',
  FilterChip: 'InviteFilterChip',
  ListArea: 'InviteListArea',
  SectionHeader: 'InviteSectionHeader',
  List: 'InviteList',
  Row: 'InviteRow',
  AvatarWrap: 'InviteAvatarWrap',
  Identity: 'InviteIdentity',
  NameLine: 'InviteNameLine',
  AgentBadge: 'InviteAgentBadge',
  Subtitle: 'InviteSubtitle',
  RowError: 'InviteRowError',
  RowAction: 'InviteRowAction',
  RowActionSent: 'InviteRowActionSent',
  InlineHint: 'InviteInlineHint',
  EmptyState: 'InviteEmptyState',
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
  | 'setPowerLevel'
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

type RoomOptions = {
  name?: string;
  isSpace?: boolean;
  roomVersion?: string;
  powerLevels?: Record<string, unknown>;
  powerLevelTags?: Record<string, unknown>;
  createContent?: Record<string, unknown>;
  createSender?: string;
  members?: { userId: string; membership: string }[];
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
    setPowerLevel: vi.fn(async () => undefined) as unknown as MockMatrixClient['setPowerLevel'],
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
    members: [...(options.members ?? [])],
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
    getMember: (userId: string) => state.members.find((member) => member.userId === userId) ?? null,
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
const rowFocusElements: Array<{ focus: ReturnType<typeof vi.fn> }> = [];

type RenderOptions = RoomOptions & {
  screenSize?: ScreenSize;
  cache?: UserDirectoryCacheState;
  requestClose?: () => void;
};

const renderPrompt = (options: RenderOptions = {}) => {
  let roomRef: ReturnType<typeof makeRoom> | null = null;
  const mx = makeMx((roomId) =>
    roomRef && roomRef.roomId === roomId ? (roomRef as unknown as Room) : null
  );
  const room = makeRoom(mx, options);
  roomRef = room;
  const store = createStore();
  store.set(userDirectoryCacheAtom, options.cache ?? readyCache());
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
    .join(' ');

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
    await Promise.resolve();
    await Promise.resolve();
  });
  return preventDefault;
};

const clickRowInvite = async (renderer: ReactTestRenderer, needle: string) => {
  const row = getRowByText(renderer, needle);
  expect(row, `expected row containing ${needle}`).toBeDefined();
  await act(async () => {
    getRowActionButton(row!).props.onClick?.();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
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
    const room = makeRoom(mx);

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
});

describe('InviteUserPrompt (Option A — Instant Directory Sheet)', () => {
  it('uses desktop dialog framing by default and PhoneModal + PhoneViewportCenter framing on mobile', () => {
    const desktop = renderPrompt({ screenSize: ScreenSize.Desktop });
    expect(getDialog(desktop.renderer).props['aria-modal']).toBe('true');
    expect(getDialog(desktop.renderer).props.className).toContain('InviteDialog');
    expect(getDialog(desktop.renderer).props.className).not.toContain('PhoneModal');
    expect(desktop.renderer.root.findByProps({ 'data-overlay-center': true }).props.className).toBe(
      'SafeOverlayCenter'
    );

    const mobile = renderPrompt({ screenSize: ScreenSize.Mobile });
    expect(getDialog(mobile.renderer).props.className).toContain('PhoneModal');
    const mobileCenterClass = mobile.renderer.root.findByProps({
      'data-overlay-center': true,
    }).props.className;
    expect(mobileCenterClass).toContain('PhoneOverlayCenter');
    expect(mobileCenterClass).toContain('PhoneViewportCenter');
  });

  it('shows isolated room title, Done button, and live member/invited counts without double-counting or resurrection', async () => {
    const requestClose = vi.fn();
    const { renderer, mx, room } = renderPrompt({
      name: 'Design Review',
      joinedCount: 2,
      invitedCount: 0,
      requestClose,
    });

    const heading = renderer.root.findByProps({ id: 'invite-user-prompt-title' });
    expect(extractText(heading)).toBe('Invite to \u2068Design Review\u2069');
    expect(extractText(getDialog(renderer))).toContain('2 Members');
    expect(extractText(getDialog(renderer))).not.toContain('Invited');

    // Invite Maya: subtitle immediately reflects 1 Invited before sync arrives.
    await clickRowInvite(renderer, 'Maya Chen');
    expect(extractText(getDialog(renderer))).toContain('2 Members · 1 Invited');

    // Matrix sync arrives with Maya as invited and room invitedCount updated to 1: must NOT become 2!
    act(() => {
      room.state.members.push({ userId: '@maya:example.org', membership: 'invite' });
      room.state.invitedCount = 1;
      mx.emit('RoomMember.membership', undefined, {
        roomId: room.roomId,
        userId: '@maya:example.org',
      });
    });
    expect(extractText(getDialog(renderer))).toContain('2 Members · 1 Invited');
    expect(extractText(getDialog(renderer))).not.toContain('2 Invited');

    // Maya declines/leaves: header count must drop back to 0 (no optimistic resurrection!).
    act(() => {
      room.state.members = [{ userId: '@maya:example.org', membership: 'leave' }];
      room.state.invitedCount = 0;
      mx.emit('RoomMember.membership', undefined, {
        roomId: room.roomId,
        userId: '@maya:example.org',
      });
    });
    expect(extractText(getDialog(renderer))).toContain('2 Members');
    expect(extractText(getDialog(renderer))).not.toContain('1 Invited');

    // Room.summary updates header count live as well.
    act(() => {
      room.state.joinedCount = 5;
      room.emit('Room.Summary', {});
    });
    expect(extractText(getDialog(renderer))).toContain('5 Members');

    // Clicking Done calls requestClose.
    const doneBtn = renderer.root.find(
      (node) => node.type === 'button' && extractText(node) === 'Done'
    );
    act(() => {
      doneBtn.props.onClick();
    });
    expect(requestClose).toHaveBeenCalledTimes(1);
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
    expect(mx.setPowerLevel).not.toHaveBeenCalled();

    // Also verify button click on another listed agent while checkbox is OFF skips grant.
    typeSearch(renderer, '@mindroom_helper:example.org');
    await clickRowInvite(renderer, 'Helper');
    expect(mx.invite).toHaveBeenCalledWith(
      '!room:example.org',
      '@mindroom_helper:example.org',
      undefined
    );
    expect(mx.setPowerLevel).not.toHaveBeenCalled();
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

  it('prevents inviting the same user twice across filter changes before /sync arrives', async () => {
    const { renderer, mx } = renderPrompt();
    await clickRowInvite(renderer, 'Maya Chen');
    expect(mx.invite).toHaveBeenCalledTimes(1);

    // Switch filter before Matrix sync adds Maya to room.state.members.
    act(() => {
      getFilterButton(renderer, 'People').props.onClick();
    });
    expect(getRowByText(renderer, 'Maya Chen')).toBeUndefined();

    // Typing Maya's MXID shows Already invited and Enter does not fire a duplicate invite.
    typeSearch(renderer, '@maya:example.org');
    expect(extractText(getDialog(renderer))).toContain('Already invited');
    await pressKeyInSearch(renderer, 'Enter');
    expect(mx.invite).toHaveBeenCalledTimes(1);
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

    typeSearch(renderer, 'not-a-matrix-id');
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
    expect(mx.setPowerLevel).not.toHaveBeenCalled();
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
    act(() => {
      room.state.members.push({ userId: '@maya:example.org', membership: 'invite' });
      mx.emit('RoomMember.membership', undefined, {
        roomId: room.roomId,
        userId: '@maya:example.org',
      });
    });
    const sentRow = getRowByText(renderer, 'Maya Chen')!;
    expect(extractText(getRowActionButton(sentRow))).toBe('Invited');
    expect(getRowActionButton(sentRow).props['aria-disabled']).toBe(true);
  });

  it('drops a failed attempt automatically if the user joins or gets invited externally', async () => {
    const { renderer, mx, room } = renderPrompt();
    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Temporary failure'));
    await clickRowInvite(renderer, 'Maya Chen');
    expect(textContentByRole(renderer, 'alert')).toContain('Temporary failure');

    act(() => {
      room.state.members.push({ userId: '@maya:example.org', membership: 'join' });
      mx.emit('RoomMember.membership', undefined, {
        roomId: room.roomId,
        userId: '@maya:example.org',
      });
    });
    expect(getRowByText(renderer, 'Maya Chen')).toBeUndefined();
    expect(textContentByRole(renderer, 'alert')).toBe('');
  });

  it('handles invite note lifecycle: clears after success, does not send when collapsed, Retry preserves original note, and never erases a newer draft', async () => {
    const { renderer, mx, room } = renderPrompt();
    const getNoteToggle = () =>
      renderer.root.find(
        (node) => node.type === 'button' && node.props['aria-expanded'] !== undefined
      );
    const getNoteInput = () =>
      renderer.root.find(
        (node) => node.type === 'input' && node.props.placeholder === 'Add a note to your invite...'
      );

    expect(getNoteToggle().props['aria-expanded']).toBe(false);
    expect(extractText(getNoteToggle())).toBe('+ Add invite note');

    // Expand note, type reason, invite Maya -> sends trimmed note and clears input afterward.
    act(() => {
      getNoteToggle().props.onClick();
    });
    expect(getNoteToggle().props['aria-expanded']).toBe(true);
    expect(extractText(getNoteToggle())).toBe('− Hide invite note');
    act(() => {
      getNoteInput().props.onChange({ target: { value: '  Welcome aboard!  ' } });
    });

    await clickRowInvite(renderer, 'Maya Chen');
    expect(mx.invite).toHaveBeenNthCalledWith(
      1,
      room.roomId,
      '@maya:example.org',
      'Welcome aboard!'
    );
    expect(getNoteInput().props.value).toBe('');

    // Second invite with empty note sends undefined.
    await clickRowInvite(renderer, 'Liam Park');
    expect(mx.invite).toHaveBeenNthCalledWith(2, room.roomId, '@liam:example.org', undefined);

    // Type a note, collapse the note field -> hidden note is NOT sent.
    act(() => {
      getNoteInput().props.onChange({ target: { value: 'Hidden secret note' } });
    });
    act(() => {
      getNoteToggle().props.onClick();
    });
    expect(getNoteToggle().props['aria-expanded']).toBe(false);
    typeSearch(renderer, '@alice:example.org');
    await pressKeyInSearch(renderer, 'Enter');
    expect(mx.invite).toHaveBeenNthCalledWith(3, room.roomId, '@alice:example.org', undefined);

    // Expand note again, fail invite to @bob:example.org with original note, then edit note;
    // Retry must send @bob's original note, not the edited draft.
    act(() => {
      getNoteToggle().props.onClick();
    });
    act(() => {
      getNoteInput().props.onChange({ target: { value: 'Note for Bob' } });
    });
    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Failed once'));
    typeSearch(renderer, '@bob:example.org');
    await pressKeyInSearch(renderer, 'Enter');
    expect(mx.invite).toHaveBeenNthCalledWith(4, room.roomId, '@bob:example.org', 'Note for Bob');

    act(() => {
      getNoteInput().props.onChange({ target: { value: 'Different draft for Carol' } });
    });
    await clickRowInvite(renderer, '@bob:example.org');
    expect(mx.invite).toHaveBeenNthCalledWith(5, room.roomId, '@bob:example.org', 'Note for Bob');
    expect(getNoteInput().props.value).toBe('Different draft for Carol');

    // Start an invite with current draft, edit draft while invite is in flight -> newer draft is preserved.
    let resolveCarol!: () => void;
    vi.mocked(mx.invite).mockImplementationOnce(
      () => new Promise((resolve) => (resolveCarol = () => resolve({} as never)))
    );
    typeSearch(renderer, '@carol:example.org');
    await pressKeyInSearch(renderer, 'Enter');
    act(() => {
      getNoteInput().props.onChange({ target: { value: 'Newer draft while in flight' } });
    });
    await act(async () => {
      resolveCarol();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getNoteInput().props.value).toBe('Newer draft while in flight');
  });

  it('defaults moderator rights ON for MindRoom agents when none holds moderator power, and invites before granting', async () => {
    const { renderer, mx, room } = renderPrompt();
    const calls: string[] = [];
    vi.mocked(mx.invite).mockImplementation(async () => {
      calls.push('invite');
      return {} as never;
    });
    vi.mocked(mx.setPowerLevel).mockImplementation(async () => {
      calls.push('setPowerLevel');
      return {} as never;
    });

    const checkbox = findModeratorCheckbox(renderer);
    expect(checkbox).toBeDefined();
    expect(checkbox?.props.checked).toBe(true);

    await clickRowInvite(renderer, 'Helper');

    expect(calls).toEqual(['invite', 'setPowerLevel']);
    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', undefined);
    expect(mx.setPowerLevel).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', 50);
  });

  it('never calls setPowerLevel for humans, owner account, foreign-server agents, or agents already at moderator power', async () => {
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
    expect(mx.setPowerLevel).not.toHaveBeenCalled();
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
    expect(mx.setPowerLevel).not.toHaveBeenCalled();
  });

  it('skips setPowerLevel when the user unchecks the moderator checkbox', async () => {
    const { renderer, mx, room } = renderPrompt();
    const checkbox = findModeratorCheckbox(renderer);
    expect(checkbox?.props.checked).toBe(true);
    act(() => {
      checkbox?.props.onClick();
    });
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(false);

    await clickRowInvite(renderer, 'Helper');

    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', undefined);
    expect(mx.setPowerLevel).not.toHaveBeenCalled();
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
    expect(mx.setPowerLevel).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', 75);
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
  ])('hides the moderator checkbox and skips member loading for $label', ({ options }) => {
    const { renderer, room } = renderPrompt({ membersLoaded: false, ...options });
    expect(findModeratorCheckbox(renderer)).toBeUndefined();
    expect(room.loadMembersIfNeeded).not.toHaveBeenCalled();
    expect(room.getMembers).not.toHaveBeenCalled();
  });

  it('keeps the invite (Invited button) and shows a non-blocking error when granting moderator rights fails', async () => {
    const { renderer, mx, room } = renderPrompt();
    vi.mocked(mx.setPowerLevel).mockRejectedValueOnce(new Error('Forbidden'));
    focusInput.mockClear();

    typeSearch(renderer, '@mindroom_helper:example.org');
    await pressKeyInSearch(renderer, 'Enter');

    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', undefined);
    expect(mx.setPowerLevel).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', 50);
    expect(getSearchInput(renderer).props.value).toBe('');
    expect(focusInput).toHaveBeenCalled();
    expect(textContentByRole(renderer, 'status')).toBe('');
    expect(textContentByRole(renderer, 'alert')).toContain('Invited @mindroom_helper:example.org');
    expect(textContentByRole(renderer, 'alert')).toContain('Forbidden');

    const helperRow = getRowByText(renderer, 'Helper')!;
    expect(extractText(getRowActionButton(helperRow))).toBe('Invited');
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
      await Promise.resolve();
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
    expect(mx.setPowerLevel).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', 50);
  });

  it('derives the default from live state once a previous grant syncs and that agent leaves', async () => {
    const { renderer, mx, room } = renderPrompt();
    vi.mocked(mx.setPowerLevel).mockImplementationOnce(async () => {
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
      });
      return { event_id: '$pl1' };
    });

    await clickRowInvite(renderer, 'Helper');
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(false);

    act(() => {
      room.state.members = [{ userId: '@mindroom_helper:example.org', membership: 'leave' }];
      mx.emit('RoomMember.membership', undefined, {
        roomId: room.roomId,
        userId: '@mindroom_helper:example.org',
      });
    });
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
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mx.setPowerLevel).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', 50);
  });

  it('re-reads live power levels before writing and skips setPowerLevel if target was already promoted', async () => {
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
    expect(mx.setPowerLevel).not.toHaveBeenCalled();
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
    expect(mx.setPowerLevel).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', 50);
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
    expect(rising.mx.setPowerLevel).not.toHaveBeenCalled();
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
    vi.mocked(mx.setPowerLevel)
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
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
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
    expect(mx.setPowerLevel).not.toHaveBeenCalled();
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
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mx.setPowerLevel).not.toHaveBeenCalled();
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

    expect(mx.setPowerLevel).not.toHaveBeenCalled();
    expect(textContentByRole(renderer, 'alert')).toContain("You don't have permission to do this.");
  });

  it('offers moderator rights in a v10 room', async () => {
    const { renderer, mx, room } = renderPrompt({ roomVersion: '10' });
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(true);
    await clickRowInvite(renderer, 'Helper');
    expect(mx.setPowerLevel).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', 50);
  });

  it('renders multiple queued detached grant failure notices and dismisses them individually', () => {
    const store = createStore();
    store.set(detachedGrantErrorAtom, [
      createDetachedGrantError(
        'Invited @mindroom_coder:example.org, but could not give Moderator rights: Forbidden'
      ),
      createDetachedGrantError(
        'Invited @mindroom_helper:example.org, but could not give Moderator rights: Forbidden'
      ),
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
    expect(findAlerts()).toHaveLength(2);
    expect(findDismissButtons()).toHaveLength(2);

    act(() => {
      findDismissButtons()[0]!.props.onClick();
    });
    expect(store.get(detachedGrantErrorAtom)).toHaveLength(1);
    expect(findAlerts()).toHaveLength(1);

    act(() => {
      findDismissButtons()[0]!.props.onClick();
    });
    expect(store.get(detachedGrantErrorAtom)).toEqual([]);
    expect(notice!.toJSON()).toBeNull();
  });
});
