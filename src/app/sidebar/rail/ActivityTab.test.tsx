// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { ActivityTab } from './ActivityTab';

const badge = vi.hoisted(() => ({ value: { count: 0, needsYou: false } }));
vi.mock('../../activity/useActivityRows', () => ({ useActivityBadge: () => badge.value }));
vi.mock('../../activity/ActivityPopover', () => ({
  ActivityPopover: ({ onExpand, onNavigate }: { onExpand: () => void; onNavigate: () => void }) => (
    <div role="dialog" aria-label="Activity popover">
      <button type="button" onClick={onExpand}>
        Open as page
      </button>
      <button type="button" onClick={onNavigate}>
        Open a row
      </button>
    </div>
  ),
}));

function CurrentPath() {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

const renderTab = (
  screenSize: ScreenSize,
  path = '/home/',
  onSelect?: (selected: boolean) => boolean
) => {
  render(
    <Provider store={createStore()}>
      <ScreenSizeProvider value={screenSize}>
        <MemoryRouter initialEntries={[path]}>
          <ActivityTab onSelect={onSelect} />
          <CurrentPath />
        </MemoryRouter>
      </ScreenSizeProvider>
    </Provider>
  );
};

const bell = () => screen.getByRole('button', { name: /^Activity/ });
const currentPath = () => screen.getByRole('status', { name: 'Current path' }).textContent;

afterEach(() => {
  cleanup();
  badge.value = { count: 0, needsYou: false };
});

describe('the rail Activity bell', () => {
  it('counts unread rows, and marks the count when something waits for the user', () => {
    badge.value = { count: 4, needsYou: true };
    renderTab(ScreenSize.Desktop);
    expect(bell().getAttribute('aria-label')).toBe('Activity, 4 unread');
    expect(
      screen.getByText('4').closest('[data-activity-badge]')?.getAttribute('data-activity-badge')
    ).toBe('needs-you');
  });

  it('opens the popover over the page, and the page on a second click', () => {
    renderTab(ScreenSize.Desktop);
    fireEvent.click(bell());
    expect(bell().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Activity popover' })).toBeTruthy();
    expect(currentPath()).toBe('/home/');

    fireEvent.click(bell());
    expect(currentPath()).toBe('/activity/');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the page from the popover', () => {
    renderTab(ScreenSize.Desktop);
    fireEvent.click(bell());
    fireEvent.click(screen.getByRole('button', { name: 'Open as page' }));
    expect(currentPath()).toBe('/activity/');
  });

  it('opens the navigation panel it hid with the page, so the list shows beside it', () => {
    const onSelect = vi.fn(() => false);
    renderTab(ScreenSize.Desktop, '/home/', onSelect);
    fireEvent.click(bell());
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open as page' }));
    expect(onSelect).toHaveBeenCalledWith(false);
    expect(currentPath()).toBe('/activity/');
  });

  it('shows the navigation panel it hid when a row of the popover opens its thread', () => {
    const onSelect = vi.fn(() => false);
    renderTab(ScreenSize.Desktop, '/home/', onSelect);
    fireEvent.click(bell());
    fireEvent.click(screen.getByRole('button', { name: 'Open a row' }));
    expect(onSelect).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('toggles the navigation panel while Activity shows, keeping the open thread', () => {
    const onSelect = vi.fn(() => true);
    renderTab(ScreenSize.Desktop, '/activity/!r%3Ax', onSelect);
    fireEvent.click(bell());
    expect(onSelect).toHaveBeenCalledWith(true);
    expect(currentPath()).toBe('/activity/!r%3Ax');
  });

  it('goes to the page without a popover while Activity shows, and on phones', () => {
    renderTab(ScreenSize.Desktop, '/activity/');
    fireEvent.click(bell());
    expect(screen.queryByRole('dialog')).toBeNull();

    cleanup();
    renderTab(ScreenSize.Mobile);
    fireEvent.click(bell());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(currentPath()).toBe('/activity/');
  });
});
