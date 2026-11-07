// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { listNoticeSlotAtom, pageNoticeSlotAtom } from '../ui/noticeSlots';
import { LEAVE_MS, NewVersionNotice } from './NewVersionNotice';

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
    vi.useRealTimers();
    cleanup();
    update.state.version = undefined;
    update.reloadForNewVersion.mockClear();
    getDefaultStore().set(listNoticeSlotAtom, null);
    getDefaultStore().set(pageNoticeSlotAtom, null);
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
    // Signed out, no place is offered: the card floats over the page from the region.
    expect(region.querySelector('[data-new-version-card="page"]')).toBeTruthy();
  });

  it('reloads for the new version from its Reload action, once', () => {
    update.state.version = 'build-2';
    render(<NewVersionNotice />);

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(update.reloadForNewVersion).toHaveBeenCalledOnce();
  });

  it('plays its way out when dismissed, then stays away for the life of the page', () => {
    vi.useFakeTimers();
    update.state.version = 'build-2';
    const { container } = render(<NewVersionNotice />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    // Still there while it leaves.
    expect(container.querySelector('[data-new-version-card][data-leaving]')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(LEAVE_MS);
    });
    expect(liveRegion(container).textContent).toBe('');

    act(() => update.publish('build-3'));
    expect(liveRegion(container).textContent).toBe('');
  });

  it("takes the room list's place while there is one, else the page's", () => {
    update.state.version = 'build-2';
    const list = document.body.appendChild(document.createElement('div'));
    const page = document.body.appendChild(document.createElement('div'));
    const store = getDefaultStore();
    act(() => {
      store.set(listNoticeSlotAtom, list);
      store.set(pageNoticeSlotAtom, page);
    });
    const { container } = render(<NewVersionNotice />);

    expect(list.querySelector('[data-new-version-card="list"]')).toBeTruthy();
    expect(page.textContent).toBe('');
    expect(liveRegion(container).textContent).toBe('');

    act(() => store.set(listNoticeSlotAtom, null));
    expect(list.textContent).toBe('');
    expect(page.querySelector('[data-new-version-card="page"]')).toBeTruthy();

    act(() => store.set(pageNoticeSlotAtom, null));
    expect(liveRegion(container).querySelector('[data-new-version-card="page"]')).toBeTruthy();
  });

  it('comes in on a phone only once the drawer has gone, so it is read out, and then stays', () => {
    update.state.version = 'build-2';
    const page = document.body.appendChild(document.createElement('div'));
    page.setAttribute('data-phone', '');
    const store = getDefaultStore();
    act(() => {
      store.set(pageNoticeSlotAtom, page);
      store.set(phoneNavDrawerOpenAtom, true);
    });
    render(<NewVersionNotice />);
    expect(page.querySelector('[data-new-version-card]')).toBeNull();

    act(() => store.set(phoneNavDrawerOpenAtom, false));
    expect(page.querySelector('[data-new-version-card="page"]')).toBeTruthy();

    act(() => store.set(phoneNavDrawerOpenAtom, true));
    expect(page.querySelector('[data-new-version-card="page"]')).toBeTruthy();
  });
});
