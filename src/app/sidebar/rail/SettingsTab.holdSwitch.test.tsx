// @vitest-environment jsdom
import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type FocusTrap from 'focus-trap-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveSession, type StoredSession } from '../../matrix/session/sessions';
import { useActiveSession, useStoredSessions } from '../../matrix/session/useSessionStore';
import { ACCOUNT_HOLD_MS } from '../../account/switcher/useAccountHoldSwitch';
import { SettingsTab } from './SettingsTab';

const navigate = vi.fn();

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { ...actual, useTranslation: () => ({ t: translateFromEn }) };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  PopOut: ({ content, position }: { content: React.ReactNode; position?: string }) => (
    <div data-popout-position={position}>{content}</div>
  ),
  TooltipProvider: ({ children }: { children: (ref: () => void) => React.ReactNode }) => (
    <>{children(() => undefined)}</>
  ),
}));

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

vi.mock('../../avatars/UserAvatar', () => ({
  UserAvatar: ({ alt }: { alt: string }) => <span data-avatar={alt} />,
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@alice:mindroom.chat',
    getHomeserverUrl: () => 'https://mindroom.chat',
    getAccessToken: () => 'token-a',
  }),
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../members/useUserProfile', () => ({
  useUserProfile: () => ({
    displayName: 'Alice',
    avatarUrl: undefined,
    isAvatarResolved: true,
    isDisplayNameResolved: true,
  }),
}));

vi.mock('../../matrix/session/useSessionStore', () => ({
  useActiveSession: vi.fn(),
  useStoredSessions: vi.fn(),
}));

vi.mock('../../matrix/session/sessions', () => ({
  setActiveSession: vi.fn(),
  updateSessionProfile: vi.fn(),
}));

const activeSession: StoredSession = {
  sessionId: 'session-a',
  baseUrl: 'https://chat.mindroom.chat',
  userId: '@alice:mindroom.chat',
  deviceId: 'DEVICE_A',
  accessToken: 'token-a',
  lastUsedAt: 30,
};

const bobSession: StoredSession = {
  sessionId: 'session-b',
  baseUrl: 'https://matrix.org',
  userId: '@bob:matrix.org',
  deviceId: 'DEVICE_B',
  accessToken: 'token-b',
  lastUsedAt: 20,
  lastKnownDisplayName: 'Bob',
  lastKnownPath: '/home',
};

const carolSession: StoredSession = {
  sessionId: 'session-c',
  baseUrl: 'https://example.org',
  userId: '@carol:example.org',
  deviceId: 'DEVICE_C',
  accessToken: 'token-c',
  lastUsedAt: 10,
  lastKnownDisplayName: 'Carol',
  lastKnownPath: '/explore',
};

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  x: left,
  y: top,
  toJSON: () => ({}),
});

const pointerEvent = (
  type: string,
  init: { pointerId?: number; button?: number; clientX?: number; clientY?: number } = {}
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  Object.defineProperty(event, 'isPrimary', { value: true });
  return event;
};

const renderTab = (
  props: { inTopBar?: boolean } = {},
  sessions: StoredSession[] = [activeSession, bobSession, carolSession]
) => {
  vi.mocked(useActiveSession).mockReturnValue(activeSession);
  vi.mocked(useStoredSessions).mockReturnValue(sessions);
  const store = createStore();
  return render(
    <Provider store={store}>
      <SettingsTab {...props} />
    </Provider>
  );
};

beforeEach(() => {
  vi.useFakeTimers();
  navigate.mockReset();
  vi.mocked(setActiveSession).mockReset();
  vi.mocked(setActiveSession).mockImplementation((id) =>
    [activeSession, bobSession, carolSession].find((s) => s.sessionId === id)
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.documentElement.style.removeProperty('user-select');
  document.documentElement.style.removeProperty('-webkit-user-select');
  document.documentElement.style.removeProperty('-webkit-touch-callout');
});

describe('SettingsTab hold-and-swipe account switch', () => {
  it.each([
    {
      surface: 'rail',
      inTopBar: false,
      expectedPosition: 'Right',
      expectedOrder: ['session-c', 'session-b'],
    },
    {
      surface: 'phone top bar',
      inTopBar: true,
      expectedPosition: 'Bottom',
      expectedOrder: ['session-b', 'session-c'],
    },
  ])(
    'switches accounts on hold-and-swipe on the $surface without opening AccountMenu',
    ({ inTopBar, expectedPosition, expectedOrder }) => {
      renderTab({ inTopBar });
      const trigger = screen.getByRole('button', { name: 'Open account menu for Alice' });
      trigger.getBoundingClientRect = () => rect(10, 400, 42, 42);
      expect(trigger.getAttribute('aria-expanded')).toBe('false');

      fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
      act(() => {
        vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
      });

      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(
        document.querySelector('[data-popout-position]')?.getAttribute('data-popout-position')
      ).toBe(expectedPosition);

      const menu = screen.getByRole('menu', { name: 'Other accounts' });
      const rows = within(menu).getAllByRole('menuitem');
      expect(rows.map((row) => row.getAttribute('data-quick-account-session-id'))).toEqual(
        expectedOrder
      );

      // Give list container and rows geometry and drag onto Bob.
      const list = menu.querySelector<HTMLElement>('[data-quick-account-list]')!;
      list.getBoundingClientRect = () => rect(76, 256, 228, 98);
      const bobRow = menu.querySelector<HTMLElement>(
        '[data-quick-account-session-id="session-b"]'
      )!;
      const carolRow = menu.querySelector<HTMLElement>(
        '[data-quick-account-session-id="session-c"]'
      )!;
      bobRow.getBoundingClientRect = () => rect(80, 260, 220, 44);
      carolRow.getBoundingClientRect = () => rect(80, 306, 220, 44);

      fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 150, clientY: 280 }));
      expect(bobRow.getAttribute('data-highlighted')).toBe('true');

      fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 150, clientY: 280 }));
      // Synthetic click following pointerup must not open AccountMenu.
      fireEvent.click(trigger);

      expect(setActiveSession).toHaveBeenCalledWith('session-b');
      expect(navigate).toHaveBeenCalledWith('/home');
      expect(screen.queryByRole('menu')).toBeNull();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    }
  );

  it.each([false, true])('still opens AccountMenu on a short tap (inTopBar=%s)', (inTopBar) => {
    renderTab({ inTopBar });
    const trigger = screen.getByRole('button', { name: 'Open account menu for Alice' });

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS - 60);
    });
    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 25, clientY: 420 }));
    fireEvent.click(trigger);

    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(setActiveSession).not.toHaveBeenCalled();
  });

  it('does not open QuickAccountMenu on hold when only one account is signed in', () => {
    renderTab({ inTopBar: false }, [activeSession]);
    const trigger = screen.getByRole('button', { name: 'Open account menu for Alice' });

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS + 100);
    });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('does not open AccountMenu after Escape cancels an open quick menu and pointer lifts on the avatar', () => {
    renderTab({ inTopBar: false });
    const trigger = screen.getByRole('button', { name: 'Open account menu for Alice' });

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    expect(screen.getByRole('menu', { name: 'Other accounts' })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 25, clientY: 420 }));
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();

    // A subsequent keyboard activation opens AccountMenu normally.
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy();
  });
});
