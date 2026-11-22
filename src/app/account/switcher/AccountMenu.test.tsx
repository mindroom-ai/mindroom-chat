// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type FocusTrap from 'focus-trap-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredSession } from '../../matrix/session/sessions';
import { AccountMenu, type AccountMenuAccount } from './AccountMenu';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  PopOut: ({
    content,
    position,
    anchor,
  }: {
    content: React.ReactNode;
    position?: string;
    anchor?: DOMRect;
  }) => (
    <div data-popout-position={position} data-popout-anchor={`${anchor?.left},${anchor?.top}`}>
      {content}
    </div>
  ),
}));
vi.mock('../../avatars/UserAvatar', () => ({
  UserAvatar: ({ alt }: { alt: string }) => <span data-avatar={alt} />,
}));
// jsdom lays nothing out, so every element counts as shown for the trap.
vi.mock('focus-trap-react', async (original) => {
  const { default: RealTrap } = await original<{ default: typeof FocusTrap }>();
  return {
    default: ({ focusTrapOptions, ...props }: React.ComponentProps<typeof FocusTrap>) => (
      <RealTrap
        {...props}
        focusTrapOptions={{ ...focusTrapOptions, tabbableOptions: { displayCheck: 'none' } }}
      />
    ),
  };
});

const session = (sessionId: string, userId: string): StoredSession => ({
  sessionId,
  baseUrl: 'https://matrix.example.org',
  userId,
  deviceId: `DEVICE_${sessionId}`,
  accessToken: `token-${sessionId}`,
  lastUsedAt: 1,
});

const BOB: AccountMenuAccount = {
  session: session('b', '@bob:matrix.org'),
  displayName: 'Bob',
};
const CAROL: AccountMenuAccount = {
  session: session('c', '@carol:example.org'),
  displayName: 'Carol',
};

const open = (
  others: AccountMenuAccount[],
  options?: { withManage?: boolean; below?: boolean }
) => {
  const withManage = options?.withManage ?? others.length > 0;
  const anchor = document.createElement('button');
  anchor.textContent = 'Account';
  document.body.append(anchor);
  anchor.focus();
  const props = {
    onOpenSettings: vi.fn(),
    onSwitchAccount: vi.fn(),
    onAddAccount: vi.fn(),
    onSignOut: vi.fn(),
    onManageAccounts: withManage ? vi.fn() : undefined,
    onClose: vi.fn(),
  };
  render(
    <AccountMenu
      anchor={anchor}
      active={{ userId: '@alice:mindroom.chat', displayName: 'Alice' }}
      others={others}
      below={options?.below}
      {...props}
    />
  );
  return { anchor, ...props };
};

const entryNames = () =>
  within(screen.getByRole('menu'))
    .getAllByRole('menuitem')
    .map((item) => item.getAttribute('aria-label') ?? item.textContent);

const viewportHeight = Object.getOwnPropertyDescriptor(document.documentElement, 'clientHeight');
const setViewportHeight = (value: number) =>
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value });

/** A button whose box the test moves, as a resize moves the rail's. */
const anchorAt = (top: number, left: number) => {
  const anchor = document.createElement('button');
  const box = { top, left };
  anchor.getBoundingClientRect = () =>
    ({ ...box, bottom: box.top + 40, right: box.left + 40, width: 40, height: 40 } as DOMRect);
  document.body.append(anchor);
  return { anchor, box };
};

const openAt = (anchor: HTMLElement, below = false) =>
  render(
    <AccountMenu
      anchor={anchor}
      active={{ userId: '@alice:mindroom.chat', displayName: 'Alice' }}
      others={[BOB, CAROL]}
      below={below}
      onOpenSettings={vi.fn()}
      onSwitchAccount={vi.fn()}
      onAddAccount={vi.fn()}
      onSignOut={vi.fn()}
      onManageAccounts={vi.fn()}
      onClose={vi.fn()}
    />
  );

const heightCap = () => (screen.getByRole('menu').parentElement as HTMLElement).style.maxBlockSize;

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  if (viewportHeight) {
    Object.defineProperty(document.documentElement, 'clientHeight', viewportHeight);
  } else {
    Reflect.deleteProperty(document.documentElement, 'clientHeight');
  }
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

