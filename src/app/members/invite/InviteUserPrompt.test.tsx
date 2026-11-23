import React from 'react';
import { Text } from 'folds';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomEvent, RoomMemberEvent, type MatrixClient, type Room } from 'matrix-js-sdk';

import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { MINDROOM_ROUTER_STATE_EVENT } from '../../matrix/protocol/routerBinding';
import {
  userDirectoryCacheAtom,
  type ServerUserDirectoryUser,
  type UserDirectoryCacheState,
} from '../userDirectoryCache';
import {
  detachedGrantErrorAtom,
  evaluateRoomModeratorGrant,
  grantRoomModeratorRights,
} from './moderatorInvite';
import { ModeratorGrantErrorNotice } from './ModeratorGrantErrorNotice';
import { InviteUserPrompt } from './InviteUserPrompt';

const directUsersMock = vi.hoisted(() => ({ users: [] as string[] }));

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
  ViewportCenter: 'InviteViewportCenter',
  Dialog: 'InviteDialog',
  TitleBar: 'InviteTitleBar',
  TouchIcon: 'InviteTouchIcon',
  Controls: 'InviteControls',
  SearchField: 'InviteSearchField',
  FilterSegments: 'InviteFilterSegments',
  FilterSegment: 'InviteFilterSegment',
  Body: 'InviteBody',
  GrantAlert: 'InviteGrantAlert',
  ListFrame: 'InviteListFrame',
  ListArea: 'InviteListArea',
  ListScrollbar: 'InviteListScrollbar',
  SectionHeader: 'InviteSectionHeader',
  List: 'InviteList',
  Row: 'InviteRow',
  RowName: 'InviteRowName',
  AgentTag: 'InviteAgentTag',
  WrapText: 'InviteWrapText',
  RowError: 'InviteRowError',
  RowAction: 'InviteRowAction',
  RowActionIdle: 'InviteRowActionIdle',
  RowActionSent: 'InviteRowActionSent',
  CenteredHint: 'InviteCenteredHint',
  EmptyState: 'InviteEmptyState',
  Footer: 'InviteFooter',
  ModeratorLabel: 'InviteModeratorLabel',
  InfoButton: 'InviteInfoButton',
  ModeratorHelp: 'InviteModeratorHelp',
  NoteToggle: 'InviteNoteToggle',
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

type MockMember = { userId: string; membership: string };
type EventListener = (...args: unknown[]) => void;
type PowerLevelsHolder = { state: { powerLevels: Record<string, unknown> } };

type RoomOptions = {
  name?: string;
  isSpace?: boolean;
  roomVersion?: string;
  powerLevels?: Record<string, unknown>;
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
    searchUserDirectory: vi.fn(async () => ({ limited: false, results: [] })),
    invite: vi.fn(async () => undefined) as unknown as MockMatrixClient['invite'],
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
    getMember: (userId: string) => state.members.find((e) => e.userId === userId) ?? null,
    getMembers: vi.fn(() => state.members),
    loadMembersIfNeeded: vi.fn(options.loadMembersIfNeeded ?? (async () => true)),
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (eventType: string) => {
          if (eventType === 'm.room.power_levels') return makeStateEvent(state.powerLevels);
          if (eventType === 'm.room.create') return createEvent;
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
            return { querySelectorAll: () => rowFocusElements };
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
    if (typeof child === 'string') parts.push(child);
    else child.children.forEach(walk);
  };
  walk(node);
  return parts.join('');
};

const getDialog = (r: ReactTestRenderer) =>
  r.root.find((n) => typeof n.type === 'string' && n.props.role === 'dialog');
const getSearchInput = (r: ReactTestRenderer) =>
  r.root.find((n) => n.type === 'input' && n.props.type === 'search');
const getRows = (r: ReactTestRenderer) =>
  r.root.findAll((n) => n.type === 'li' && n.props.className === 'InviteRow');
