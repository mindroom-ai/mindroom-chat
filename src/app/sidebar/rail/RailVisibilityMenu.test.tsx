// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { FocusTrap } from 'focus-trap-react';
import { color, type RectCords } from 'folds';
import { atom, createStore, Provider, useAtomValue } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchTab } from '../../command-palette/CommandPaletteSidebarTab';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { LONG_PRESS_MS } from '../../lib/hooks/useLongPress';
import { settingsModalAtom } from '../../navigation/settingsModal';
import { SettingsPages } from '../../navigation/settingsPages';
import {
  DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
  type AccountSettings,
} from '../../preferences/accountSettings';
import { makeNavToActivePathAtom } from '../../routes/navToActivePath';
import { NavToActivePathProvider } from '../../routes/useNavToActivePath';
import { RAIL_BUTTON_SETTING, type RailButtons } from '../../settings/railButtons';
import { DirectTab } from './DirectTab';
import { HelpTab } from './HelpTab';
import { RailVisibilityMenuProvider } from './RailVisibilityMenu';
import { useRailEmptyContextMenu, useRailVisibilityMenuTrigger } from './railVisibilityMenuContext';

const ALL_OFFERED: RailButtons = {
  direct: true,
  threads: true,
  canvases: true,
  usage: true,
  explore: true,
  createSpace: true,
  search: true,
  localMindroom: true,
  help: true,
};

const testSettingsAtom = atom<AccountSettings>(DEFAULT_MINDROOM_ACCOUNT_SETTINGS);
const navToActivePathAtom = makeNavToActivePathAtom('@alice:example.org');

const state = vi.hoisted(() => ({
  offered: {} as RailButtons,
  directRoomIds: ['!dm-1:example.org'],
  lastAnchor: undefined as RectCords | undefined,
  markRead: vi.fn(() => Promise.resolve()),
  setAccountSettings: vi.fn<(patch: Partial<AccountSettings>) => Promise<void>>(() =>
    Promise.resolve()
  ),
}));

vi.unmock('../../ui/glass/GlassPrimitives');

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  PopOut: ({ content, anchor }: { content: React.ReactNode; anchor?: RectCords }) => {
    state.lastAnchor = anchor;
    return anchor ? <div data-popout="open">{content}</div> : null;
  },
}));
vi.mock('focus-trap-react', async (original) => {
  const { FocusTrap: RealTrap } = await original<{ FocusTrap: typeof FocusTrap }>();
  return {
    FocusTrap: ({ focusTrapOptions, ...props }: React.ComponentProps<typeof FocusTrap>) => (
      <RealTrap
        {...props}
        focusTrapOptions={{ ...focusTrapOptions, tabbableOptions: { displayCheck: 'none' } }}
      />
    ),
  };
});
vi.mock('../../settings/railButtons', async (original) => ({
  ...(await original<typeof import('../../settings/railButtons')>()),
  useOfferedRailButtons: () => state.offered,
}));
vi.mock('../../matrix/hooks/useAccountSettings', () => ({
  useAccountSettings: () => useAtomValue(testSettingsAtom),
  useSetAccountSettings: () => state.setAccountSettings,
}));
vi.mock('../direct/useDirectRooms', () => ({
  useDirectRoomIds: () => state.directRoomIds,
}));
vi.mock('../../notifications/useMarkRoomsRead', () => ({
  useMarkRoomsRead: () => state.markRead,
}));
vi.mock('../../tour/useContextualTip', () => ({
  useContextualTip: () => ({ tip: undefined, dismissTip: vi.fn(), openTipTour: vi.fn() }),
}));
vi.mock('../../tour/HelpMenu', () => ({
  HelpMenu: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="help-menu">
      <button type="button" onClick={onClose}>
        Close help
      </button>
    </div>
  ),
}));

function RailInner() {
  const settings = useAtomValue(testSettingsAtom);
  const railProps = useRailEmptyContextMenu();
  const threadsProps = useRailVisibilityMenuTrigger('threads');
  const searchProps = useRailVisibilityMenuTrigger('search');
  return (
    <nav aria-label="Main" {...railProps}>
      <button type="button" aria-label="Home">
        Home
      </button>
      <DirectTab />
      {settings.showThreadsInSidebar && (
        <button type="button" aria-label="Threads" {...threadsProps}>
          Threads
        </button>
      )}
      <SearchTab contextMenuProps={searchProps} />
      <HelpTab />
      <HelpTab inTopBar />
      <div data-testid="empty-rail" />
    </nav>
  );
}

