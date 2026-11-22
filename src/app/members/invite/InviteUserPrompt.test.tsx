import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { config, toRem } from 'folds';

import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { userDirectoryCacheAtom, type UserDirectoryCacheState } from '../userDirectoryCache';
import { detachedGrantErrorAtom } from './moderatorInvite';
import { ModeratorGrantErrorNotice } from './ModeratorGrantErrorNotice';
import { InviteUserPrompt } from './InviteUserPrompt';

const directUsersMock = vi.hoisted(() => ({
  users: [] as string[],
}));

type WindowKeyHandler = (event: KeyboardEvent) => void;
const windowListeners = new Map<string, Set<WindowKeyHandler>>();

vi.mock('../../ui/page/PageScroll', () => ({
  PageScroll: ({ header, children }: { header?: React.ReactNode; children?: React.ReactNode }) =>
    React.createElement('div', null, header, children),
}));
vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return {
    ...actual,
    Overlay: ({ children, backdrop }: { children?: React.ReactNode; backdrop?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, backdrop, children),
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
    PopOut: ({
      anchor,
      content,
      children,
    }: {
      anchor?: unknown;
      content?: React.ReactNode;
      children?: React.ReactNode;
    }) => React.createElement('div', { 'data-popout': true }, children, anchor ? content : null),
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('./InviteAutocompleteMenu.css', () => ({
  InviteAutocompleteMenuRoot: 'InviteAutocompleteMenuRoot',
  InviteAutocompletePopOut: 'InviteAutocompletePopOut',
  InviteAutocompleteMenuContainer: 'InviteAutocompleteMenuContainer',
  InviteAutocompleteMenu: 'InviteAutocompleteMenu',
  InviteAutocompleteMenuHeader: 'InviteAutocompleteMenuHeader',
  InviteAutocompleteOption: 'InviteAutocompleteOption',
  InviteAutocompleteIdentity: 'InviteAutocompleteIdentity',
  InviteAutocompleteDisplayName: 'InviteAutocompleteDisplayName',
  InviteAutocompleteUserId: 'InviteAutocompleteUserId',
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

vi.mock('../../ui/styles/Text.css', () => ({
  BreakWord: 'BreakWord',
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

const readyCache = (): UserDirectoryCacheState => ({
  users: [
    {
      userId: '@suggestion:example.org',
      displayName: '@alice:example.org',
    },
  ],
  status: 'ready',
  fetchedAt: Date.now(),
  limited: false,
  isBootstrapOnly: false,
  ownerKey: '@me:example.org|https://example.org',
});

type RoomOptions = {
  isSpace?: boolean;
  roomVersion?: string;
  powerLevels?: Record<string, unknown>;
  powerLevelTags?: Record<string, unknown>;
  createContent?: Record<string, unknown>;
  createSender?: string;
  members?: { userId: string; membership: string }[];
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

const makeMx = (getRoom: () => Room | null) => {
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
  };
  const createEvent = options.createContent
    ? makeStateEvent(options.createContent, options.createSender)
    : undefined;
  return {
    roomId: '!room:example.org',
    client: mx,
    state,
    isSpaceRoom: () => options.isSpace ?? false,
    getVersion: () =>
      options.roomVersion ??
      (typeof options.createContent?.room_version === 'string'
        ? options.createContent.room_version
        : '12'),
    membersLoaded: () => state.membersLoaded,
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

const anchorRect = {
  x: 24,
  y: 100,
  width: 320,
  height: 40,
  top: 100,
  bottom: 140,
  left: 24,
  right: 344,
};

const createNodeMock = (element: React.ReactElement) => {
  const className = typeof element.props.className === 'string' ? element.props.className : '';
  if (className.includes('InviteAutocompleteMenuRoot')) {
    return { getBoundingClientRect: () => anchorRect };
  }
  return null;
};

const renderPrompt = (options: RoomOptions = {}) => {
  const store = createStore();
  const roomRef: { current: Room | null } = { current: null };
  const mx = makeMx(() => roomRef.current);
  const room = makeRoom(mx, options);
  roomRef.current = room as unknown as Room;
  store.set(userDirectoryCacheAtom, readyCache());

  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(
      <Provider store={store}>
        <MatrixClientProvider value={mx as MatrixClient}>
          <InviteUserPrompt room={room as unknown as Room} requestClose={vi.fn()} />
        </MatrixClientProvider>
      </Provider>,
      { createNodeMock }
    );
  });

  return {
    renderer: renderer!,
    mx,
    room,
    store,
  };
};

const getInput = (renderer: ReactTestRenderer) => renderer.root.findByProps({ role: 'combobox' });

const getForm = (renderer: ReactTestRenderer) => renderer.root.find((node) => node.type === 'form');

const getDialog = (renderer: ReactTestRenderer) =>
  renderer.root.find(
    (node) =>
      node.type === 'div' &&
      node.props.style?.width === '100%' &&
      typeof node.props.style?.maxWidth === 'string'
  );

const getOptions = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'button' && node.props.role === 'option');

const typeUserId = (renderer: ReactTestRenderer, value: string) => {
  act(() => {
    getInput(renderer).props.onFocus();
    getInput(renderer).props.onChange({
      currentTarget: { value },
    });
  });
};

const keyDown = (renderer: ReactTestRenderer, key: string) => {
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  const keyboardEvent = {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault,
    stopPropagation,
  } as unknown as KeyboardEvent;

  act(() => {
    getInput(renderer).props.onKeyDown(keyboardEvent);
    windowListeners.get('keydown')?.forEach((handler) => handler(keyboardEvent));
  });

  return { preventDefault, stopPropagation };
};

const submitInvite = async (renderer: ReactTestRenderer) => {
  const preventDefault = vi.fn();

  await act(async () => {
    getForm(renderer).props.onSubmit({
      preventDefault,
      target: {
        reasonInput: {
          value: '',
        },
      },
    });
    await Promise.resolve();
  });

  return preventDefault;
};

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

beforeEach(() => {
  windowListeners.clear();
  directUsersMock.users = [];
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: { clientHeight: 768 },
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      performance: {
        now: vi.fn(() => 0),
      },
      location: { protocol: 'https:' },
      addEventListener: vi.fn((type: string, handler: WindowKeyHandler) => {
        const handlers = windowListeners.get(type) ?? new Set<WindowKeyHandler>();
        handlers.add(handler);
        windowListeners.set(type, handlers);
      }),
      removeEventListener: vi.fn((type: string, handler: WindowKeyHandler) => {
        windowListeners.get(type)?.delete(handler);
      }),
    },
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: originalDocument,
  });
});

describe('InviteUserPrompt', () => {
  it('uses a wider responsive dialog so invite matches have room to breathe', () => {
    const { renderer } = renderPrompt();

    expect(getDialog(renderer).props.style).toMatchObject({
      width: '100%',
      maxWidth: `min(calc(100vw - 2 * ${config.space.S400}), ${toRem(680)})`,
    });
  });

  it.each([
    { key: 'Enter', closesSuggestions: false },
    { key: 'Tab', closesSuggestions: true },
  ])(
    'submits a typed valid MXID after $key even when suggestions are open',
    async ({ key, closesSuggestions }) => {
      const { renderer, mx, room } = renderPrompt();

      typeUserId(renderer, '@alice:example.org');
      expect(getOptions(renderer)).toHaveLength(1);

      const { preventDefault: keyPreventDefault } = keyDown(renderer, key);

      expect(keyPreventDefault).not.toHaveBeenCalled();
      expect(getOptions(renderer)).toHaveLength(closesSuggestions ? 0 : 1);

      const submitPreventDefault = await submitInvite(renderer);

      expect(submitPreventDefault).toHaveBeenCalled();
      expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@alice:example.org', undefined);
      expect(mx.invite).not.toHaveBeenCalledWith(room.roomId, '@suggestion:example.org', undefined);
    }
  );

  const findModeratorCheckbox = (renderer: ReactTestRenderer) =>
    renderer.root.findAll((node) => node.type === 'input' && node.props.type === 'checkbox')[0];

  const textContent = (renderer: ReactTestRenderer, role: string) =>
    renderer.root
      .findAll((node) => node.props.role === role)
      .map((node) =>
        Array.isArray(node.children) ? node.children.join('') : String(node.children)
      )
      .join(' ');

  it('defaults moderator rights ON for a MindRoom agent when none holds moderator power, and invites before granting', async () => {
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

    typeUserId(renderer, '@mindroom_helper:example.org');
    const checkbox = findModeratorCheckbox(renderer);
    expect(checkbox).toBeDefined();
    expect(checkbox?.props.checked).toBe(true);

    await submitInvite(renderer);

    expect(calls).toEqual(['invite', 'setPowerLevel']);
    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', undefined);
    expect(mx.setPowerLevel).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', 50);
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

    typeUserId(renderer, '@mindroom_helper:example.org');
    const checkbox = findModeratorCheckbox(renderer);
    expect(checkbox).toBeDefined();
    expect(checkbox?.props.checked).toBe(false);

    await submitInvite(renderer);

    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', undefined);
    expect(mx.setPowerLevel).not.toHaveBeenCalled();
  });

  it('skips setPowerLevel when the user unchecks the moderator checkbox', async () => {
    const { renderer, mx, room } = renderPrompt();

    typeUserId(renderer, '@mindroom_helper:example.org');
    const checkbox = findModeratorCheckbox(renderer);
    expect(checkbox?.props.checked).toBe(true);
    act(() => {
      checkbox?.props.onClick();
    });
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(false);

    await submitInvite(renderer);

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

    typeUserId(renderer, '@mindroom_helper:example.org');
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(true);

    await submitInvite(renderer);

    expect(mx.setPowerLevel).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', 75);
  });

  it.each([
    { label: 'human user', target: '@alice:example.org', options: {} },
    { label: 'owner account', target: '@mindroom_router:example.org', options: {} },
    { label: 'foreign-server agent', target: '@mindroom_helper:other.org', options: {} },
    { label: 'Space room', target: '@mindroom_helper:example.org', options: { isSpace: true } },
    {
      label: 'viewer cannot change power levels',
      target: '@mindroom_helper:example.org',
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
      label: 'target already holds moderator power',
      target: '@mindroom_helper:example.org',
      options: {
        powerLevels: {
          users: { '@me:example.org': 100, '@mindroom_helper:example.org': 50 },
          users_default: 0,
          state_default: 50,
          events: { 'm.room.power_levels': 100 },
        },
      },
    },
    {
      label: 'viewer can send power_levels but sits below grant level',
      target: '@mindroom_helper:example.org',
      options: {
        powerLevels: {
          users: { '@me:example.org': 50 },
          users_default: 0,
          state_default: 50,
          events: { 'm.room.power_levels': 50, 'io.mindroom.router': 75 },
        },
      },
    },
  ])('hides the moderator checkbox for $label', ({ target, options }) => {
    const { renderer } = renderPrompt(options);
    typeUserId(renderer, target);
    expect(findModeratorCheckbox(renderer)).toBeUndefined();
  });

  it('keeps the invite and shows a non-blocking error when granting moderator rights fails', async () => {
    const { renderer, mx, room } = renderPrompt();
    vi.mocked(mx.setPowerLevel).mockRejectedValueOnce(new Error('Forbidden'));

    typeUserId(renderer, '@mindroom_helper:example.org');
    await submitInvite(renderer);

    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', undefined);
    expect(mx.setPowerLevel).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', 50);
    expect(getInput(renderer).props.value).toBe('');
    expect(textContent(renderer, 'status')).toBe('');
    expect(textContent(renderer, 'alert')).toContain('Invited @mindroom_helper:example.org');
    expect(textContent(renderer, 'alert')).toContain('Forbidden');
  });

  it.each([
    { label: 'human target', target: '@alice:example.org', options: {} },
    { label: 'Space room', target: '@mindroom_helper:example.org', options: { isSpace: true } },
    {
      label: 'viewer who cannot grant',
      target: '@mindroom_helper:example.org',
      options: {
        powerLevels: {
          users: { '@me:example.org': 50 },
          users_default: 0,
          state_default: 50,
          events: { 'm.room.power_levels': 100 },
        },
      },
    },
  ])('does not load or scan room members for $label', ({ target, options }) => {
    const { renderer, room } = renderPrompt({ membersLoaded: false, ...options });
    typeUserId(renderer, target);
    expect(room.loadMembersIfNeeded).not.toHaveBeenCalled();
    expect(room.getMembers).not.toHaveBeenCalled();
  });

  it('loads members lazily on eligible agent target, takes one snapshot after loading, and flips ON', async () => {
    let resolveLoad: (loaded: boolean) => void = () => undefined;
    const loadPromise = new Promise<boolean>((resolve) => {
      resolveLoad = resolve;
    });
    const { renderer, mx, room } = renderPrompt({
      membersLoaded: false,
      loadMembersIfNeeded: () => loadPromise,
    });

    expect(room.loadMembersIfNeeded).not.toHaveBeenCalled();
    expect(room.getMembers).not.toHaveBeenCalled();

    typeUserId(renderer, '@mindroom_helper:example.org');
    expect(room.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(false);

    // Out-of-band membership events during hydration must not scan the roster repeatedly.
    act(() => {
      mx.emit('RoomMember.membership', undefined, { roomId: room.roomId });
      mx.emit('RoomMember.membership', undefined, { roomId: room.roomId });
    });
    expect(room.getMembers).not.toHaveBeenCalled();

    // Resolving loadMembersIfNeeded settles the default with a single snapshot.
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

    typeUserId(renderer, '@mindroom_helper:example.org');
    const checkbox = findModeratorCheckbox(renderer);
    expect(checkbox?.props.checked).toBe(false);
    act(() => {
      checkbox?.props.onClick();
    });
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(true);

    await submitInvite(renderer);

    expect(mx.invite).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', undefined);
    expect(mx.setPowerLevel).toHaveBeenCalledWith(room.roomId, '@mindroom_helper:example.org', 50);
  });

  it('derives the default from live state once a previous grant syncs and that agent leaves', async () => {
    const { renderer, mx, room } = renderPrompt();
    vi.mocked(mx.setPowerLevel).mockImplementationOnce(async () => {
      room.state.members = [{ userId: '@mindroom_first:example.org', membership: 'invite' }];
      room.state.powerLevels = {
        ...room.state.powerLevels,
        users: { '@me:example.org': 100, '@mindroom_first:example.org': 50 },
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

    typeUserId(renderer, '@mindroom_first:example.org');
    await submitInvite(renderer);

    // First agent is invited with power 50 -> second agent defaults OFF.
    typeUserId(renderer, '@mindroom_second:example.org');
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(false);

    // First agent declines/leaves -> live state has no moderator agent -> default flips back ON.
    act(() => {
      room.state.members = [{ userId: '@mindroom_first:example.org', membership: 'leave' }];
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

    typeUserId(renderer, '@mindroom_helper:example.org');
    act(() => {
      getForm(renderer).props.onSubmit({
        preventDefault: vi.fn(),
        target: { reasonInput: { value: '' } },
      });
    });

    // User closes the dialog while invite is in flight.
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
      // Another admin promotes the target to 75 while invite is in flight.
      room.state.powerLevels = {
        ...room.state.powerLevels,
        users: { '@me:example.org': 100, '@mindroom_helper:example.org': 75 },
      };
      return {} as never;
    });

    typeUserId(renderer, '@mindroom_helper:example.org');
    await submitInvite(renderer);

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

    typeUserId(renderer, '@mindroom_helper:example.org');
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(true);
    await submitInvite(renderer);
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

    typeUserId(renderer, '@mindroom_helper:example.org');
    const allText = renderer.root
      .findAll((node) => typeof node.children?.[0] === 'string')
      .map((node) => node.children.join(''))
      .join(' ');
    expect(allText).toContain('Give Admin (100) rights');
    expect(allText).toContain('This room requires Admin (100) rights');
    expect(allText).not.toContain('Give Moderator rights');
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

    typeUserId(renderer, '@mindroom_helper:example.org');
    const allText = renderer.root
      .findAll((node) => typeof node.children?.[0] === 'string')
      .map((node) => node.children.join(''))
      .join(' ');
    expect(allText).toContain('Give Moderator (100) rights');
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
    typeUserId(rising.renderer, '@mindroom_helper:example.org');
    await submitInvite(rising.renderer);
    expect(rising.mx.setPowerLevel).not.toHaveBeenCalled();
    expect(textContent(rising.renderer, 'alert')).toContain(
      'This room now requires Moderator (100) rights.'
    );
  });

  it('keys the checkbox override to the trimmed target ID', () => {
    const { renderer } = renderPrompt();

    typeUserId(renderer, '@mindroom_first:example.org');
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(true);
    act(() => {
      findModeratorCheckbox(renderer)?.props.onClick();
    });
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(false);

    // Pasting a different eligible agent ID resets to default (ON).
    typeUserId(renderer, '@mindroom_second:example.org');
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(true);
  });

  it('publishes a non-blocking detached notice when a grant fails after the dialog closed', async () => {
    let finishInvite: () => void = () => undefined;
    const { renderer, mx, store } = renderPrompt();
    vi.mocked(mx.invite).mockImplementationOnce(
      () => new Promise((resolve) => (finishInvite = () => resolve({} as never)))
    );
    vi.mocked(mx.setPowerLevel).mockRejectedValueOnce(new Error('Forbidden'));

    typeUserId(renderer, '@mindroom_helper:example.org');
    act(() => {
      getForm(renderer).props.onSubmit({
        preventDefault: vi.fn(),
        target: { reasonInput: { value: '' } },
      });
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

    typeUserId(renderer, '@mindroom_helper:example.org');
    await submitInvite(renderer);

    expect(mx.invite).toHaveBeenCalledTimes(1);
    expect(mx.setPowerLevel).not.toHaveBeenCalled();
    expect(textContent(renderer, 'alert')).toContain('Team 75');
  });

  it('reports a changed requirement in a detached notice if the router level rises after the dialog closes', async () => {
    let finishInvite: () => void = () => undefined;
    const { renderer, mx, room, store } = renderPrompt();
    vi.mocked(mx.invite).mockImplementationOnce(
      () => new Promise((resolve) => (finishInvite = () => resolve({} as never)))
    );

    typeUserId(renderer, '@mindroom_helper:example.org');
    act(() => {
      getForm(renderer).props.onSubmit({
        preventDefault: vi.fn(),
        target: { reasonInput: { value: '' } },
      });
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

    typeUserId(renderer, '@mindroom_helper:example.org');
    await submitInvite(renderer);

    expect(mx.setPowerLevel).not.toHaveBeenCalled();
    expect(textContent(renderer, 'alert')).toContain("You don't have permission to do this.");
  });

  it.each([
    { label: 'v9 room', roomVersion: '9' },
    { label: 'unknown non-numeric room version', roomVersion: 'org.example.unstable' },
  ])('hides the moderator checkbox and skips member loading for a $label', ({ roomVersion }) => {
    const { renderer, room } = renderPrompt({ roomVersion, membersLoaded: false });
    typeUserId(renderer, '@mindroom_helper:example.org');
    expect(findModeratorCheckbox(renderer)).toBeUndefined();
    expect(room.loadMembersIfNeeded).not.toHaveBeenCalled();
    expect(room.getMembers).not.toHaveBeenCalled();
  });

  it('offers moderator rights in a v10 room', async () => {
    const { renderer, mx, room } = renderPrompt({ roomVersion: '10' });
    typeUserId(renderer, '@mindroom_helper:example.org');
    expect(findModeratorCheckbox(renderer)?.props.checked).toBe(true);
    await submitInvite(renderer);
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
