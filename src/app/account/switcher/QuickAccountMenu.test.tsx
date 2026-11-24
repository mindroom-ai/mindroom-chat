// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredSession } from '../../matrix/session/sessions';
import type { AccountMenuAccount } from './AccountMenu';
import { QuickAccountMenu } from './QuickAccountMenu';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  PopOut: ({
    content,
    position,
    align,
    offset,
    anchor,
  }: {
    content: React.ReactNode;
    position?: string;
    align?: string;
    offset?: number;
    anchor?: DOMRect;
  }) => (
    <div
      data-popout-position={position}
      data-popout-align={align}
      data-popout-offset={offset}
      data-popout-anchor={`${anchor?.left},${anchor?.top}`}
    >
      {content}
    </div>
  ),
}));

vi.mock('../../avatars/UserAvatar', () => ({
  UserAvatar: ({ alt, src }: { alt: string; src?: string }) =>
    src ? <img data-avatar={alt} alt={alt} src={src} /> : <span data-avatar={alt} />,
}));

const session = (sessionId: string, userId: string, lastUsedAt: number): StoredSession => ({
  sessionId,
  baseUrl: 'https://matrix.example.org',
  userId,
  deviceId: `DEVICE_${sessionId}`,
  accessToken: `token-${sessionId}`,
  lastUsedAt,
});

const BOB: AccountMenuAccount = {
  session: session('bob', '@bob:matrix.org', 30),
  displayName: 'Bob',
};
const CAROL: AccountMenuAccount = {
  session: session('carol', '@carol:example.org', 20),
  displayName: 'Carol',
};
const DAVE: AccountMenuAccount = {
  session: session('dave', '@dave:example.org', 10),
  displayName: 'Dave',
};

const viewportHeight = Object.getOwnPropertyDescriptor(document.documentElement, 'clientHeight');
const setViewportHeight = (value: number) =>
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value });

const anchorAt = (top: number, left: number) => {
  const anchor = document.createElement('button');
  const box = { top, left };
  anchor.getBoundingClientRect = () =>
    ({ ...box, bottom: box.top + 40, right: box.left + 40, width: 40, height: 40 } as DOMRect);
  document.body.append(anchor);
  return { anchor, box };
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  if (viewportHeight) {
    Object.defineProperty(document.documentElement, 'clientHeight', viewportHeight);
  } else {
    Reflect.deleteProperty(document.documentElement, 'clientHeight');
  }
});

const quickMenu = () => document.querySelector<HTMLElement>('[data-quick-account-menu]')!;
const rowsOf = (menu: HTMLElement) =>
  Array.from(menu.querySelectorAll<HTMLElement>('[data-quick-account-session-id]'));

