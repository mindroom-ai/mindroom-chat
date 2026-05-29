import { readFileSync } from 'node:fs';
import React, { useState } from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';

import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import {
  INVITE_SERVER_SEARCH_LIMIT,
  userDirectoryCacheAtom,
  type ServerUserDirectoryUser,
  type UserDirectoryCacheState,
} from '../../state/userDirectoryCache';
import { InviteUserAutocomplete } from './InviteUserAutocomplete';

const directUsersMock = vi.hoisted(() => ({
  users: [] as string[],
}));

type WindowKeyHandler = (event: KeyboardEvent) => void;
const windowListeners = new Map<string, Set<WindowKeyHandler>>();

vi.mock('focus-trap-react', () => ({
  default: ({
    active,
    children,
    focusTrapOptions,
  }: {
    active?: boolean;
    children?: React.ReactNode;
    focusTrapOptions?: Record<string, unknown>;
  }) => React.createElement('div', { 'data-focus-trap': true, active, focusTrapOptions }, children),
}));

vi.mock('./InviteAutocompleteMenu.css', () => ({
  InviteAutocompleteMenuRoot: 'InviteAutocompleteMenuRoot',
  InviteAutocompleteMenuAnchor: 'InviteAutocompleteMenuAnchor',
  InviteAutocompleteMenuContainer: 'InviteAutocompleteMenuContainer',
  InviteAutocompleteMenu: 'InviteAutocompleteMenu',
  InviteAutocompleteMenuHeader: 'InviteAutocompleteMenuHeader',
  InviteAutocompleteOption: 'InviteAutocompleteOption',
  InviteAutocompleteIdentity: 'InviteAutocompleteIdentity',
  InviteAutocompleteDisplayName: 'InviteAutocompleteDisplayName',
  InviteAutocompleteUserId: 'InviteAutocompleteUserId',
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../hooks/useDirectUsers', () => ({
  useDirectUsers: () => directUsersMock.users,
}));

vi.mock('../user-avatar', () => ({
  UserAvatar: ({ userId, src, alt }: { userId: string; src?: string; alt?: string }) =>
    React.createElement('span', { 'data-user-id': userId, 'data-src': src, 'data-alt': alt }),
}));

type MockMatrixClient = Pick<
  MatrixClient,
  'baseUrl' | 'getSafeUserId' | 'getHomeserverUrl' | 'mxcUrlToHttp' | 'searchUserDirectory'
>;

type RenderOptions = {
  cacheState?: UserDirectoryCacheState;
  disabled?: boolean;
  initialValue?: string;
  mx?: MockMatrixClient;
  room?: Pick<Room, 'getMember'>;
  autoFocus?: boolean;
  onInputChange?: (value: string) => void;
  onSelect?: (userId: string) => void;
};

const readyCache = (
  users: ServerUserDirectoryUser[],
  ownerKey = '@me:example.org|https://example.org'
): UserDirectoryCacheState => ({
  users,
  status: 'ready',
  fetchedAt: Date.now(),
  limited: false,
  isBootstrapOnly: false,
  ownerKey,
});

const makeMx = (): MockMatrixClient => ({
  baseUrl: 'https://example.org',
  getSafeUserId: vi.fn(() => '@me:example.org'),
  getHomeserverUrl: vi.fn(() => 'https://example.org'),
  mxcUrlToHttp: vi.fn((mxcUrl: string) => `https://example.org/media/${mxcUrl}`),
  searchUserDirectory: vi.fn(async () => ({
    limited: false,
    results: [],
  })),
});

const makeRoom = (): Pick<Room, 'getMember'> => ({
  getMember: () => null,
});

