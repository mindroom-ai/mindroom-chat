// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { ClientEvent, SyncState } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { MAC_APP_DOWNLOAD_URL } from '../native/macApp';
import { tourAtom } from '../navigation/tourState';
import { MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE } from '../preferences/accountSettings';
import { listNoticeSlotAtom, NOTICE_LEAVE_MS, pageNoticeSlotAtom } from '../ui/noticeSlots';
import { MacAppOffer, resetAnsweredMacAppAccountsForTests } from './MacAppOffer';
import { TourOffer } from '../tour/TourOffer';
import { NewVersionNotice } from './NewVersionNotice';

const platform = vi.hoisted(() => ({ macBrowser: true }));

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: vi.fn() }));
vi.mock('../lib/user-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/user-agent')>()),
  isMacOS: () => platform.macBrowser,
}));
// A new version is known, for the test that shows both cards.
vi.mock('../config/appUpdate', () => ({
  getNewVersion: () => 'build-2',
  getReadyVersion: () => 'build-2',
  subscribeToNewVersion: () => () => undefined,
  reloadForNewVersion: async () => undefined,
}));

// A deployment that offers the Mac app, which none does unless it says so.
const OFFERED: ClientConfig = { macApp: { offer: true } };
const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';
const HOMESERVER = 'https://example.org';
// An account that has answered the tour's offer, so this one is due.
const TOURED = { tourOffered: true };

/**
 * A signed-in account: its `io.mindroom.settings` as the client holds it, and the writes it was
 * asked for. The client reads its stored copy until `sync`.
 */
const account = (
  stored: unknown = TOURED,
  { userId = ALICE, homeserver = HOMESERVER }: { userId?: string; homeserver?: string } = {}
) => {
  const settingsEvent = (content: unknown) => ({
    getType: () => MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE,
    getContent: () => content,
  });
  let held = stored === undefined ? undefined : settingsEvent(stored);
  const setAccountData = vi.fn(async (_type: string, _content: unknown): Promise<void> => {});
  let syncState: SyncState = SyncState.Prepared;
  const client = Object.assign(new EventEmitter(), {
    getSafeUserId: () => userId,
    getHomeserverUrl: () => homeserver,
    getSyncState: () => syncState,
    getSyncStateData: () => (syncState === SyncState.Prepared ? { fromCache: true } : undefined),
    getAccountData: (type: string) =>
      type === MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE ? held : undefined,
    setAccountData,
  });
  return {
    client,
    setAccountData,
    sync: (rendered = true) => {
      const before = syncState;
      syncState = SyncState.Syncing;
      const report = () => {
        client.emit(ClientEvent.Sync, syncState, before);
      };
      if (rendered) act(report);
      else report();
    },
    deliver: (content: unknown) => {
      held = settingsEvent(content);
      act(() => {
        client.emit(ClientEvent.AccountData, held);
      });
    },
  };
};

type Account = ReturnType<typeof account>;

const show = (
  { client, sync }: Account,
  {
    synced = true,
    config = OFFERED,
    list = false,
    phone = false,
    withNewVersion = false,
    withTourOffer = false,
  }: {
    synced?: boolean;
    config?: ClientConfig;
    list?: boolean;
    phone?: boolean;
    withNewVersion?: boolean;
    withTourOffer?: boolean;
  } = {}
) => {
  vi.mocked(useMatrixClient).mockReturnValue(
    client as unknown as ReturnType<typeof useMatrixClient>
  );
  const store = createStore();
  const page = document.body.appendChild(document.createElement('div'));
  if (phone) page.setAttribute('data-phone', '');
  const listPlace = document.body.appendChild(document.createElement('div'));
  store.set(pageNoticeSlotAtom, page);
  if (list) store.set(listNoticeSlotAtom, listPlace);
  if (synced) sync(false);
  render(
    <Provider store={store}>
      <ClientConfigProvider value={config}>
        {withNewVersion && <NewVersionNotice />}
        {withTourOffer && <TourOffer />}
        <MacAppOffer />
      </ClientConfigProvider>
    </Provider>
  );
  return { store, page, listPlace, completeSync: () => sync() };
};

const card = () => document.querySelector<HTMLElement>('[data-mac-app-offer]');
const button = (action: 'download' | 'later' | 'dismiss') => {
  const found = document.querySelector<HTMLElement>(`[data-mac-app-offer-action="${action}"]`);
  if (!found) throw new Error(`no ${action} button`);
  return found;
};
const settle = () => act(async () => {});

beforeEach(() => {
  platform.macBrowser = true;
  resetAnsweredMacAppAccountsForTests();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.mocked(useMatrixClient).mockReset();
  document.body.innerHTML = '';
});

