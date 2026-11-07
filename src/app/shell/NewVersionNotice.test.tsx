// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewVersionNotice } from './NewVersionNotice';

const update = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state: { version: string | undefined } = { version: undefined };
  return {
    state,
    publish: (version: string) => {
      state.version = version;
      listeners.forEach((listener) => listener());
    },
    getNewVersion: () => state.version,
    subscribeToNewVersion: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reloadForNewVersion: vi.fn(async () => undefined),
  };
});
vi.mock('../config/appUpdate', () => update);

/** The notice's live region, which the page has from the start. */
const liveRegion = (container: HTMLElement): HTMLElement => {
  const region = container.querySelector<HTMLElement>('[data-new-version-notice]');
  if (!region) throw new Error('no live region');
  return region;
};

describe('NewVersionNotice', () => {
  afterEach(() => {
    cleanup();
    update.state.version = undefined;
    update.reloadForNewVersion.mockClear();
  });

  it('stays empty until a new version is known, in a live region that is already there', () => {
    const { container } = render(<NewVersionNotice />);
    const region = liveRegion(container);
    expect(region.getAttribute('aria-live')).toBe('polite');
    // The operator notices' stack is the page's status region; this one is not a second.
    expect(screen.queryByRole('status')).toBeNull();
    expect(region.textContent).toBe('');

    act(() => update.publish('build-2'));

    expect(region.textContent).toContain('A new version of MindRoom is available.');
    expect(region.querySelector('[data-new-version-card]')).toBeTruthy();
  });

  it('reloads for the new version from its Reload action, once', () => {
    update.state.version = 'build-2';
    render(<NewVersionNotice />);

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(update.reloadForNewVersion).toHaveBeenCalledOnce();
  });

  it('goes away for the life of the page when dismissed', () => {
    update.state.version = 'build-2';
    const { container } = render(<NewVersionNotice />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(liveRegion(container).textContent).toBe('');

    act(() => update.publish('build-3'));
    expect(liveRegion(container).textContent).toBe('');
  });
});
