import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { config, toRem } from 'folds';

import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import {
  userDirectoryCacheAtom,
  type UserDirectoryCacheState,
} from '../userDirectoryCache';
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
  powerLevels?: Record<string, unknown>;
  createContent?: Record<string, unknown>;
  createSender?: string;
  members?: { userId: string; membership: string }[];
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

const makeMx = (getRoom: () => Room | null): MockMatrixClient => ({
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
  getRoom: vi.fn(getRoom) as unknown as MockMatrixClient['getRoom'],
  on: vi.fn() as unknown as MockMatrixClient['on'],
  removeListener: vi.fn() as unknown as MockMatrixClient['removeListener'],
});

const makeRoom = (mx: MockMatrixClient, options: RoomOptions = {}) => {
  const members = options.members ?? [];
  const powerEvent = makeStateEvent(options.powerLevels ?? defaultPowerLevels());
  const createEvent = options.createContent
    ? makeStateEvent(options.createContent, options.createSender)
    : undefined;
  return {
    roomId: '!room:example.org',
    client: mx,
    isSpaceRoom: () => options.isSpace ?? false,
    getMember: (userId: string) => members.find((member) => member.userId === userId) ?? null,
    getMembers: () => members,
    loadMembersIfNeeded: vi.fn(async () => true),
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (eventType: string) => {
          if (eventType === 'm.room.power_levels') return powerEvent;
          if (eventType === 'm.room.create') return createEvent;
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
  let room: ReturnType<typeof makeRoom> | undefined;
  const mx = makeMx(() => (room as unknown as Room) ?? null);
  room = makeRoom(mx, options);
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
      .map((node) => (Array.isArray(node.children) ? node.children.join('') : String(node.children)))
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
    expect(mx.setPowerLevel).toHaveBeenCalledWith(
      room.roomId,
      '@mindroom_helper:example.org',
      50
    );
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

    expect(mx.setPowerLevel).toHaveBeenCalledWith(
      room.roomId,
      '@mindroom_helper:example.org',
      75
    );
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
    expect(mx.setPowerLevel).toHaveBeenCalledWith(
      room.roomId,
      '@mindroom_helper:example.org',
      50
    );
    expect(getInput(renderer).props.value).toBe('');
    expect(textContent(renderer, 'status')).toContain('@mindroom_helper:example.org');
    expect(textContent(renderer, 'alert')).toContain('Forbidden');
  });
});