describe('AccountMenu', () => {
  it('renders the header card, Other accounts well with Manage, and split footer with multiple accounts', () => {
    open([BOB, CAROL]);
    const menu = screen.getByRole('menu');
    expect(menu.getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('@alice:mindroom.chat')).toBeTruthy();
    expect(screen.getByText('Other accounts')).toBeTruthy();
    expect(entryNames()).toEqual([
      'Settings',
      'Manage',
      'Switch to account Bob (@bob:matrix.org)',
      'Switch to account Carol (@carol:example.org)',
      'Add Account',
      'Logout',
    ]);
    // Each account shows its picture, name and Matrix ID.
    const bob = screen.getByRole('menuitem', { name: 'Switch to account Bob (@bob:matrix.org)' });
    expect(within(bob).getByText('@bob:matrix.org')).toBeTruthy();
    expect(bob.querySelector('[data-avatar="Bob"]')).toBeTruthy();
  });

  it('names Manage by its visible label and describes it with the Other accounts heading', () => {
    open([BOB]);
    // Voice control speaks the visible word, so the name is that word in every language.
    const manage = screen.getByRole('menuitem', { name: 'Manage' });
    expect(manage.hasAttribute('aria-label')).toBe(false);
    expect(manage.textContent).toBe('Manage');
    const description = document.getElementById(manage.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe('Other accounts');
  });

  it('omits the Other accounts well and Manage with a single account', () => {
    open([]);
    expect(screen.queryByText('Other accounts')).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Manage' })).toBeNull();
    expect(entryNames()).toEqual(['Settings', 'Add Account', 'Logout']);
    // Settings shows its shortcut beside its name, not in it, and names it for assistive technology.
    const settings = screen.getByRole('menuitem', { name: 'Settings' });
    expect(settings.textContent).toBe('Settings');
    expect(settings.getAttribute('aria-keyshortcuts')).toBe('Control+,');
    expect(settings.querySelector('[data-keys]')?.getAttribute('data-keys')).toBe('Ctrl+,');
  });

  it('closes and switches when an account is chosen', () => {
    const { onClose, onSwitchAccount } = open([BOB, CAROL]);
    fireEvent.click(screen.getByRole('menuitem', { name: /Carol/ }));
    expect(onClose).toHaveBeenCalled();
    expect(onSwitchAccount).toHaveBeenCalledWith(CAROL.session);
  });

  it('closes before opening Settings, managing accounts, adding an account or signing out', () => {
    const { onClose, onOpenSettings, onManageAccounts, onAddAccount, onSignOut } = open([BOB]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Account' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Logout' }));
    expect(onClose).toHaveBeenCalledTimes(4);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onManageAccounts).toHaveBeenCalledTimes(1);
    expect(onAddAccount).toHaveBeenCalledTimes(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('walks every actionable item in visual order with the arrow keys and closes on Escape', async () => {
    const { anchor, onClose } = open([BOB, CAROL]);
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items).toHaveLength(6);
    // A pointer press keeps focus on the button (installOverlayFocus moves it for Enter or Space).
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(document.activeElement).toBe(anchor);
    const arrow = (key: 'ArrowDown' | 'ArrowUp', keyCode: number) =>
      fireEvent.keyDown(document.activeElement ?? document.body, { key, keyCode, which: keyCode });
    // Settings -> Manage -> Bob -> Carol -> Add Account -> Sign out -> wraps to Settings
    for (const item of items) {
      arrow('ArrowDown', 40);
      expect(document.activeElement).toBe(item);
    }
    arrow('ArrowDown', 40);
    expect(document.activeElement).toBe(items[0]);
    arrow('ArrowUp', 38);
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a press elsewhere but leaves a press on its own button to the button', () => {
    const { anchor, onClose } = open([BOB]);
    fireEvent.mouseDown(anchor);
    fireEvent.click(anchor);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('places the menu below the anchor on phones', () => {
    open([], { below: true });
    expect(
      document.querySelector('[data-popout-position]')?.getAttribute('data-popout-position')
    ).toBe('Bottom');
  });

  it('caps menu height to available viewport space for short windows', () => {
    setViewportHeight(320);
    openAt(anchorAt(268, 10).anchor);
    expect(heightCap()).toMatch(/^min\(300px,/);
    cleanup();

    openAt(anchorAt(6, 340).anchor, true);
    expect(heightCap()).toMatch(/^min\(258px,/);
  });

  it('measures the button and the window again when the window resizes', () => {
    setViewportHeight(800);
    const { anchor, box } = anchorAt(6, 580);
    openAt(anchor, true);
    expect(heightCap()).toMatch(/^min\(738px,/);
    const placedAt = () =>
      document.querySelector('[data-popout-position]')?.getAttribute('data-popout-anchor');
    expect(placedAt()).toBe('580,6');

    // The window shrinks under the open menu, and the button moves with its bar.
    setViewportHeight(360);
    box.left = 340;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(heightCap()).toMatch(/^min\(298px,/);
    expect(placedAt()).toBe('340,6');
    expect(
      document.querySelector('[data-popout-position]')?.getAttribute('data-popout-position')
    ).toBe('Bottom');
  });

  it('scrolls an item that takes focus into view inside the scrolling body', () => {
    // jsdom lays nothing out and has no scrollIntoView.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    open([BOB]);
    // The app's focus manager focuses Settings without scrolling when the menu opens by keyboard.
    const settings = screen.getByRole('menuitem', { name: 'Settings' });
    settings.focus({ preventScroll: true });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(settings);

    const bob = screen.getByRole('menuitem', { name: /Bob/ });
    bob.focus();
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(bob);

    // The footer stays pinned below the scrolling body, always in view.
    scrollIntoView.mockClear();
    screen.getByRole('menuitem', { name: 'Logout' }).focus();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