function ControlledAutocomplete({
  disabled,
  room,
  initialValue,
  onInputChange,
  onSelect,
}: {
  disabled?: boolean;
  room: Pick<Room, 'getMember'>;
  initialValue: string;
  onInputChange?: (value: string) => void;
  onSelect: (userId: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <InviteUserAutocomplete
      room={room as Room}
      inputValue={value}
      onInputChange={(nextValue) => {
        onInputChange?.(nextValue);
        setValue(nextValue);
      }}
      onSelect={(userId) => {
        setValue(userId);
        onSelect(userId);
      }}
      disabled={disabled}
    />
  );
}

const renderAutocomplete = ({
  cacheState = readyCache([]),
  disabled,
  initialValue = '',
  mx = makeMx(),
  room = makeRoom(),
  autoFocus = true,
  onInputChange,
  onSelect = vi.fn(),
}: RenderOptions = {}) => {
  const store = createStore();
  store.set(userDirectoryCacheAtom, cacheState);

  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(
      <Provider store={store}>
        <MatrixClientProvider value={mx as MatrixClient}>
          <ControlledAutocomplete
            disabled={disabled}
            room={room}
            initialValue={initialValue}
            onInputChange={onInputChange}
            onSelect={onSelect}
          />
        </MatrixClientProvider>
      </Provider>
    );
  });
  if (autoFocus) {
    act(() => {
      getInput(renderer!).props.onFocus();
    });
  }

  return {
    renderer: renderer!,
    mx,
    onSelect,
  };
};

const getInput = (renderer: ReactTestRenderer) => renderer.root.findByProps({ role: 'combobox' });

const getOptions = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === 'button' && node.props.role === 'option');

const getFocusTrap = (renderer: ReactTestRenderer) =>
  renderer.root.findByProps({ 'data-focus-trap': true });

const blurInput = (renderer: ReactTestRenderer) => {
  act(() => {
    getInput(renderer).props.onBlur();
  });
};

const changeInput = (renderer: ReactTestRenderer, value: string) => {
  act(() => {
    getInput(renderer).props.onChange({
      currentTarget: { value },
    });
  });
};

const keyDown = (renderer: ReactTestRenderer, key: string, event: Partial<KeyboardEvent> = {}) => {
  let defaultPrevented = false;
  const preventDefault = vi.fn(() => {
    defaultPrevented = true;
  });
  const stopPropagation = vi.fn();
  const keyboardEvent = {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault,
    stopPropagation,
    ...event,
  } as KeyboardEvent;
  Object.defineProperty(keyboardEvent, 'defaultPrevented', {
    get: () => defaultPrevented,
  });

  act(() => {
    getInput(renderer).props.onKeyDown(keyboardEvent);
    windowListeners.get('keydown')?.forEach((handler) => handler(keyboardEvent));
  });

  return { preventDefault, stopPropagation };
};

const optionKeyDown = (
  renderer: ReactTestRenderer,
  option: ReturnType<typeof getOptions>[number],
  key: string
) => {
  let defaultPrevented = false;
  const preventDefault = vi.fn(() => {
    defaultPrevented = true;
  });
  const stopPropagation = vi.fn();
  const keyboardEvent = {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault,
    stopPropagation,
  } as KeyboardEvent;
  Object.defineProperty(keyboardEvent, 'defaultPrevented', {
    get: () => defaultPrevented,
  });

  act(() => {
    option.props.onKeyDown(keyboardEvent);
    windowListeners.get('keydown')?.forEach((handler) => handler(keyboardEvent));
  });

  return { preventDefault, stopPropagation };
};

const originalWindow = globalThis.window;

