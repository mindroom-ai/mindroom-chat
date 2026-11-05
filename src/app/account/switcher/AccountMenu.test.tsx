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
  PopOut: ({ content }: { content: React.ReactNode }) => content,
}));
vi.mock('../../avatars/user-avatar/UserAvatar', () => ({
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

const open = (others: AccountMenuAccount[], withManage = others.length > 0) => {
  const anchor = document.createElement('button');
  anchor.textContent = 'Account';
  document.body.append(anchor);
  anchor.focus();
  const props = {
    onOpenSettings: vi.fn(),
    onSwitchAccount: vi.fn(),
    onAddAccount: vi.fn(),
    onManageAccounts: withManage ? vi.fn() : undefined,
    onClose: vi.fn(),
  };
  render(
    <AccountMenu
      anchor={anchor}
      active={{ userId: '@alice:mindroom.chat', displayName: 'Alice' }}
      others={others}
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
  it('names the signed-in account and lists the other accounts between Settings and Add Account', () => {
    open([BOB, CAROL]);
    const menu = screen.getByRole('menu');
    expect(menu.getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('@alice:mindroom.chat')).toBeTruthy();
    expect(entryNames()).toEqual([
      'Settings',
      'Switch to account Bob (@bob:matrix.org)',
      'Switch to account Carol (@carol:example.org)',
      'Add Account',
      'Manage Accounts',
    ]);
    // Each account shows its picture, name and Matrix ID.
    const bob = screen.getByRole('menuitem', { name: 'Switch to account Bob (@bob:matrix.org)' });
    expect(within(bob).getByText('@bob:matrix.org')).toBeTruthy();
    expect(bob.querySelector('[data-avatar="Bob"]')).toBeTruthy();
  });

  it('offers Settings and Add Account alone with a single account', () => {
    open([]);
    expect(entryNames()).toEqual(['Settings', 'Add Account']);
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

  it('closes before opening Settings, adding an account or managing them', () => {
    const { onClose, onOpenSettings, onAddAccount, onManageAccounts } = open([BOB]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Account' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage Accounts' }));
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onAddAccount).toHaveBeenCalledTimes(1);
    expect(onManageAccounts).toHaveBeenCalledTimes(1);
  });

  it('leaves focus on its button, walks the entries with the arrow keys and closes on Escape', async () => {
    const { anchor, onClose } = open([BOB]);
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    // A pointer press keeps focus on the button (installOverlayFocus moves it for Enter or Space).
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(document.activeElement).toBe(anchor);
    const arrow = (key: 'ArrowDown' | 'ArrowUp', keyCode: number) =>
      fireEvent.keyDown(document.activeElement ?? document.body, { key, keyCode, which: keyCode });
    arrow('ArrowDown', 40);
    expect(document.activeElement).toBe(items[0]);
    arrow('ArrowDown', 40);
    expect(document.activeElement).toBe(items[1]);
    arrow('ArrowUp', 38);
    expect(document.activeElement).toBe(items[0]);
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
});
