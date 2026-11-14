import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPaletteRenderer } from './CommandPaletteRenderer';
import { commandPaletteOpenAtom } from './commandPaletteState';
import type { CommandPaletteTab } from './commandPaletteTypes';

const { hotkeyState, screenSizeState, sourceState, useCommandPaletteSourceMock } = vi.hoisted(() => {
  const state = {
    logoutAction: false,
  };
  const screenSize = {
    value: 'Desktop',
  };

  return {
    hotkeyState: {
      apple: false,
      matcher: undefined as ((event: KeyboardEvent) => boolean) | undefined,
    },
    screenSizeState: screenSize,
    sourceState: state,
    useCommandPaletteSourceMock: vi.fn((options?: { onLogout?: () => void }) => ({
      actions: state.logoutAction
        ? [
            {
              id: 'logout',
              kind: 'action',
              title: 'Logout',
              onSelect: options?.onLogout,
            },
          ]
        : [
            {
              id: 'action-settings',
              kind: 'action',
              title: 'Open Settings',
            },
          ],
      threads: [],
      rooms: [],
      getUsers: () => [],
    })),
  };
});

afterEach(() => {
  hotkeyState.apple = false;
  screenSizeState.value = 'Desktop';
  sourceState.logoutAction = false;
  useCommandPaletteSourceMock.mockClear();
});

vi.mock('../lib/user-agent', () => ({
  isMacOS: () => hotkeyState.apple,
  isIOS: () => false,
}));

vi.mock('./commandPaletteItems', () => ({
  useCommandPaletteSource: useCommandPaletteSourceMock,
}));

vi.mock('./useCommandPaletteMessages', () => ({
  useCommandPaletteMessages: () => ({
    status: 'idle',
    items: [],
    encryptedRooms: false,
    openSearchPage: () => undefined,
  }),
}));

vi.mock('./useCommandPalettePeople', () => ({
  useCommandPalettePeople: () => ({ status: 'idle', items: [] }),
}));

vi.mock('./useCommandPaletteHotkey', () => ({
  useCommandPaletteHotkey: (
    _opened: boolean,
    _setOpen: unknown,
    matcher: (event: KeyboardEvent) => boolean
  ) => {
    hotkeyState.matcher = matcher;
  },
}));

vi.mock('../lib/hooks/useScreenSize', () => ({
  ScreenSize: {
    Desktop: 'Desktop',
    Tablet: 'Tablet',
    Mobile: 'Mobile',
  },
  useScreenSizeContext: () => screenSizeState.value,
}));

vi.mock('focus-trap-react', async () => {
  const reactModule = await import('react');
  return {
    default: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', { 'data-testid': 'focus-trap' }, children),
  };
});

vi.mock('../account/LogoutDialog', async () => {
  const reactModule = await import('react');
  return {
    LogoutDialog: ({ handleClose }: { handleClose: () => void }) =>
      reactModule.createElement(
        'button',
        {
          'data-testid': 'logout-dialog',
          onClick: handleClose,
        },
        'logout'
      ),
  };
});

vi.mock('folds', async () => {
  const reactModule = await import('react');
  return {
    toRem: (value: number) => `${value / 16}rem`,
    Overlay: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', { 'data-testid': 'overlay' }, children),
    OverlayBackdrop: () => reactModule.createElement('div', { 'data-testid': 'backdrop' }),
    OverlayCenter: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', { 'data-testid': 'overlay-center' }, children),
    Modal: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
      reactModule.createElement('div', { 'data-testid': 'modal', ...props }, children),
    Box: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
      reactModule.createElement('div', props, children),
    Input: ({
      value,
      onChange,
      onKeyDown,
      ...props
    }: React.InputHTMLAttributes<HTMLInputElement>) =>
      reactModule.createElement('input', { value, onChange, onKeyDown, ...props }),
    Scroll: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', { 'data-testid': 'scroll' }, children),
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    Line: () => reactModule.createElement('hr'),
    IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      reactModule.createElement('button', props, children),
    Icon: ({ src, ...props }: React.HTMLAttributes<HTMLSpanElement> & { src?: string }) =>
      reactModule.createElement('span', { ...props, 'data-icon-src': src }),
    Spinner: () => null,
    Icons: {
      Cross: 'cross',
      Terminal: 'terminal',
      Message: 'message',
      Hash: 'hash',
      Space: 'space',
      User: 'user',
      Search: 'search',
    },
    color: {
      Warning: { Main: 'warning-main' },
      Primary: { Main: 'primary-main' },
      Success: { Main: 'success-main' },
      Secondary: { Main: 'secondary-main' },
      SurfaceVariant: {
        OnContainer: 'surface-variant-on-container',
        ContainerHover: 'surface-variant-container-hover',
      },
    },
    config: {
      space: {
        S400: '16px',
      },
      radii: {
        R400: '0.75rem',
      },
    },
  };
});

vi.mock('react-aria', async () => {
  const reactModule = await import('react');
  return {
    FocusScope: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', { 'data-testid': 'focus-scope' }, children),
    mergeProps: (...props: Record<string, unknown>[]) => Object.assign({}, ...props),
    useDialog: () => ({
      dialogProps: {
        'data-testid': 'command-palette-dialog',
      },
    }),
    useOverlay: ({ onClose }: { onClose: () => void }) => ({
      overlayProps: {
        onKeyDown: (event: { key: string }) => {
          if (event.key === 'Escape') onClose();
        },
      },
    }),
    usePreventScroll: () => undefined,
  };
});

