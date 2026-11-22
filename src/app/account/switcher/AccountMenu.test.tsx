// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  PopOut: ({ content, position }: { content: React.ReactNode; position?: string }) => (
    <div data-popout-position={position}>{content}</div>
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

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
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
      'Sign out',
    ]);
    // Each account shows its picture, name and Matrix ID.
    const bob = screen.getByRole('menuitem', { name: 'Switch to account Bob (@bob:matrix.org)' });
    expect(within(bob).getByText('@bob:matrix.org')).toBeTruthy();
    expect(bob.querySelector('[data-avatar="Bob"]')).toBeTruthy();
  });

  it('omits the Other accounts well and Manage with a single account', () => {
    open([]);
    expect(screen.queryByText('Other accounts')).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Manage' })).toBeNull();
    expect(entryNames()).toEqual(['Settings', 'Add Account', 'Sign out']);
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
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
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
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      document.documentElement,
      'clientHeight'
    );
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: 320,
    });
    try {
      const anchor = document.createElement('button');
      anchor.getBoundingClientRect = () =>
        ({ top: 268, bottom: 308, left: 10, right: 50, width: 40, height: 40 } as DOMRect);
      document.body.append(anchor);
      render(
        <AccountMenu
          anchor={anchor}
          active={{ userId: '@alice:mindroom.chat', displayName: 'Alice' }}
          others={[BOB, CAROL]}
          onOpenSettings={vi.fn()}
          onSwitchAccount={vi.fn()}
          onAddAccount={vi.fn()}
          onSignOut={vi.fn()}
          onManageAccounts={vi.fn()}
          onClose={vi.fn()}
        />
      );
      const surface = screen.getByRole('menu').parentElement as HTMLElement;
      expect(surface.style.maxBlockSize).toMatch(/^min\(300px,/);
      cleanup();

      anchor.getBoundingClientRect = () =>
        ({ top: 6, bottom: 46, left: 340, right: 380, width: 40, height: 40 } as DOMRect);
      render(
        <AccountMenu
          anchor={anchor}
          active={{ userId: '@alice:mindroom.chat', displayName: 'Alice' }}
          others={[BOB, CAROL]}
          below
          onOpenSettings={vi.fn()}
          onSwitchAccount={vi.fn()}
          onAddAccount={vi.fn()}
          onSignOut={vi.fn()}
          onManageAccounts={vi.fn()}
          onClose={vi.fn()}
        />
      );
      const phoneSurface = screen.getByRole('menu').parentElement as HTMLElement;
      expect(phoneSurface.style.maxBlockSize).toMatch(/^min\(258px,/);
    } finally {
      if (originalClientHeight) {
        Object.defineProperty(document.documentElement, 'clientHeight', originalClientHeight);
      } else {
        delete (document.documentElement as unknown as Record<string, unknown>).clientHeight;
      }
    }
  });
});