const getRowByText = (r: ReactTestRenderer, needle: string) => {
  const row = getRows(r).find((n) => extractText(n).includes(needle));
  if (!row) throw new Error(`Row containing "${needle}" not found`);
  return row;
};
const getRowAction = (row: ReactTestInstance) =>
  row.find((n) => n.type === 'button' && 'data-invite-row-action' in n.props);
const getButtonByText = (r: ReactTestRenderer, label: string) => {
  const btn = r.root.findAllByType('button').find((n) => extractText(n) === label);
  if (!btn) throw new Error(`Button "${label}" not found`);
  return btn;
};
const getButtonByLabel = (r: ReactTestRenderer, label: string) => {
  const btn = r.root.findAllByType('button').find((n) => n.props['aria-label'] === label);
  if (!btn) throw new Error(`Button with aria-label "${label}" not found`);
  return btn;
};
const getModeratorSwitch = (r: ReactTestRenderer) =>
  r.root.find((n) => n.type === 'button' && n.props.role === 'switch');
const getNoteToggle = (r: ReactTestRenderer) =>
  r.root.find((n) => n.type === 'button' && n.props.className === 'InviteNoteToggle');
const getAlerts = (r: ReactTestRenderer) =>
  r.root.findAll((n) => typeof n.type === 'string' && n.props.role === 'alert');
const getStatusTexts = (r: ReactTestRenderer) =>
  r.root
    .findAll((n) => typeof n.type === 'string' && n.props.role === 'status')
    .map((n) => extractText(n))
    .filter(Boolean);

const typeSearch = (r: ReactTestRenderer, value: string) => {
  act(() => {
    getSearchInput(r).props.onChange({ target: { value } });
  });
};

const pressKey = (node: ReactTestInstance, key: string, extra: Record<string, unknown> = {}) => {
  const preventDefault = vi.fn();
  act(() => {
    node.props.onKeyDown({ key, preventDefault, ...extra });
  });
  return preventDefault;
};

const click = (node: ReactTestInstance) => {
  act(() => {
    node.props.onClick?.();
  });
};

// Native <label htmlFor> forwards clicks to its associated control in browsers without an onClick handler.
const clickLabel = (r: ReactTestRenderer, label: ReactTestInstance) => {
  expect(label.type).toBe('label');
  const targetId = label.props.htmlFor as string | undefined;
  expect(targetId).toBeTruthy();
  expect(label.props.onClick).toBeUndefined();
  click(r.root.find((n) => typeof n.type === 'string' && n.props.id === targetId));
};

const clickAsync = async (button: ReactTestInstance) => {
  await act(async () => {
    button.props.onClick?.();
    await settle();
  });
};

const openNoteAndType = (r: ReactTestRenderer, text: string) => {
  const toggle = getNoteToggle(r);
  if (!toggle.props['aria-expanded']) click(toggle);
  const input = r.root.find((n) => n.type === 'input' && n.props.type !== 'search');
  act(() => {
    input.props.onChange({ target: { value: text } });
  });
  return input;
};

const emitMembership = (
  mx: ReturnType<typeof makeMx>,
  room: ReturnType<typeof makeRoom>,
  userId: string,
  membership: string,
  roomId = room.roomId
) => {
  if (roomId === room.roomId) {
    room.state.members = [
      ...room.state.members.filter((m) => m.userId !== userId),
      { userId, membership },
    ];
  }
  act(() => {
    mx.emit(
      RoomMemberEvent.Membership,
      { getRoomId: () => roomId },
      { roomId, userId, membership }
    );
  });
};