vi.mock('./CommandPalette.css', () => ({
  Shell: 'Shell',
  Backdrop: 'Backdrop',
  Palette: 'Palette',
  Search: 'Search',
  Input: 'Input',
  Close: 'Close',
  Tabs: 'Tabs',
  Tab: 'Tab',
  ClearSearch: 'ClearSearch',
  Results: 'Results',
  Group: 'Group',
  GroupTitle: 'GroupTitle',
  GroupCount: 'GroupCount',
  Row: 'Row',
  RowIcon: 'RowIcon',
  RowText: 'RowText',
  RowHeading: 'RowHeading',
  RowTitle: 'RowTitle',
  RowPlace: 'RowPlace',
  RowTime: 'RowTime',
  Tag: 'Tag',
  Match: 'Match',
  Note: 'Note',
  RowDescription: 'RowDescription',
  RowEnter: 'RowEnter',
  Key: 'Key',
  Footer: 'Footer',
  KeyboardHints: 'KeyboardHints',
  Hint: 'Hint',
  Empty: 'Empty',
  EmptyTitle: 'EmptyTitle',
  EmptyDescription: 'EmptyDescription',
}));

const renderRenderer = (open: CommandPaletteTab | undefined) => {
  const store = createStore();
  store.set(commandPaletteOpenAtom, open);
  const renderer = create(
    React.createElement(Provider, { store }, React.createElement(CommandPaletteRenderer))
  );

  return { renderer, store };
};

const findCloseButtons = (renderer: ReturnType<typeof create>) =>
  renderer.root.findAll(
    (node) => node.type === 'button' && node.props['aria-label'] === 'Close command palette'
  );

describe('CommandPaletteRenderer', () => {
  it('renders nothing while the shared open atom is unset', () => {
    const { renderer } = renderRenderer(undefined);

    expect(useCommandPaletteSourceMock).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ 'data-testid': 'overlay' })).toHaveLength(0);
  });

  it('renders the dialog shell while the shared open atom names a tab', () => {
    const { renderer } = renderRenderer('all');
    const modal = renderer.root.findByProps({ 'data-testid': 'modal' });

    expect(useCommandPaletteSourceMock).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ 'data-testid': 'overlay' })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ 'data-testid': 'command-palette-dialog' })).toHaveLength(
      1
    );
    expect(modal.props.flexHeight).toBe(true);
  });

  it('uses a rounded mobile bottom-sheet layout with dynamic viewport units', () => {
    screenSizeState.value = 'Mobile';
    const { renderer } = renderRenderer('all');
    const modal = renderer.root.findByProps({ 'data-testid': 'modal' });
    const sheetContainer = renderer.root.find(
      (node) =>
        node.type === 'div' &&
        node.props.style?.minHeight === '100svh' &&
        node.props.style?.height === '100dvh'
    );

    expect(modal.props.style).toEqual({
      borderRadius: '0.75rem',
      height: 'min(85svh, 700px)',
      maxHeight: 'min(85svh, 700px)',
      maxWidth: '100vw',
      width: '100vw',
    });
    expect(sheetContainer.props.style).toMatchObject({
      flexDirection: 'column',
      justifyContent: 'flex-end',
    });
    expect(findCloseButtons(renderer)).toHaveLength(1);
    expect(JSON.stringify(modal.props.style)).not.toContain('100vh');
  });

  it('closes from the mobile header close button', async () => {
    screenSizeState.value = 'Mobile';
    const { renderer, store } = renderRenderer('all');

    await act(async () => {
      findCloseButtons(renderer)[0]!.props.onClick();
    });

    expect(store.get(commandPaletteOpenAtom)).toBeUndefined();
  });

  it('resets local query state after close and reopen', async () => {
    const { renderer, store } = renderRenderer('all');
    const getInput = () => renderer.root.findByType('input');
    const getDialog = () => renderer.root.findByProps({ 'data-testid': 'command-palette-dialog' });

    await act(async () => {
      getInput().props.onChange({
        currentTarget: {
          value: '@alice',
        },
      });
    });

    expect(getInput().props.value).toBe('@alice');

    await act(async () => {
      getDialog().props.onKeyDown({
        key: 'Escape',
      });
    });

    expect(store.get(commandPaletteOpenAtom)).toBeUndefined();

    await act(async () => {
      store.set(commandPaletteOpenAtom, 'all');
    });

    expect(getInput().props.value).toBe('');
  });

  it('opens the logout confirmation after selecting the logout action', async () => {
    sourceState.logoutAction = true;
    const { renderer, store } = renderRenderer('all');
    const input = renderer.root.findByType('input');

    await act(async () => {
      input.props.onKeyDown({
        key: 'Enter',
        preventDefault: vi.fn(),
      });
    });

    expect(store.get(commandPaletteOpenAtom)).toBeUndefined();
    expect(renderer.root.findAllByProps({ 'data-testid': 'logout-dialog' })).toHaveLength(1);
  });

  it('opens with the modifier its label names, where the user agent says Mac and the platform does not', () => {
    renderRenderer(undefined);
    const press = (modifier: 'metaKey' | 'ctrlKey') =>
      hotkeyState.matcher?.({
        key: 'k',
        code: 'KeyK',
        altKey: false,
        shiftKey: false,
        metaKey: modifier === 'metaKey',
        ctrlKey: modifier === 'ctrlKey',
      } as KeyboardEvent);
    expect(press('ctrlKey')).toBe(true);
    expect(press('metaKey')).toBe(false);
    hotkeyState.apple = true;
    expect(press('metaKey')).toBe(true);
    expect(press('ctrlKey')).toBe(false);
  });

  it('opens on the tab the atom names, such as Messages from the search shortcut', () => {
    const { renderer } = renderRenderer('messages');
    const selected = renderer.root.findAll(
      (node) => node.props.role === 'tab' && node.props['aria-selected'] === true
    );
    expect(selected.map((tab) => tab.props['data-tab'])).toEqual(['messages']);
  });
});