describe('MacAppOffer', () => {
  it('offers the app in a row on the page once the client has synced with its server', () => {
    const alice = account();
    const { page, completeSync } = show(alice, { synced: false });
    expect(card()).toBeNull();

    completeSync();

    expect(page.contains(card())).toBe(true);
    expect(card()?.getAttribute('data-mac-app-offer-layout')).toBe('row');
    expect(card()?.textContent).toContain('Using a Mac? Get the MindRoom app.');
    const download = screen.getByRole('link', { name: 'Download for Mac' });
    expect(download.getAttribute('href')).toBe(MAC_APP_DOWNLOAD_URL);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBe(button('dismiss'));
  });

  it("is stacked with Not now in the room list's place, above a new version notice", () => {
    const { page, listPlace } = show(account(), { list: true, withNewVersion: true });

    expect(listPlace.contains(card())).toBe(true);
    expect(card()?.getAttribute('data-mac-app-offer-layout')).toBe('stacked');
    expect(card()?.textContent).toContain('MindRoom for Mac');
    expect(card()?.textContent).toContain('Quick Capture with ⌃⌥Space, native notifications.');
    expect(screen.getByRole('link', { name: 'Download' })).toBe(button('download'));
    expect(screen.getByRole('button', { name: 'Not now' })).toBe(button('later'));
    expect(listPlace.querySelector('[data-new-version-card="list"]')).toBeTruthy();
    expect(page.childElementCount).toBe(0);
  });

  it.each([
    ['says nothing', {}],
    ['turns it off', { macApp: { offer: false } }],
  ] as const)('shows nothing where the deployment %s', async (_case, config: ClientConfig) => {
    const alice = account();
    show(alice, { config, list: true });
    await settle();
    expect(card()).toBeNull();
    expect(alice.setAccountData).not.toHaveBeenCalled();
  });

  it('shows nothing outside a browser on a Mac, which the native app is not', async () => {
    platform.macBrowser = false;
    const alice = account();
    show(alice);
    await settle();
    expect(card()).toBeNull();
    expect(alice.setAccountData).not.toHaveBeenCalled();
  });

  it('shows nothing to an account that has answered', async () => {
    const alice = account({ ...TOURED, macAppOffered: true });
    show(alice);
    await settle();
    expect(card()).toBeNull();
    expect(alice.setAccountData).not.toHaveBeenCalled();
  });

  it("waits while the tour's offer is due, and over an open tour", () => {
    const alice = account({});
    const { store } = show(alice);
    expect(card()).toBeNull();

    alice.deliver(TOURED);
    expect(card()).toBeTruthy();

    act(() => store.set(tourAtom, { level: 'quick' }));
    expect(card()).toBeNull();
    act(() => store.set(tourAtom, undefined));
    expect(card()).toBeTruthy();
  });

  it("does not wait for a tour's offer the deployment turned off", () => {
    show(account({}), { config: { ...OFFERED, tour: { offerAtStart: false } } });
    expect(card()).toBeTruthy();
  });

  it.each(['download', 'later', 'dismiss'] as const)(
    '%s plays the card out and stores the answer, over what the account had',
    async (action) => {
      vi.useFakeTimers();
      const alice = account({ ...TOURED, fromANewerClient: 1 });
      show(alice, { list: true });

      fireEvent.click(button(action));
      await settle();

      expect(card()?.hasAttribute('data-leaving')).toBe(true);
      expect(alice.setAccountData.mock.calls).toEqual([
        [
          MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE,
          { ...TOURED, fromANewerClient: 1, macAppOffered: true },
        ],
      ]);
      act(() => {
        vi.advanceTimersByTime(NOTICE_LEAVE_MS);
      });
      expect(card()).toBeNull();

      // Shown again on this page, before the write's echo: the answer stands.
      cleanup();
      show(alice);
      await settle();
      expect(card()).toBeNull();
    }
  );

  it("goes when another device's answer arrives, and shows nothing when the sync brings one", async () => {
    const alice = account();
    const { completeSync } = show(alice, { synced: false });
    alice.deliver({ ...TOURED, macAppOffered: true });
    completeSync();
    await settle();
    expect(card()).toBeNull();

    cleanup();
    const bob = account(TOURED, { userId: BOB });
    show(bob);
    expect(card()).toBeTruthy();
    bob.deliver({ ...TOURED, macAppOffered: true });
    await settle();
    expect(card()).toBeNull();
    expect(alice.setAccountData).not.toHaveBeenCalled();
    expect(bob.setAccountData).not.toHaveBeenCalled();
  });

  it("keeps the one line on a narrow window's page place, which a Mac browser gets", () => {
    const { page } = show(account(), { phone: true });

    expect(page.contains(card())).toBe(true);
    expect(card()?.getAttribute('data-mac-app-offer-layout')).toBe('row');
    expect(card()?.textContent).toContain('Using a Mac? Get the MindRoom app.');
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });

  it('keeps an answer to the account that gave it, also for the same user on another server', async () => {
    vi.useFakeTimers();
    const here = account(TOURED, { homeserver: 'https://one.example.org' });
    show(here);
    fireEvent.click(button('dismiss'));
    await settle();
    act(() => {
      vi.advanceTimersByTime(NOTICE_LEAVE_MS);
    });
    cleanup();

    const there = account(TOURED, { homeserver: 'https://two.example.org' });
    show(there);
    await settle();
    expect(card()).toBeTruthy();
    expect(here.setAccountData).toHaveBeenCalledOnce();
    expect(there.setAccountData).not.toHaveBeenCalled();
  });

  it("comes once the tour's offer is answered on this page, though its write was refused", async () => {
    vi.useFakeTimers();
    const alice = account({});
    alice.setAccountData.mockRejectedValue(new Error('offline'));
    show(alice, { withTourOffer: true });
    expect(document.querySelector('[data-tour-offer]')).toBeTruthy();
    expect(card()).toBeNull();

    fireEvent.click(
      document.querySelector<HTMLElement>('[data-tour-offer-action="dismiss"]') ?? document.body
    );
    await settle();
    act(() => {
      vi.advanceTimersByTime(NOTICE_LEAVE_MS);
    });

    expect(document.querySelector('[data-tour-offer]')).toBeNull();
    expect(card()).toBeTruthy();
    expect(alice.setAccountData.mock.calls).toEqual([
      [MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE, { tourOffered: true }],
    ]);
  });
});