beforeEach(() => {
  vi.useFakeTimers();
  directUsersMock.users = [];
  windowListeners.clear();
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
  vi.useRealTimers();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

describe('InviteUserAutocomplete', () => {
  it('renders avatar-backed suggestions with stable option ids', () => {
    const mx = makeMx();
    const { renderer } = renderAutocomplete({
      cacheState: readyCache([
        {
          userId: '@alice:example.org',
          displayName: 'Alice Adams',
          avatarMxcUrl: 'mxc://example.org/alice',
        },
      ]),
      initialValue: 'ali',
      mx,
    });

    const [option] = getOptions(renderer);

    expect(option.props.id).toBe('invite-autocomplete-option-_40alice_3Aexample.org');
    expect(option.props['data-focus']).toBe(true);
    expect(renderer.root.findByProps({ 'data-user-id': '@alice:example.org' }).props).toMatchObject(
      {
        'data-src': 'https://example.org/media/mxc://example.org/alice',
        'data-alt': 'Alice Adams',
      }
    );
    expect(mx.mxcUrlToHttp).toHaveBeenCalledWith(
      'mxc://example.org/alice',
      32,
      32,
      'crop',
      undefined,
      undefined,
      false
    );
  });

  it('keeps long matching user identities readable inside each suggestion row', () => {
    const userId = '@mindroom_assistant_829sujms:mindroom.example.org';
    const displayName = 'MindRoom Assistant 829';
    const { renderer } = renderAutocomplete({
      cacheState: readyCache([
        {
          userId,
          displayName,
        },
      ]),
      initialValue: 'mind',
    });

    const [option] = getOptions(renderer);
    const displayNameNode = renderer.root.findByProps({ title: displayName });
    const userIdNode = renderer.root.findByProps({ title: userId });

    expect(option.props['aria-label']).toBe(`${displayName}, ${userId}`);
    expect(option.props['data-ui-after']).toBeUndefined();
    expect(displayNameNode.props.children).toBe(displayName);
    expect(userIdNode.props.children).toBe(userId);
    expect(userIdNode.props.truncate).toBeUndefined();
  });

  it('does not duplicate the MXID in the option label when it is also the display name', () => {
    const userId = '@mindroom_assistant:mindroom.chat';
    const { renderer } = renderAutocomplete({
      cacheState: readyCache([
        {
          userId,
          displayName: userId,
        },
      ]),
      initialValue: 'mind',
    });

    const [option] = getOptions(renderer);

    expect(option.props['aria-label']).toBe(userId);
  });

  it('falls back from a whitespace-only display name before labeling the option', () => {
    const userId = '@space:example.org';
    const { renderer } = renderAutocomplete({
      cacheState: readyCache([
        {
          userId,
          displayName: '   ',
        },
      ]),
      initialValue: 'space',
    });

    const [option] = getOptions(renderer);
    const displayNameNode = renderer.root.findByProps({ title: 'space' });

    expect(option.props['aria-label']).toBe(`space, ${userId}`);
    expect(displayNameNode.props.children).toBe('space');
  });

  it('keeps the suggestion popup anchored inside the input bounds', () => {
    const cssSource = readFileSync(new URL('./InviteAutocompleteMenu.css.ts', import.meta.url), {
      encoding: 'utf8',
    });

    expect(cssSource).toContain('left: 0');
    expect(cssSource).toContain('right: 0');
    expect(cssSource).not.toContain("left: '50%'");
    expect(cssSource).not.toContain('translateX(-50%)');
  });

  it('moves the active row with arrows and commits it with Enter', () => {
    const onSelect = vi.fn();
    const { renderer } = renderAutocomplete({
      cacheState: readyCache([
        { userId: '@alpha:example.org', displayName: 'Alpha' },
        { userId: '@alpine:example.org', displayName: 'Alpine' },
      ]),
      initialValue: 'alp',
      onSelect,
    });

    expect(getInput(renderer).props['aria-activedescendant']).toBe(
      'invite-autocomplete-option-_40alpha_3Aexample.org'
    );

    keyDown(renderer, 'ArrowDown');

    expect(getInput(renderer).props['aria-activedescendant']).toBe(
      'invite-autocomplete-option-_40alpine_3Aexample.org'
    );

    const { preventDefault } = keyDown(renderer, 'Enter');

    expect(preventDefault).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith('@alpine:example.org');
  });

  it('leaves native caret arrow keys alone and only captures vertical arrows while the menu is open', () => {
    const { renderer } = renderAutocomplete({
      cacheState: readyCache([{ userId: '@alice:example.org', displayName: 'Alice Adams' }]),
      initialValue: '@alice:example.org',
    });

    expect(getInput(renderer).props['aria-expanded']).toBe(true);
    expect(keyDown(renderer, 'ArrowLeft').preventDefault).not.toHaveBeenCalled();
    expect(keyDown(renderer, 'ArrowRight').preventDefault).not.toHaveBeenCalled();
    expect(keyDown(renderer, 'ArrowUp').preventDefault).toHaveBeenCalled();
    expect(keyDown(renderer, 'ArrowDown').preventDefault).toHaveBeenCalled();

    blurInput(renderer);

    expect(getInput(renderer).props['aria-expanded']).toBe(false);
    expect(keyDown(renderer, 'ArrowUp').preventDefault).not.toHaveBeenCalled();
    expect(keyDown(renderer, 'ArrowDown').preventDefault).not.toHaveBeenCalled();
  });

  it('commits a focused option once without also committing the active row', () => {
    const onSelect = vi.fn();
    const { renderer } = renderAutocomplete({
      cacheState: readyCache([
        { userId: '@alpha:example.org', displayName: 'Alpha' },
        { userId: '@alpine:example.org', displayName: 'Alpine' },
      ]),
      initialValue: 'alp',
      onSelect,
    });

    keyDown(renderer, 'ArrowDown');
    optionKeyDown(renderer, getOptions(renderer)[0], 'Enter');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('@alpha:example.org');
  });

  it('commits the active row with Tab but leaves a literal @ alone', () => {
    const onSelect = vi.fn();
    const { renderer } = renderAutocomplete({
      cacheState: readyCache([{ userId: '@tab:example.org', displayName: 'Tabitha' }]),
      initialValue: 'tab',
      onSelect,
    });

    const tabCommit = keyDown(renderer, 'Tab');

    expect(tabCommit.preventDefault).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith('@tab:example.org');
  });

  it('lets Shift+Tab move focus backward without committing suggestions', () => {
    const onSelect = vi.fn();
    const { renderer } = renderAutocomplete({
      cacheState: readyCache([{ userId: '@tab:example.org', displayName: 'Tabitha' }]),
      initialValue: 'tab',
      onSelect,
    });

    const { preventDefault } = keyDown(renderer, 'Tab', { shiftKey: true });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(getOptions(renderer)).toHaveLength(0);
    expect(getInput(renderer).props['aria-expanded']).toBe(false);
  });

  it('closes the listbox on Escape from the input', () => {
    const { renderer } = renderAutocomplete({
      cacheState: readyCache([{ userId: '@escape:example.org', displayName: 'Escape User' }]),
      initialValue: 'escape',
    });

    const { preventDefault, stopPropagation } = keyDown(renderer, 'Escape');

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(getInput(renderer).props['aria-expanded']).toBe(false);
    expect(getOptions(renderer)).toHaveLength(0);
  });

  it('closes through the InviteAutocompleteMenu requestClose contract until the value changes', () => {
    const { renderer } = renderAutocomplete({
      cacheState: readyCache([{ userId: '@close:example.org', displayName: 'Close User' }]),
      initialValue: 'close',
    });

    act(() => {
      getFocusTrap(renderer).props.focusTrapOptions.onPostDeactivate();
    });

    expect(getInput(renderer).props['aria-expanded']).toBe(false);
    expect(getOptions(renderer)).toHaveLength(0);

    changeInput(renderer, 'clos');

    expect(getInput(renderer).props['aria-expanded']).toBe(true);
    expect(getOptions(renderer)).toHaveLength(1);
  });

  it('keeps keyboard navigation ownership out of the focus trap', () => {
    const { renderer } = renderAutocomplete({
      cacheState: readyCache([{ userId: '@arrow:example.org', displayName: 'Arrow User' }]),
      initialValue: 'arrow',
    });

    expect(
      getFocusTrap(renderer).props.focusTrapOptions.isKeyForward({ key: 'Tab' } as KeyboardEvent)
    ).toBe(false);
    expect(
      getFocusTrap(renderer).props.focusTrapOptions.isKeyBackward({
        key: 'ArrowUp',
      } as KeyboardEvent)
    ).toBe(false);
  });

  it('closes without intercepting focus movement when Tab follows a valid MXID', () => {
    const { renderer } = renderAutocomplete({
      cacheState: readyCache([
        { userId: '@suggestion:example.org', displayName: '@alice:example.org' },
      ]),
      initialValue: '@alice:example.org',
    });

    expect(getOptions(renderer)).toHaveLength(1);

    const { preventDefault } = keyDown(renderer, 'Tab');

    expect(preventDefault).not.toHaveBeenCalled();
    expect(getOptions(renderer)).toHaveLength(0);
  });

  it('does not reopen when async suggestions arrive after the input blurs', async () => {
    const mx = makeMx();
    vi.mocked(mx.searchUserDirectory).mockResolvedValue({
      limited: false,
      results: [{ user_id: '@late:example.org', display_name: 'Late User' }],
    });
    const { renderer } = renderAutocomplete({
      cacheState: readyCache([]),
      mx,
    });

    changeInput(renderer, 'late');
    blurInput(renderer);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mx.searchUserDirectory).toHaveBeenCalledWith({
      term: 'late',
      limit: INVITE_SERVER_SEARCH_LIMIT,
    });
    expect(getInput(renderer).props['aria-expanded']).toBe(false);
    expect(getOptions(renderer)).toHaveLength(0);
  });
});