beforeEach(() => {
  directUsersMock.users = [];
  focusInput.mockReset();
  rowFocusElements.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('evaluateRoomModeratorGrant & grantRoomModeratorRights', () => {
  it('returns grant level for an admin in a v10+ non-Space room and forbidden otherwise', () => {
    const levels = {
      users: { '@me:example.org': 100 },
      users_default: 0,
      state_default: 50,
      events: { 'm.room.power_levels': 100 },
    };
    const creators = new Set<string>();
    const normalRoom = { isSpaceRoom: () => false, getVersion: () => '11' };

    expect(evaluateRoomModeratorGrant(normalRoom, '@me:example.org', levels, creators)).toEqual({
      kind: 'grant',
      level: 50,
    });
    expect(
      evaluateRoomModeratorGrant(
        { isSpaceRoom: () => true, getVersion: () => '11' },
        '@me:example.org',
        levels,
        creators
      )
    ).toEqual({ kind: 'forbidden' });
    expect(
      evaluateRoomModeratorGrant(
        { isSpaceRoom: () => false, getVersion: () => '9' },
        '@me:example.org',
        levels,
        creators
      )
    ).toEqual({ kind: 'forbidden' });
    expect(evaluateRoomModeratorGrant(normalRoom, '@member:example.org', levels, creators)).toEqual(
      { kind: 'forbidden' }
    );
  });

  it('serializes concurrent room grants and merges against live server power levels before /sync', async () => {
    let liveLevels: Record<string, unknown> = {
      users: { '@me:example.org': 100 },
      users_default: 0,
      state_default: 50,
      events: { 'm.room.power_levels': 100 },
    };
    let releaseFirstWrite!: () => void;
    let firstWriteCount = 0;
    const client = {
      getSafeUserId: () => '@me:example.org',
      getStateEvent: vi.fn(async () => structuredClone(liveLevels)),
      sendStateEvent: vi.fn(
        async (_roomId: string, _type: string, content: Record<string, unknown>) => {
          firstWriteCount += 1;
          if (firstWriteCount === 1) {
            await new Promise<void>((resolve) => {
              releaseFirstWrite = resolve;
            });
          }
          liveLevels = structuredClone(content);
          return { event_id: `$ev${firstWriteCount}` };
        }
      ),
    } as unknown as MatrixClient;
    const room = {
      roomId: '!r:example.org',
      isSpaceRoom: () => false,
      getVersion: () => '11',
      getLiveTimeline: () => ({ getState: () => ({ getStateEvents: () => undefined }) }),
    } as unknown as Room;

    const first = grantRoomModeratorRights(client, room, '@mindroom_coder:example.org', 50);
    const second = grantRoomModeratorRights(client, room, '@mindroom_helper:example.org', 50);
    await settle();
    expect(client.getStateEvent).toHaveBeenCalledTimes(1);

    releaseFirstWrite();
    expect(await Promise.all([first, second])).toEqual([null, null]);
    expect(liveLevels.users).toEqual({
      '@me:example.org': 100,
      '@mindroom_coder:example.org': 50,
      '@mindroom_helper:example.org': 50,
    });
  });

  it('skips writing if already satisfied and rejects if required level rose above ceiling', async () => {
    const liveLevels: Record<string, unknown> = {
      users: { '@me:example.org': 100, '@mindroom_coder:example.org': 50 },
      events: { 'm.room.power_levels': 100, [MINDROOM_ROUTER_STATE_EVENT]: 75 },
    };
    const client = {
      getSafeUserId: () => '@me:example.org',
      getStateEvent: vi.fn(async () => structuredClone(liveLevels)),
      sendStateEvent: vi.fn(async () => ({ event_id: '$ev' })),
    } as unknown as MatrixClient;
    const room = {
      roomId: '!r:example.org',
      isSpaceRoom: () => false,
      getVersion: () => '11',
      getLiveTimeline: () => ({ getState: () => ({ getStateEvents: () => undefined }) }),
    } as unknown as Room;

    expect(
      await grantRoomModeratorRights(client, room, '@mindroom_helper:example.org', 50)
    ).toEqual({
      kind: 'levelRaised',
      level: 75,
    });
    expect(client.sendStateEvent).not.toHaveBeenCalled();

    (liveLevels.users as Record<string, number>)['@mindroom_coder:example.org'] = 75;
    expect(
      await grantRoomModeratorRights(client, room, '@mindroom_coder:example.org', 50)
    ).toBeNull();
    expect(client.sendStateEvent).not.toHaveBeenCalled();
  });
});

describe('InviteUserPrompt (Option A — Instant Directory Sheet)', () => {
  it('frames desktop and phone dialogs, shows live room header & counts, and closes on Close', () => {
    const requestClose = vi.fn();
    const { renderer, mx, room } = renderPrompt({
      screenSize: ScreenSize.Mobile,
      name: 'Design Review',
      joinedCount: 3,
      invitedCount: 1,
      requestClose,
    });

    const center = renderer.root.find((n) => n.props['data-overlay-center']);
    expect(center.props.className).toContain('PhoneOverlayCenter');
    expect(center.props.className).toContain('InviteViewportCenter');
    expect(getDialog(renderer).props.className).toContain('PhoneModal');
    expect(extractText(renderer.root.findByType('h2'))).toContain('Design Review');
    expect(extractText(getDialog(renderer))).toContain('3 Members · 1 Invited');

    room.state.joinedCount = 4;
    room.state.invitedCount = 0;
    act(() => room.emit(RoomEvent.Summary));
    expect(extractText(getDialog(renderer))).toContain('4 Members');
    expect(extractText(getDialog(renderer))).not.toContain('Invited');

    // Membership event for another room does not affect state.
    emitMembership(mx, room, '@maya:example.org', 'join', '!other:example.org');
    expect(getRows(renderer).some((r) => extractText(r).includes('Maya Chen'))).toBe(true);

    click(getButtonByLabel(renderer, 'Close'));
    expect(requestClose).toHaveBeenCalledTimes(1);

    const desktop = renderPrompt({ screenSize: ScreenSize.Desktop, name: '   ' });
    expect(extractText(desktop.renderer.root.findByType('h2'))).toBe('Invite');
    expect(
      desktop.renderer.root.find((n) => n.props['data-overlay-center']).props.className
    ).toContain('SafeOverlayCenter');
  });

  it('shows browsable Recent & Direct and Directory sections, filters People/Agents, and keeps consent visible', () => {
    directUsersMock.users = ['@maya:example.org'];
    const { renderer } = renderPrompt();

    const headings = renderer.root.findAllByType('h3').map(extractText);
    expect(headings).toEqual(['Recent & Direct', 'Directory']);
    expect(getRows(renderer)).toHaveLength(4);

    click(getButtonByText(renderer, 'Agents'));
    expect(
      getRows(renderer)
        .map(extractText)
        .every((t) => t.includes('Agent'))
    ).toBe(true);
    expect(getRows(renderer)).toHaveLength(2);

    click(getButtonByText(renderer, 'People'));
    expect(getRows(renderer)).toHaveLength(2);
    expect(getModeratorSwitch(renderer)).toBeDefined();

    // Clicking the wrappable label toggles the switch; Info button stays outside the label and never flips it.
    const modLabel = renderer.root.findByType('label');
    expect(modLabel.props.className).toContain('InviteModeratorLabel');
    expect(modLabel.findAllByType('button')).toHaveLength(0);
    expect(getModeratorSwitch(renderer).props['aria-checked']).toBe(true);
    clickLabel(renderer, modLabel);
    expect(getModeratorSwitch(renderer).props['aria-checked']).toBe(false);
    clickLabel(renderer, modLabel);
    expect(getModeratorSwitch(renderer).props['aria-checked']).toBe(true);

    // Info disclosure toggles the moderator help callout and wires aria-controls / aria-describedby only when open.
    const infoBtn = getButtonByLabel(renderer, 'Information');
    expect(infoBtn.props['aria-expanded']).toBe(false);
    expect(infoBtn.props['aria-controls']).toBeUndefined();
    expect(getModeratorSwitch(renderer).props['aria-describedby']).toBeUndefined();
    expect(extractText(getDialog(renderer))).not.toContain('fold voice transcripts');

    click(infoBtn);
    expect(infoBtn.props['aria-expanded']).toBe(true);
    expect(getModeratorSwitch(renderer).props['aria-checked']).toBe(true);
    const helpId = infoBtn.props['aria-controls'] as string;
    expect(helpId).toBeTruthy();
    expect(getModeratorSwitch(renderer).props['aria-describedby']).toBe(helpId);
    expect(extractText(renderer.root.findByProps({ id: helpId }))).toContain(
      'fold voice transcripts'
    );

    click(infoBtn);
    expect(infoBtn.props['aria-expanded']).toBe(false);
    expect(infoBtn.props['aria-controls']).toBeUndefined();
    expect(getModeratorSwitch(renderer).props['aria-describedby']).toBeUndefined();
    expect(getModeratorSwitch(renderer).props['aria-checked']).toBe(true);

    // Typing a listed agent MXID on the People tab still resolves its directory display name.
    typeSearch(renderer, '@mindroom_coder:example.org');
    expect(extractText(getRowByText(renderer, 'Coder'))).not.toContain('External Matrix ID');
  });

  it('filters by People/Agents before limiting search results so people never crowd out agents', () => {
    const users: ServerUserDirectoryUser[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        userId: `@alpha_${i}:example.org`,
        displayName: `Alpha Person ${i}`,
      })),
      { userId: '@mindroom_alpha:example.org', displayName: 'Alpha Agent' },
    ];
    const { renderer } = renderPrompt({ cache: readyCache(users) });

    click(getButtonByText(renderer, 'Agents'));
    typeSearch(renderer, 'alpha');
    expect(getRows(renderer)).toHaveLength(1);
    expect(extractText(getRows(renderer)[0]!)).toContain('Alpha Agent');
  });

  it('caps browse rows at 100, truncates listed MXIDs, and wraps unlisted external Matrix IDs', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      userId: `@user_${i}:example.org`,
      displayName: `User ${String(i).padStart(3, '0')}`,
    }));
    const { renderer } = renderPrompt({ cache: readyCache(many) });
    expect(getRows(renderer)).toHaveLength(100);

    const listedRow = getRowByText(renderer, '@user_0:example.org');
    const listedTexts = listedRow.findAllByType(Text);
    const listedName = listedTexts.find((n) => extractText(n) === 'User 000');
    const listedId = listedTexts.find((n) => extractText(n) === '@user_0:example.org');
    expect(listedName?.props.truncate).toBe(true);
    expect(listedId?.props.truncate).toBe(true);
    expect(listedId?.props.className ?? '').not.toContain('InviteWrapText');

    const externalId = '@very.long.external.user.name:another-server.example.org';
    typeSearch(renderer, externalId);
    const row = getRowByText(renderer, externalId);
    expect(extractText(row)).toContain('External Matrix ID');
    const unlistedTexts = row.findAllByType(Text);
    const nameText = unlistedTexts.find((n) => extractText(n) === externalId);
    const subtitleText = unlistedTexts.find((n) => extractText(n) === 'External Matrix ID');
    expect(nameText?.props.truncate).toBe(false);
    expect(nameText?.props.className).toContain('InviteWrapText');
    expect(subtitleText?.props.truncate).toBe(true);
  });

  it('shows hints for already-joined, already-invited, banned, and invalid Enter queries', () => {
    const { renderer } = renderPrompt({
      members: [
        { userId: '@joined:example.org', membership: 'join' },
        { userId: '@invited:example.org', membership: 'invite' },
        { userId: '@banned:example.org', membership: 'ban' },
      ],
    });

    typeSearch(renderer, '@joined:example.org');
    expect(getStatusTexts(renderer)).toContain('Already in this room');

    typeSearch(renderer, '@invited:example.org');
    expect(getStatusTexts(renderer)).toContain('Already invited');

    typeSearch(renderer, '@banned:example.org');
    expect(getStatusTexts(renderer)).toContain('Banned from this room');

    // Plain search with matches does not trigger invalid-ID hint on Enter.
    typeSearch(renderer, 'Maya');
    pressKey(getSearchInput(renderer), 'Enter');
    expect(getStatusTexts(renderer)).toEqual([]);

    // Invalid MXID triggers hint, cleared on filter switch.
    typeSearch(renderer, '@not-a-mxid');
    pressKey(getSearchInput(renderer), 'Enter');
    expect(getStatusTexts(renderer).some((t) => t.toLowerCase().includes('valid'))).toBe(true);
    click(getButtonByText(renderer, 'People'));
    expect(getStatusTexts(renderer)).toEqual([]);
  });

  it('supports ArrowDown/ArrowUp focus nav, Clear button, Enter-to-invite pinning, and IME guard', async () => {
    const { renderer, mx } = renderPrompt();
    const firstBtn = { focus: vi.fn() };
    const secondBtn = { focus: vi.fn() };
    rowFocusElements.push(firstBtn, secondBtn);

    const mockDoc = { activeElement: null as unknown };
    vi.stubGlobal('document', mockDoc);
    pressKey(getSearchInput(renderer), 'ArrowDown');
    expect(firstBtn.focus).toHaveBeenCalledTimes(1);

    mockDoc.activeElement = firstBtn;
    pressKey(getSearchInput(renderer), 'ArrowDown');
    expect(secondBtn.focus).toHaveBeenCalledTimes(1);

    mockDoc.activeElement = firstBtn;
    pressKey(getSearchInput(renderer), 'ArrowUp');
    expect(focusInput).toHaveBeenCalledTimes(1);

    // IME composition ignores Enter and ArrowDown.
    typeSearch(renderer, '@guest:example.org');
    pressKey(getSearchInput(renderer), 'Enter', { nativeEvent: { isComposing: true } });
    expect(mx.invite).not.toHaveBeenCalled();

    // Clear button clears search and focuses input.
    const clearBtn = renderer.root.find(
      (n) => n.type === 'button' && n.props['aria-label'] === 'Clear'
    );
    click(clearBtn);
    expect(getSearchInput(renderer).props.value).toBe('');
    expect(focusInput).toHaveBeenCalledTimes(2);

    // Enter invites eligible MXID, clears search, pins row newest-first, and focuses input.
    typeSearch(renderer, '@guest1:example.org');
    await act(async () => {
      pressKey(getSearchInput(renderer), 'Enter');
      await settle();
    });
    expect(mx.invite).toHaveBeenCalledWith('!room:example.org', '@guest1:example.org', undefined);
    expect(getSearchInput(renderer).props.value).toBe('');
    expect(extractText(getRows(renderer)[0]!)).toContain('@guest1:example.org');
  });

  it('keeps invited rows in place on sync, re-enables on leave/knock, and handles Retry + carry-over', async () => {
    const { renderer, mx, room } = renderPrompt();
    const mayaBtn = getRowAction(getRowByText(renderer, 'Maya Chen'));
    await clickAsync(mayaBtn);

    expect(extractText(getRowAction(getRowByText(renderer, 'Maya Chen')))).toBe('Invited');
    expect(getStatusTexts(renderer)).toContain('Invited @maya:example.org.');

    // Syncing invite membership keeps the row in place.
    emitMembership(mx, room, '@maya:example.org', 'invite');
    expect(extractText(getRowAction(getRowByText(renderer, 'Maya Chen')))).toBe('Invited');

    // Leave/knock clears invited state so the user can be re-invited.
    emitMembership(mx, room, '@maya:example.org', 'leave');
    expect(extractText(getRowAction(getRowByText(renderer, 'Maya Chen')))).toBe('Invite');

    // Invite failure shows Retry and carries over across filter switches, while sent invites stay behind.
    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Network down'));
    await clickAsync(getRowAction(getRowByText(renderer, 'Liam Park')));
    expect(extractText(getRowAction(getRowByText(renderer, 'Liam Park')))).toBe('Retry');

    await clickAsync(getRowAction(getRowByText(renderer, 'Maya Chen')));
    click(getButtonByText(renderer, 'Agents'));
    expect(getRows(renderer).some((r) => extractText(r).includes('Liam Park'))).toBe(true);
    expect(getRows(renderer).some((r) => extractText(r).includes('Maya Chen'))).toBe(false);

    // Retry succeeds; if instead user joins externally, failed attempt drops automatically.
    await clickAsync(getRowAction(getRowByText(renderer, 'Liam Park')));
    expect(extractText(getRowAction(getRowByText(renderer, 'Liam Park')))).toBe('Invited');

    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Oops'));
    await clickAsync(getRowAction(getRowByText(renderer, 'Coder')));
    expect(extractText(getRowAction(getRowByText(renderer, 'Coder')))).toBe('Retry');
    emitMembership(mx, room, '@mindroom_coder:example.org', 'join');
    expect(getRows(renderer).some((r) => extractText(r).includes('Coder'))).toBe(false);
  });

  it('consumes invite note immediately on submit, skips when collapsed, and preserves on Retry', async () => {
    const { renderer, mx } = renderPrompt();
    openNoteAndType(renderer, 'Welcome aboard');

    // Note input renders immediately after the toggle button so Tab moves straight into it.
    const footer = renderer.root.find(
      (n) => n.type === 'div' && n.props.className === 'InviteFooter'
    );
    const footerControls = footer.findAll(
      (n) =>
        (n.type === 'button' &&
          (n.props.role === 'switch' || n.props.className === 'InviteNoteToggle')) ||
        n.type === 'input'
    );
    expect(
      footerControls.map((n) => (n.type === 'input' ? 'input' : n.props.role ?? n.props.className))
    ).toEqual(['switch', 'InviteNoteToggle', 'input']);

    // Collapsing skips sending the note.
    const toggle = getNoteToggle(renderer);
    click(toggle);
    await clickAsync(getRowAction(getRowByText(renderer, 'Maya Chen')));
    expect(mx.invite).toHaveBeenCalledWith('!room:example.org', '@maya:example.org', undefined);

    // Re-open, fail Liam with note -> note clears immediately; newer draft is untouched by Retry.
    click(toggle);
    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Temporary'));
    await clickAsync(getRowAction(getRowByText(renderer, 'Liam Park')));
    expect(mx.invite).toHaveBeenLastCalledWith(
      '!room:example.org',
      '@liam:example.org',
      'Welcome aboard'
    );

    const freshNote = openNoteAndType(renderer, 'For someone else');
    expect(freshNote.props.value).toBe('For someone else');

    // Retry sends original note and leaves the new draft intact.
    await clickAsync(getRowAction(getRowByText(renderer, 'Liam Park')));
    expect(mx.invite).toHaveBeenLastCalledWith(
      '!room:example.org',
      '@liam:example.org',
      'Welcome aboard'
    );
    expect(freshNote.props.value).toBe('For someone else');

    // Rapid back-to-back invites before re-render only attach the draft to the first invite.
    act(() => {
      getRowAction(getRowByText(renderer, 'Coder')).props.onClick();
      getRowAction(getRowByText(renderer, 'Helper')).props.onClick();
    });
    await act(async () => {
      await settle();
    });
    expect(mx.invite).toHaveBeenCalledWith(
      '!room:example.org',
      '@mindroom_coder:example.org',
      'For someone else'
    );
    expect(mx.invite).toHaveBeenCalledWith(
      '!room:example.org',
      '@mindroom_helper:example.org',
      undefined
    );
  });

  it('shows directory failure alert with Retry above any cached rows', async () => {
    const { renderer, mx } = renderPrompt({
      cache: readyCache(defaultCacheUsers(), 'error'),
    });
    expect(getAlerts(renderer)).toHaveLength(1);
    expect(getRows(renderer)).toHaveLength(4);
    await clickAsync(getButtonByText(renderer, 'Retry'));
    expect(mx.searchUserDirectory).toHaveBeenCalled();
  });

  it('hydrates room members lazily, defaults moderator switch accurately, and skips ineligible targets', async () => {
    let finishLoad!: () => void;
    const loadMembersIfNeeded = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishLoad = () => resolve(true);
        })
    );
    const { renderer, mx, room } = renderPrompt({
      membersLoaded: false,
      loadMembersIfNeeded,
    });

    expect(loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    // Unchecked until members finish loading.
    expect(getModeratorSwitch(renderer).props['aria-checked']).toBe(false);

    room.state.membersLoaded = true;
    await act(async () => {
      finishLoad();
      await settle();
    });
    expect(getModeratorSwitch(renderer).props['aria-checked']).toBe(true);

    // Inviting a human never writes power levels.
    await clickAsync(getRowAction(getRowByText(renderer, 'Maya Chen')));
    expect(mx.sendStateEvent).not.toHaveBeenCalled();

    // Inviting an eligible agent invites first and grants level 50.
    await clickAsync(getRowAction(getRowByText(renderer, 'Coder')));
    expect(mx.invite).toHaveBeenCalledWith(
      '!room:example.org',
      '@mindroom_coder:example.org',
      undefined
    );
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      'm.room.power_levels',
      expect.objectContaining({
        users: expect.objectContaining({ '@mindroom_coder:example.org': 50 }),
      }),
      ''
    );

    // Toggling off skips grant on subsequent agent invite.
    click(getModeratorSwitch(renderer));
    expect(getModeratorSwitch(renderer).props['aria-checked']).toBe(false);
    await clickAsync(getRowAction(getRowByText(renderer, 'Helper')));
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);

    // Defaults OFF when an agent moderator already exists; supports v12 creator with no users entry.
    const existingMod = renderPrompt({
      members: [{ userId: '@mindroom_coder:example.org', membership: 'join' }],
      powerLevels: {
        users: { '@me:example.org': 100, '@mindroom_coder:example.org': 50 },
        events: { 'm.room.power_levels': 100 },
      },
    });
    expect(getModeratorSwitch(existingMod.renderer).props['aria-checked']).toBe(false);

    const v12Creator = renderPrompt({
      createContent: { room_version: '12' },
      createSender: '@me:example.org',
      powerLevels: { users: {}, events: { 'm.room.power_levels': 100 } },
    });
    expect(getModeratorSwitch(v12Creator.renderer).props['aria-checked']).toBe(true);
  });

  it('shows dismissible inline grant alert when open and detached shell notice when closed', async () => {
    const { renderer, mx } = renderPrompt();
    vi.mocked(mx.sendStateEvent).mockRejectedValueOnce(new Error('Denied'));

    await clickAsync(getRowAction(getRowByText(renderer, 'Coder')));
    expect(extractText(getRowAction(getRowByText(renderer, 'Coder')))).toBe('Invited');
    expect(getAlerts(renderer)).toHaveLength(1);
    expect(extractText(getAlerts(renderer)[0]!)).toContain('Denied');

    const dismissBtn = renderer.root.find(
      (n) => n.type === 'button' && n.props['aria-label'] === 'Dismiss notice'
    );
    click(dismissBtn);
    expect(getAlerts(renderer)).toHaveLength(0);

    // Close while invite is pending; failed grant sets detachedGrantErrorAtom and ModeratorGrantErrorNotice dismisses it.
    let resolveInvite!: () => void;
    const closed = renderPrompt();
    vi.mocked(closed.mx.invite).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInvite = () => resolve({});
        })
    );
    vi.mocked(closed.mx.sendStateEvent).mockRejectedValueOnce(new Error('Server error'));

    act(() => {
      getRowAction(getRowByText(closed.renderer, 'Helper')).props.onClick();
    });
    act(() => closed.renderer.unmount());
    await act(async () => {
      resolveInvite();
      await settle();
    });

    expect(closed.store.get(detachedGrantErrorAtom)?.message).toContain('Server error');

    let notice!: ReactTestRenderer;
    act(() => {
      notice = create(
        <Provider store={closed.store}>
          <ModeratorGrantErrorNotice />
        </Provider>
      );
    });
    expect(extractText(notice.root)).toContain('Server error');
    const alert = notice.root.findByProps({ role: 'alert' });
    // Marked as a notice that moves into what covers the page (sidebar/PhoneNavDrawer.tsx).
    expect(alert.props['data-cover-notice']).toBe('');
    const dismiss = notice.root.findByProps({ 'aria-label': 'Dismiss notice' });
    act(() => {
      dismiss.props.onClick();
    });
    expect(closed.store.get(detachedGrantErrorAtom)).toBeUndefined();
  });
});