describe('QuickAccountMenu', () => {
  it('renders header and accounts MRU-first when placed below the phone top bar', () => {
    const { anchor } = anchorAt(6, 340);
    render(<QuickAccountMenu anchor={anchor} others={[BOB, CAROL, DAVE]} below />);

    const popout = document.querySelector('[data-popout-position]');
    expect(popout?.getAttribute('data-popout-position')).toBe('Bottom');
    expect(popout?.getAttribute('data-popout-align')).toBe('End');
    expect(popout?.getAttribute('data-popout-offset')).toBe('8');

    // What `hasOpenOverlay` and `useSwipeAway` look for, to leave the drag to an account alone.
    const menu = quickMenu();
    expect(within(menu).getByText('Other accounts')).toBeTruthy();

    const items = rowsOf(menu);
    expect(items.map((el) => el.getAttribute('data-quick-account-session-id'))).toEqual([
      'bob',
      'carol',
      'dave',
    ]);
  });

  it('renders accounts in reversed order (MRU at bottom, closest to avatar) beside the rail', () => {
    const { anchor } = anchorAt(640, 12);
    render(<QuickAccountMenu anchor={anchor} others={[BOB, CAROL, DAVE]} below={false} />);

    const popout = document.querySelector('[data-popout-position]');
    expect(popout?.getAttribute('data-popout-position')).toBe('Right');
    expect(popout?.getAttribute('data-popout-align')).toBe('End');
    expect(popout?.getAttribute('data-popout-offset')).toBe('8');

    const items = rowsOf(quickMenu());
    expect(items.map((el) => el.getAttribute('data-quick-account-session-id'))).toEqual([
      'dave',
      'carol',
      'bob',
    ]);
  });

  it('marks data-highlighted on the hovered session without setting aria-current', () => {
    const { anchor } = anchorAt(640, 12);
    render(
      <QuickAccountMenu anchor={anchor} others={[BOB, CAROL]} hoveredSessionId="carol" below />
    );

    const items = rowsOf(quickMenu());
    const bob = items[0]!;
    const carol = items[1]!;

    expect(bob.getAttribute('data-highlighted')).toBeNull();
    expect(bob.getAttribute('aria-current')).toBeNull();
    expect(carol.getAttribute('data-highlighted')).toBe('true');
    expect(carol.getAttribute('aria-current')).toBeNull();
  });

  it('is the pointer alone: no menu or row roles, and the arrow keys stay the page', () => {
    const { anchor } = anchorAt(640, 12);
    // The pressed avatar has focus as the menu opens.
    anchor.focus();
    render(<QuickAccountMenu anchor={anchor} others={[BOB, CAROL]} below={false} />);

    expect(document.activeElement).toBe(anchor);
    expect(quickMenu().getAttribute('role')).toBe('none');
    expect(quickMenu().hasAttribute('aria-label')).toBe(false);
    expect(document.querySelector('[role="menu"], [role="menuitem"]')).toBeNull();
    expect(rowsOf(quickMenu()).some((row) => row.hasAttribute('aria-label'))).toBe(false);

    // Hidden from assistive technology, and its scroller is no Tab stop when it overflows.
    expect(quickMenu().getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByText('Other accounts', { ignore: '[aria-hidden="true"] *' })).toBeNull();
    const list = quickMenu().querySelector<HTMLElement>('[data-quick-account-list]')!;
    expect(list.tabIndex).toBe(-1);
    expect(
      quickMenu().querySelector('button, a[href], input, [tabindex]:not([tabindex="-1"])')
    ).toBe(null);

    // A shared menu takes these from the page and its opener for its rows.
    ['ArrowDown', 'ArrowUp', 'Home', 'End'].forEach((key) => {
      expect(fireEvent.keyDown(document.body, { key })).toBe(true);
      expect(fireEvent.keyDown(anchor, { key })).toBe(true);
    });
  });

  it('scrolls the overflowing rail list to the bottom on open so the MRU row stays visible', () => {
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(360);
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(120);
    try {
      const { anchor } = anchorAt(640, 12);
      const { rerender } = render(
        <QuickAccountMenu anchor={anchor} others={[BOB, CAROL]} below={false} />
      );
      const list = document.querySelector<HTMLElement>('[data-quick-account-list]')!;
      expect(list.scrollTop).toBe(240);

      // When the account list grows while open, keep the rail list pinned to the bottom MRU row.
      scrollHeightSpy.mockReturnValue(420);
      rerender(<QuickAccountMenu anchor={anchor} others={[BOB, CAROL, DAVE]} below={false} />);
      expect(list.scrollTop).toBe(300);
    } finally {
      scrollHeightSpy.mockRestore();
      clientHeightSpy.mockRestore();
    }
  });

  it('caps height to available viewport space and re-measures on window resize', () => {
    setViewportHeight(800);
    const { anchor, box } = anchorAt(6, 580);
    render(<QuickAccountMenu anchor={anchor} others={[BOB, CAROL]} below />);

    const menu = quickMenu();
    expect(menu.style.maxBlockSize).toMatch(/^min\(738px,/);
    expect(
      document.querySelector('[data-popout-position]')?.getAttribute('data-popout-anchor')
    ).toBe('580,6');

    setViewportHeight(360);
    box.left = 340;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(menu.style.maxBlockSize).toMatch(/^min\(298px,/);
    expect(
      document.querySelector('[data-popout-position]')?.getAttribute('data-popout-anchor')
    ).toBe('340,6');
  });
});
