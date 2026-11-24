// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FocusTrap } from 'focus-trap-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomSortMenu, RoomSortMenuContent } from './RoomSortMenu';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  PopOut: ({ content, anchor }: { content: React.ReactNode; anchor?: DOMRect }) =>
    anchor ? <div data-popout="open">{content}</div> : null,
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

afterEach(cleanup);

describe('RoomSortMenu', () => {
  it('shows active cue only when non-default, opens popover, switches mode, toggles switch without nested buttons, and refocuses on Escape', () => {
    const onModeChange = vi.fn();
    const onShowTimesChange = vi.fn();

    const { rerender } = render(
      <RoomSortMenu
        mode="name"
        showTimes={false}
        hasSavedOrder
        onModeChange={onModeChange}
        onShowTimesChange={onShowTimesChange}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Sort rooms' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('data-active')).toBeNull();

    // Open popover.
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const recent = screen.getByRole('menuitemradio', { name: 'Recent activity' });
    const aToZ = screen.getByRole('menuitemradio', { name: 'A to Z' });
    const custom = screen.getByRole('menuitemradio', { name: /Custom order/ });
    const showTimes = screen.getByRole('menuitemcheckbox', { name: 'Show activity times' });

    expect(aToZ.getAttribute('aria-checked')).toBe('true');
    expect(recent.getAttribute('aria-checked')).toBe('false');
    expect(custom.textContent).toContain('Saved');
    expect(showTimes.getAttribute('aria-checked')).toBe('false');

    // No nested <button> inside <button> (showTimes row renders as a <div>).
    expect(showTimes.tagName).toBe('DIV');
    expect(showTimes.closest('button')).toBeNull();

    // Toggle Show activity times via click and keyboard; popover stays open.
    fireEvent.click(showTimes);
    expect(onShowTimesChange).toHaveBeenCalledTimes(1);
    expect(onShowTimesChange).toHaveBeenCalledWith(true);
    fireEvent.keyDown(showTimes, { key: 'Enter' });
    expect(onShowTimesChange).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('menu', { name: 'Sort rooms' })).toBeTruthy();

    // Escape closes the popover and restores focus to the trigger button.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Sort rooms' })).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // Selecting Recent activity calls onModeChange and closes the popover.
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Recent activity' }));
    expect(onModeChange).toHaveBeenCalledWith('recent');
    expect(screen.queryByRole('menu', { name: 'Sort rooms' })).toBeNull();

    // Active indicator shows for non-default mode or showTimes, and Saved detail hides in manual mode.
    rerender(
      <RoomSortMenu
        mode="manual"
        showTimes={false}
        hasSavedOrder
        onModeChange={onModeChange}
        onShowTimesChange={onShowTimesChange}
      />
    );
    expect(screen.getByRole('button', { name: 'Sort rooms' }).getAttribute('data-active')).toBe(
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sort rooms' }));
    expect(screen.getByRole('menuitemradio', { name: 'Custom order' }).textContent).not.toContain(
      'Saved'
    );
  });

  it('renders Match space radio option for sub-space menus and handles override vs inherit state', () => {
    const onModeChange = vi.fn();
    const onShowTimesChange = vi.fn();
    const onReset = vi.fn();

    const { rerender } = render(
      <div role="menu">
        <RoomSortMenuContent
          mode="recent"
          showTimes={false}
          hasSavedOrder
          onModeChange={onModeChange}
          onShowTimesChange={onShowTimesChange}
          inherit={{ mode: 'recent', overridden: false, onReset }}
          inlineDisplay
        />
      </div>
    );

    const matchSpace = screen.getByRole('menuitemradio', { name: 'Match space (Recent)' });
    expect(matchSpace.getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByRole('menuitemradio', { name: 'Recent activity' }).getAttribute('aria-checked')
    ).toBe('false');
    expect(screen.getByRole('menuitemradio', { name: /Custom order/ }).textContent).toContain(
      'Saved'
    );

    // Overridden sub-space checks its explicit mode and lets Match space reset it.
    rerender(
      <div role="menu">
        <RoomSortMenuContent
          mode="name"
          showTimes
          hasSavedOrder
          onModeChange={onModeChange}
          onShowTimesChange={onShowTimesChange}
          inherit={{ mode: 'recent', overridden: true, onReset }}
          inlineDisplay
        />
      </div>
    );

    expect(
      screen
        .getByRole('menuitemradio', { name: 'Match space (Recent)' })
        .getAttribute('aria-checked')
    ).toBe('false');
    expect(screen.getByRole('menuitemradio', { name: 'A to Z' }).getAttribute('aria-checked')).toBe(
      'true'
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Match space (Recent)' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
