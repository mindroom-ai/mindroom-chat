// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { FocusTrap } from 'focus-trap-react';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shortcutHelpOpenAtom } from '../navigation/shortcutHelpState';
import {
  helpMenuOpenAtom,
  tourAtom,
  type TourLevel,
  type TourStepId,
} from '../navigation/tourState';
import { RESOLVE_TIP_ID, type ContextualTip } from './contextualTips';
import { HelpMenu } from './HelpMenu';
import { useContextualTip } from './useContextualTip';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  PopOut: ({ content, position }: { content: React.ReactNode; position?: string }) => (
    <div data-popout-position={position}>{content}</div>
  ),
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
vi.mock('./useContextualTip', () => ({ useContextualTip: vi.fn() }));

const renderMenu = ({
  tip,
  below = false,
}: {
  tip?: ContextualTip;
  below?: boolean;
} = {}) => {
  const store = createStore();
  const anchor = document.body.appendChild(document.createElement('button'));
  const onClose = vi.fn();
  const dismissTip = vi.fn();
  const openTipTour = vi.fn((active: ContextualTip) => {
    store.set(tourAtom, { level: 'full', initialStep: active.tourStep });
  });
  vi.mocked(useContextualTip).mockReturnValue({ tip, dismissTip, openTipTour });
  const view = render(
    <Provider store={store}>
      <HelpMenu anchor={anchor} below={below} onClose={onClose} />
    </Provider>
  );
  return { store, onClose, dismissTip, openTipTour, view };
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('HelpMenu', () => {
  it('shows the active contextual suggestion and wires Show how and Dismiss', () => {
    const tip: ContextualTip = {
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'room',
      openCount: 6,
    };
    const { store, onClose, dismissTip, openTipTour, view } = renderMenu({ tip });
    expect(store.get(helpMenuOpenAtom)).toBe(true);

    expect(screen.getByText('1 tip')).toBeTruthy();
    expect(screen.getByText('Suggested for you')).toBeTruthy();
    expect(screen.getByText('6 open threads here, none resolved yet')).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Dismiss tip' }));
    expect(dismissTip).toHaveBeenCalledWith(RESOLVE_TIP_ID);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Show how' }));
    expect(openTipTour).toHaveBeenCalledWith(tip);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(store.get(tourAtom)).toEqual({ level: 'full', initialStep: 'resolve' });

    view.unmount();
    expect(store.get(helpMenuOpenAtom)).toBe(false);
  });

  it('renders the clean state without a tip and jumps directly to each tour guide', () => {
    const expected: Array<[string, TourLevel, TourStepId]> = [
      ['How threads work', 'quick', 'conversation'],
      ['Resolve what is done', 'full', 'resolve'],
      ['Find resolved threads', 'full', 'filters'],
      ['Snooze for later', 'full', 'snooze'],
      ['Pin & tag threads', 'full', 'pinAndTag'],
      ['Compact vs Threads view', 'full', 'views'],
      ['Activity & approvals', 'full', 'activity'],
    ];

    for (const [label, level, initialStep] of expected) {
      const { store, onClose } = renderMenu();
      expect(screen.getByText('Quick guides')).toBeTruthy();
      expect(screen.queryByText('Suggested for you')).toBeNull();

      const group = screen.getByRole('group', { name: 'UI guides' });
      fireEvent.click(within(group).getByRole('menuitem', { name: label }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(store.get(tourAtom)).toEqual({ level, initialStep });
      cleanup();
    }
  });

  it('opens the full tour, keyboard shortcuts, handles Escape, and respects placement', () => {
    const first = renderMenu();
    expect(
      document.querySelector('[data-popout-position]')?.getAttribute('data-popout-position')
    ).toBe('Right');

    fireEvent.click(screen.getByRole('menuitem', { name: 'Full tour' }));
    expect(first.onClose).toHaveBeenCalledTimes(1);
    expect(first.store.get(tourAtom)).toEqual({ level: 'full' });

    cleanup();
    const second = renderMenu({ below: true });
    expect(
      document.querySelector('[data-popout-position]')?.getAttribute('data-popout-position')
    ).toBe('Bottom');

    fireEvent.click(screen.getByRole('menuitem', { name: 'Shortcuts' }));
    expect(second.onClose).toHaveBeenCalledTimes(1);
    expect(second.store.get(shortcutHelpOpenAtom)).toBe(true);

    cleanup();
    const third = renderMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(third.onClose).toHaveBeenCalledTimes(1);
  });
});