const wrap = (
  store: ReturnType<typeof createStore>,
  screenSize: ScreenSize,
  children: React.ReactNode
) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={['/home/']}>
      <NavToActivePathProvider value={navToActivePathAtom}>
        <ScreenSizeProvider value={screenSize}>{children}</ScreenSizeProvider>
      </NavToActivePathProvider>
    </MemoryRouter>
  </Provider>
);

const renderRail = (screenSize = ScreenSize.Desktop) => {
  const store = createStore();
  store.set(testSettingsAtom, {
    ...DEFAULT_MINDROOM_ACCOUNT_SETTINGS,
    showDirectInSidebar: true,
    showThreadsInSidebar: true,
    showSearchInSidebar: true,
    showHelpInSidebar: true,
  });
  state.offered = { ...ALL_OFFERED };
  state.directRoomIds = ['!dm-1:example.org'];
  state.lastAnchor = undefined;
  state.markRead.mockReset().mockResolvedValue(undefined);
  state.setAccountSettings.mockReset().mockImplementation(async (patch) => {
    store.set(testSettingsAtom, { ...store.get(testSettingsAtom), ...patch });
  });
  const view = render(
    wrap(
      store,
      screenSize,
      <RailVisibilityMenuProvider>
        <RailInner />
      </RailVisibilityMenuProvider>
    )
  );
  return { store, ...view };
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('RailVisibilityMenu', () => {
  it('lists offered buttons in rail order, omits unoffered/mobile-search items, and toggles on repeat right-click', () => {
    const { store, rerender } = renderRail();
    const threads = screen.getByRole('button', { name: 'Threads' });
    fireEvent.contextMenu(threads);

    const menu = screen.getByRole('menu');
    expect(threads.getAttribute('data-menu-open')).toBe('true');
    expect(within(menu).queryByRole('menuitem', { name: 'Mark as Read' })).toBeNull();
    const group = within(menu).getByRole('group', { name: 'Show in sidebar' });
    expect(
      within(group)
        .getAllByRole('menuitemcheckbox')
        .map((row) => row.textContent)
    ).toEqual([
      'Direct Messages',
      'Threads',
      'Canvases',
      'Usage',
      'Explore Community',
      'Create Space',
      'Search',
      'Local MindRoom',
      'Help & guides',
    ]);
    expect(within(menu).getByRole('menuitem', { name: 'Sidebar settings…' })).toBeTruthy();

    fireEvent.contextMenu(threads);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(threads.getAttribute('data-menu-open')).toBeNull();

    state.offered = {
      ...ALL_OFFERED,
      canvases: false,
      explore: false,
      createSpace: false,
      localMindroom: false,
    };
    rerender(
      wrap(
        store,
        ScreenSize.Mobile,
        <RailVisibilityMenuProvider>
          <RailInner />
        </RailVisibilityMenuProvider>
      )
    );
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Threads' }));
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitemcheckbox')
        .map((row) => row.textContent)
    ).toEqual(['Direct Messages', 'Threads', 'Usage', 'Help & guides']);
  });

  it('shows Mark as Read only for Direct Messages inside the rail and preserves standalone fallback', () => {
    const { store, unmount } = renderRail();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Direct Messages' }));
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as Read' }));
    expect(state.markRead).toHaveBeenCalledWith(['!dm-1:example.org']);
    expect(screen.queryByRole('menu')).toBeNull();

    // Outside RailVisibilityMenuProvider, DirectTab falls back to SectionTab's local menu.
    unmount();
    render(wrap(store, ScreenSize.Desktop, <DirectTab />));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Direct Messages' }));
    expect(screen.getByRole('menuitem', { name: 'Mark as Read' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Show in sidebar' })).toBeNull();
  });

  it('stays open when toggling off the right-clicked button and snaps back on save failure', async () => {
    const { store } = renderRail();
    let resolveWrite!: () => void;
    let rejectNext = false;
    state.setAccountSettings.mockImplementation((patch) => {
      if (rejectNext) return Promise.reject(new Error('offline'));
      return new Promise<void>((resolve) => {
        resolveWrite = () => {
          store.set(testSettingsAtom, { ...store.get(testSettingsAtom), ...patch });
          resolve();
        };
      });
    });

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Threads' }));
    const threadsSwitch = within(screen.getByRole('menu')).getByRole('menuitemcheckbox', {
      name: 'Threads',
    });
    expect(threadsSwitch.getAttribute('aria-checked')).toBe('true');

    // Optimistic flip happens immediately before the write settles.
    fireEvent.click(threadsSwitch);
    expect(threadsSwitch.getAttribute('aria-checked')).toBe('false');
    expect(state.setAccountSettings).toHaveBeenCalledWith({
      [RAIL_BUTTON_SETTING.threads]: false,
    });

    await act(async () => {
      resolveWrite();
      await Promise.resolve();
    });

    // Threads rail icon unmounted, yet the context menu stayed open.
    expect(screen.queryByRole('button', { name: 'Threads' })).toBeNull();
    expect(screen.getByRole('menu')).toBeTruthy();

    // A rejected write snaps back to the stored value and displays the critical error message.
    rejectNext = true;
    await act(async () => {
      fireEvent.click(threadsSwitch);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(threadsSwitch.getAttribute('aria-checked')).toBe('false');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(
      'Could not save the change. Check your connection and try again.'
    );
    expect(alert.style.color).toBe(color.Critical.Main);
  });

  it('opens Settings on SidebarPage with a fresh requestId and closes the menu', () => {
    const { store } = renderRail();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Threads' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sidebar settings…' }));
    expect(screen.queryByRole('menu')).toBeNull();
    const first = store.get(settingsModalAtom);
    expect(first?.initialPage).toBe(SettingsPages.SidebarPage);
    expect(first?.requestId).toBeTruthy();

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Threads' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sidebar settings…' }));
    const second = store.get(settingsModalAtom);
    expect(second?.initialPage).toBe(SettingsPages.SidebarPage);
    expect(second?.requestId).not.toBe(first?.requestId);
  });

  it('opens from empty rail space at click height while leaving non-configurable buttons untouched', () => {
    renderRail();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    nav.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 66, bottom: 800, width: 66, height: 800 }) as DOMRect;

    const homeEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    screen.getByRole('button', { name: 'Home' }).dispatchEvent(homeEvent);
    expect(homeEvent.defaultPrevented).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.contextMenu(screen.getByTestId('empty-rail'), { clientX: 20, clientY: 312 });
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(state.lastAnchor).toEqual({ x: 0, y: 312, width: 66, height: 0 });
    expect(screen.queryByRole('menuitem', { name: 'Mark as Read' })).toBeNull();
  });

  it('supports touch long-press, SearchTab contextMenuProps, and HelpTab rail vs top bar rules', async () => {
    vi.useFakeTimers();
    renderRail();

    const threads = screen.getByRole('button', { name: 'Threads' });
    fireEvent.touchStart(threads, { touches: [{ clientX: 30, clientY: 120 }] });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(screen.getByRole('menu')).toBeTruthy();
    const touchContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    Object.defineProperty(touchContext, 'pointerType', { value: 'touch' });
    act(() => {
      threads.dispatchEvent(touchContext);
    });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    const search = screen.getByRole('button', { name: 'Open command palette' });
    fireEvent.contextMenu(search);
    expect(search.getAttribute('data-menu-open')).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });

    vi.useRealTimers();
    const [railHelp, topBarHelp] = screen.getAllByRole('button', { name: 'Help & guides' });
    fireEvent.click(railHelp!);
    await vi.waitFor(() => expect(screen.getByTestId('help-menu')).toBeTruthy());
    expect(railHelp!.getAttribute('data-menu-open')).toBe('true');

    fireEvent.contextMenu(railHelp!);
    expect(screen.queryByTestId('help-menu')).toBeNull();
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(railHelp!.getAttribute('data-menu-open')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(railHelp!.getAttribute('data-menu-open')).toBeNull();

    const topBarEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    topBarHelp!.dispatchEvent(topBarEvent);
    expect(topBarEvent.defaultPrevented).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
