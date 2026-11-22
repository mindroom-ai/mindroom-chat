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
import { detachedGrantErrorAtom, evaluateRoomModeratorGrant } from './moderatorInvite';
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
  Dialog: 'InviteDialog',
  TitleBar: 'InviteTitleBar',
  TitleBlock: 'InviteTitleBlock',
  Controls: 'InviteControls',
  FilterRow: 'InviteFilterRow',
  ListArea: 'InviteListArea',
  SectionHeader: 'InviteSectionHeader',
  List: 'InviteList',
  Row: 'InviteRow',
  AvatarWrap: 'InviteAvatarWrap',
  Identity: 'InviteIdentity',
  NameLine: 'InviteNameLine',
  AgentBadge: 'InviteAgentBadge',
  RowError: 'InviteRowError',
  RowAction: 'InviteRowAction',
  RowActionSent: 'InviteRowActionSent',
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
  return {
    roomId: '!room:example.org',
    name: options.name ?? 'Design Review',
    client: mx,
    state,
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

const pressKeyInSearch = async (renderer: ReactTestRenderer, key: string) => {
  const preventDefault = vi.fn();
  await act(async () => {
    getSearchInput(renderer).props.onKeyDown({ key, preventDefault });
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

describe('evaluateRoomModeratorGrant', () => {
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
});

describe('InviteUserPrompt (Option A — Instant Directory Sheet)', () => {
  it('uses desktop dialog framing by default and PhoneModal framing on mobile', () => {
    const desktop = renderPrompt({ screenSize: ScreenSize.Desktop });
    expect(getDialog(desktop.renderer).props['aria-modal']).toBe('true');
    expect(getDialog(desktop.renderer).props.className).toContain('InviteDialog');
    expect(getDialog(desktop.renderer).props.className).not.toContain('PhoneModal');
    expect(desktop.renderer.root.findByProps({ 'data-overlay-center': true }).props.className).toBe(
      'SafeOverlayCenter'
    );

    const mobile = renderPrompt({ screenSize: ScreenSize.Mobile });
    expect(getDialog(mobile.renderer).props.className).toContain('PhoneModal');
    expect(mobile.renderer.root.findByProps({ 'data-overlay-center': true }).props.className).toBe(
      'PhoneOverlayCenter'
    );
  });

  it('shows room title, Done button, and live member/invited counts without double-counting after sync', async () => {
    const requestClose = vi.fn();
    const { renderer, mx, room } = renderPrompt({
      name: 'Design Review',
      joinedCount: 2,
      invitedCount: 0,
      requestClose,
    });

    const heading = renderer.root.findByProps({ id: 'invite-user-prompt-title' });
    expect(extractText(heading)).toBe('Invite to Design Review');
    expect(extractText(getDialog(renderer))).toContain('2 Members');
    expect(extractText(getDialog(renderer))).not.toContain('Invited');

    // Invite Maya: subtitle immediately reflects 1 Invited before sync arrives.
    await clickRowInvite(renderer, 'Maya Chen');
    expect(extractText(getDialog(renderer))).toContain('2 Members · 1 Invited');

    // Matrix sync arrives with Maya as invited and room invitedCount updated to 1: must NOT become 2!
    act(() => {
      room.state.members.push({ userId: '@maya:example.org', membership: 'invite' });
      room.state.invitedCount = 1;
      mx.emit('RoomMember.membership', undefined, { roomId: room.roomId });
    });
    expect(extractText(getDialog(renderer))).toContain('2 Members · 1 Invited');
    expect(extractText(getDialog(renderer))).not.toContain('2 Invited');

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

  it('shows browsable Recent & Direct and Directory sections on open, and filters People / Agents cleanly', () => {
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

    // People tab: flat list (no section headers), hides same-server agents and hides moderator checkbox.
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
    expect(findModeratorCheckbox(renderer)).toBeUndefined();

    // Agents tab: flat list of same-server agents only, moderator checkbox visible.
    act(() => {
      getFilterButton(renderer, 'Agents').props.onClick();
    });
    expect(getRows(renderer)).toHaveLength(2);
    expect(getRows(renderer).map(extractText).join(' ')).toContain('Coder');
    expect(getRows(renderer).map(extractText).join(' ')).toContain('Helper');
    expect(findModeratorCheckbox(renderer)).toBeDefined();
  });

  it('caps browse directory rows at 100 entries', () => {
    const manyUsers: ServerUserDirectoryUser[] = Array.from({ length: 130 }, (_, index) => ({
      userId: `@user_${String(index).padStart(3, '0')}:example.org`,
      displayName: `User ${String(index).padStart(3, '0')}`,
    }));
    const { renderer } = renderPrompt({ cache: readyCache(manyUsers) });
    expect(getRows(renderer)).toHaveLength(100);
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

    // First attempt fails -> shows alert and Retry button.
    vi.mocked(mx.invite).mockRejectedValueOnce(new Error('Network down'));
    await clickRowInvite(renderer, 'Maya Chen');

    const failedRow = getRowByText(renderer, 'Maya Chen')!;
    expect(extractText(getRowActionButton(failedRow))).toBe('Retry');
    expect(textContentByRole(renderer, 'alert')).toContain('Network down');

    // Changing search carries over failed attempts so errors are never lost.
    typeSearch(renderer, 'liam');
    expect(getRowByText(renderer, 'Maya Chen')).toBeDefined();

    // Retrying succeeds and keeps the row in place as Invited even after Matrix sync marks her invited.
    await clickRowInvite(renderer, 'Maya Chen');
    expect(mx.invite).toHaveBeenCalledTimes(2);
    act(() => {
      room.state.members.push({ userId: '@maya:example.org', membership: 'invite' });
      mx.emit('RoomMember.membership', undefined, { roomId: room.roomId });
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
      mx.emit('RoomMember.membership', undefined, { roomId: room.roomId });
    });
    expect(getRowByText(renderer, 'Maya Chen')).toBeUndefined();
    expect(textContentByRole(renderer, 'alert')).toBe('');
  });

  it('keeps invite note collapsed by default and passes trimmed note as reason when expanded', async () => {
    const { renderer, mx, room } = renderPrompt();
    const toggle = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-expanded'] !== undefined
    );
    expect(toggle.props['aria-expanded']).toBe(false);
    expect(extractText(toggle)).toBe('+ Add invite note');

    act(() => {
      toggle.props.onClick();
    });
    const expandedToggle = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-expanded'] !== undefined
    );
    expect(expandedToggle.props['aria-expanded']).toBe(true);
    expect(extractText(expandedToggle)).toBe('− Hide invite note');

    const noteInput = renderer.root.find(
      (node) => node.type === 'input' && node.props.placeholder === 'Add a note to your invite...'
    );
    act(() => {
      noteInput.props.onChange({ target: { value: '  Welcome aboard!  ' } });
    });

    await clickRowInvite(renderer, 'Maya Chen');
    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@maya:example.org', 'Welcome aboard!');
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
      mx.emit('RoomMember.membership', undefined, { roomId: room.roomId });
      return { event_id: '$pl1' };
    });

    await clickRowInvite(renderer, 'Helper');
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(false);

    act(() => {
      room.state.members = [{ userId: '@mindroom_helper:example.org', membership: 'leave' }];
      mx.emit('RoomMember.membership', undefined, { roomId: room.roomId });
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

  it('publishes a non-blocking detached notice when a grant fails after the dialog closed', async () => {
    let finishInvite: () => void = () => undefined;
    const { renderer, mx, store } = renderPrompt();
    vi.mocked(mx.invite).mockImplementationOnce(
      () => new Promise((resolve) => (finishInvite = () => resolve({} as never)))
    );
    vi.mocked(mx.setPowerLevel).mockRejectedValueOnce(new Error('Forbidden'));

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
    });

    expect(store.get(detachedGrantErrorAtom)?.message).toBe(
      'Invited @mindroom_helper:example.org, but could not give Moderator rights: Forbidden'
    );
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
    });

    expect(mx.setPowerLevel).not.toHaveBeenCalled();
    expect(store.get(detachedGrantErrorAtom)?.message).toContain('@mindroom_helper:example.org');
    expect(store.get(detachedGrantErrorAtom)?.message).toContain('Admin');
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

  it('renders and dismisses a detached grant failure notice', () => {
    const store = createStore();
    store.set(detachedGrantErrorAtom, {
      message:
        'Invited @mindroom_helper:example.org, but could not give Moderator rights: Forbidden',
    });
    let notice: ReactTestRenderer;
    act(() => {
      notice = create(
        <Provider store={store}>
          <ModeratorGrantErrorNotice />
        </Provider>
      );
    });
    const alert = notice!.root.findByProps({ role: 'alert' });
    expect(alert).toBeDefined();
    const dismiss = notice!.root.findByProps({ 'aria-label': 'Dismiss notice' });
    act(() => {
      dismiss.props.onClick();
    });
    expect(store.get(detachedGrantErrorAtom)).toBeUndefined();
    expect(notice!.toJSON()).toBeNull();
  });
});
