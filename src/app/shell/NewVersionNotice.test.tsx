// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHONE_SLIDE_OUT_MS, phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { listNoticeSlotAtom, NOTICE_LEAVE_MS, pageNoticeSlotAtom } from '../ui/noticeSlots';
import { NewVersionNotice } from './NewVersionNotice';

const update = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  // `installing` holds the new version back from being ready, as while its worker installs.
  const state: { version: string | undefined; installing: boolean } = {
    version: undefined,
    installing: false,
  };
  const notify = () => listeners.forEach((listener) => listener());
  return {
    state,
    publish: (version: string) => {
      state.version = version;
      notify();
    },
    installed: () => {
      state.installing = false;
      notify();
    },
    getNewVersion: () => state.version,
    getReadyVersion: () => (state.installing ? undefined : state.version),
    subscribeToNewVersion: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reloadForNewVersion: vi.fn(async () => undefined),
  };
});
vi.mock('../config/appUpdate', () => update);
vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  Spinner: () => <span data-spinner />,
}));

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
    update.state.installing = false;
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
    fireEvent.click(screen.getByRole('button', { name: 'Updating…' }));

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
      vi.advanceTimersByTime(NOTICE_LEAVE_MS);
    });
    expect(liveRegion(container).textContent).toBe('');

    act(() => update.publish('build-3'));
    expect(liveRegion(container).textContent).toBe('');
  });

  it("waits until the new version's worker has installed", () => {
    update.state.installing = true;
    const { container } = render(<NewVersionNotice />);

    act(() => update.publish('build-2'));
    expect(liveRegion(container).textContent).toBe('');

    act(() => update.installed());
    expect(liveRegion(container).textContent).toContain('A new version of MindRoom is available.');
  });

  it('shows a spinner and says it is updating while the reload prepares, and Reload again if it fails', async () => {
    let fail = () => {};
    update.reloadForNewVersion.mockImplementationOnce(
      () =>
        new Promise<undefined>((_, reject) => {
          fail = () => reject(new Error('no reload'));
        })
    );
    update.state.version = 'build-2';
    render(<NewVersionNotice />);
    const button = screen.getByRole('button', { name: 'Reload' });
    expect(button.querySelector('[data-spinner]')).toBeNull();

    fireEvent.click(button);
    const updating = screen.getByRole('button', { name: 'Updating…' });
    expect(updating).toHaveProperty('disabled', true);
    expect(updating.querySelector('[data-spinner]')).toBeTruthy();
    expect(update.reloadForNewVersion).toHaveBeenCalledOnce();

    await act(async () => fail());
    const again = screen.getByRole('button', { name: 'Reload' });
    expect(again).toHaveProperty('disabled', false);
    expect(again.querySelector('[data-spinner]')).toBeNull();
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

  it('comes in on a phone once the drawer has slid away, so it is read out, and then stays', () => {
    vi.useFakeTimers();
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
    // Not as the place stops being hidden, which would not be read out.
    expect(page.querySelector('[data-new-version-card]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(PHONE_SLIDE_OUT_MS);
    });
    expect(page.querySelector('[data-new-version-card="page"]')).toBeTruthy();

    act(() => store.set(phoneNavDrawerOpenAtom, true));
    expect(page.querySelector('[data-new-version-card="page"]')).toBeTruthy();
  });

  it('leaves from where it was dismissed, even if the list closes meanwhile', () => {
    vi.useFakeTimers();
    update.state.version = 'build-2';
    const list = document.body.appendChild(document.createElement('div'));
    const page = document.body.appendChild(document.createElement('div'));
    const store = getDefaultStore();
    act(() => {
      store.set(listNoticeSlotAtom, list);
      store.set(pageNoticeSlotAtom, page);
    });
    render(<NewVersionNotice />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    act(() => store.set(listNoticeSlotAtom, null));
    expect(list.querySelector('[data-new-version-card="list"][data-leaving]')).toBeTruthy();
    expect(page.textContent).toBe('');

    act(() => {
      vi.advanceTimersByTime(NOTICE_LEAVE_MS);
    });
    expect(list.textContent).toBe('');
    expect(page.textContent).toBe('');
  });

  it('comes in once, and shows at once when rebuilt in another list', () => {
    update.state.version = 'build-2';
    const first = document.body.appendChild(document.createElement('div'));
    const second = document.body.appendChild(document.createElement('div'));
    const store = getDefaultStore();
    act(() => store.set(listNoticeSlotAtom, first));
    render(<NewVersionNotice />);
    const arriving = first.querySelector<HTMLElement>('[data-new-version-card]');
    expect(arriving?.hasAttribute('data-settled')).toBe(false);

    fireEvent.animationEnd(arriving!);
    act(() => store.set(listNoticeSlotAtom, second));
    expect(second.querySelector('[data-new-version-card="list"][data-settled]')).toBeTruthy();
  });
});
