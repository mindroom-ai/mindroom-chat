// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { pageNavNoticeSlotAtom } from '../sidebar/pageNavNoticeSlot';
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
    getDefaultStore().set(pageNavNoticeSlotAtom, null);
    getDefaultStore().set(phoneNavDrawerOpenAtom, false);
    document.body.innerHTML = '';
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
    // No room list beside the page: the card floats over the page.
    expect(region.querySelector('[data-new-version-card="page"]')).toBeTruthy();
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

  it('shows at the foot of the room list while the list offers its place, and over the page again once it goes', () => {
    update.state.version = 'build-2';
    const slot = document.body.appendChild(document.createElement('div'));
    const store = getDefaultStore();
    act(() => store.set(pageNavNoticeSlotAtom, slot));
    const { container } = render(<NewVersionNotice />);

    expect(slot.querySelector('[data-new-version-card="list"]')).toBeTruthy();
    expect(liveRegion(container).textContent).toBe('');

    act(() => store.set(pageNavNoticeSlotAtom, null));
    expect(slot.textContent).toBe('');
    expect(liveRegion(container).querySelector('[data-new-version-card="page"]')).toBeTruthy();
  });

  it('marks the region while a phone drawer covers the page, so the card waits under it', () => {
    update.state.version = 'build-2';
    const { container } = render(<NewVersionNotice />);
    expect(liveRegion(container).hasAttribute('data-phone-layer-open')).toBe(false);

    act(() => getDefaultStore().set(phoneNavDrawerOpenAtom, true));
    expect(liveRegion(container).hasAttribute('data-phone-layer-open')).toBe(true);
  });
});
