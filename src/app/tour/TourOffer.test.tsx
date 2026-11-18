// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { ClientEvent, SyncState } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { PHONE_SLIDE_OUT_MS, phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { tourAtom } from '../navigation/tourState';
import { MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE } from '../preferences/accountSettings';
import { NewVersionNotice } from '../shell/NewVersionNotice';
import { listNoticeSlotAtom, NOTICE_LEAVE_MS, pageNoticeSlotAtom } from '../ui/noticeSlots';
import { TourOffer } from './TourOffer';

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: vi.fn() }));
// A new version is known, for the test that shows both cards.
vi.mock('../config/appUpdate', () => ({
  getNewVersion: () => 'build-2',
  getReadyVersion: () => 'build-2',
  subscribeToNewVersion: () => () => undefined,
  reloadForNewVersion: async () => undefined,
}));

const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';

/**
 * A signed-in account: its `io.mindroom.settings` as the client holds it (none until `stored` or
 * `deliver`), and the writes it was asked for.
 */
const account = (userId: string, stored?: unknown) => {
  const settingsEvent = (content: unknown) => ({
    getType: () => MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE,
    getContent: () => content,
  });
  let held = stored === undefined ? undefined : settingsEvent(stored);
  const setAccountData = vi.fn(async (_type: string, _content: unknown): Promise<void> => {});
  // Read from its stored copy, as a start is before the server has answered.
  let syncState: SyncState = SyncState.Prepared;
  const client = Object.assign(new EventEmitter(), {
    getSafeUserId: () => userId,
    getHomeserverUrl: () => 'https://example.org',
    getSyncState: () => syncState,
    getSyncStateData: () => (syncState === SyncState.Prepared ? { fromCache: true } : undefined),
    getAccountData: (type: string) =>
      type === MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE ? held : undefined,
    setAccountData,
  });
  return {
    client,
    setAccountData,
    /** The server answers the client's first sync of this start. */
    sync: (rendered = true) => {
      const before = syncState;
      syncState = SyncState.Syncing;
      const report = () => {
        client.emit(ClientEvent.Sync, syncState, before);
      };
      if (rendered) act(report);
      else report();
    },
    /** A sync brings the account's settings. */
    deliver: (content: unknown) => {
      held = settingsEvent(content);
      act(() => {
        client.emit(ClientEvent.AccountData, held);
      });
    },
  };
};

type Account = ReturnType<typeof account>;

/**
 * Renders the offer for the account on a page that offers the page's notice place (and the room
 * list's, with `list`); with `places: false` only once `offerPlaces()` is called. `everShown()`
 * says whether a card was ever put into a place.
 */
const show = (
  { client, sync }: Account,
  {
    synced = true,
    config = {},
    places = true,
    list = false,
    phone = false,
    withNewVersion = false,
    store = createStore(),
  }: {
    /** The page's store, which keeps the accounts that answered for the life of the page. */
    store?: ReturnType<typeof createStore>;
    synced?: boolean;
    config?: ClientConfig;
    places?: boolean;
    list?: boolean;
    phone?: boolean;
    withNewVersion?: boolean;
  } = {}
) => {
  vi.mocked(useMatrixClient).mockReturnValue(
    client as unknown as ReturnType<typeof useMatrixClient>
  );
  const page = document.body.appendChild(document.createElement('div'));
  if (phone) page.setAttribute('data-phone', '');
  const listPlace = document.body.appendChild(document.createElement('div'));
  const offerPlaces = () => {
    store.set(pageNoticeSlotAtom, page);
    if (list) store.set(listNoticeSlotAtom, listPlace);
  };
  if (places) offerPlaces();
  let shown = false;
  const noteCards = (records: MutationRecord[]) => {
    shown ||= records.some((record) => record.addedNodes.length > 0);
  };
  const observer = new MutationObserver(noteCards);
  [page, listPlace].forEach((place) => observer.observe(place, { childList: true }));
  if (synced) sync(false);
  render(
    <Provider store={store}>
      <ClientConfigProvider value={config}>
        {withNewVersion && <NewVersionNotice />}
        <TourOffer />
      </ClientConfigProvider>
    </Provider>
  );
  return {
    store,
    page,
    listPlace,
    offerPlaces,
    /** The server answers the client's first sync of this start. */
    completeSync: () => sync(),
    everShown: () => {
      noteCards(observer.takeRecords());
      return shown;
    },
  };
};

const card = (place: HTMLElement) => place.querySelector<HTMLElement>('[data-tour-offer]');
const button = (action: 'quick' | 'full' | 'dismiss') => {
  const found = document.querySelector<HTMLElement>(`[data-tour-offer-action="${action}"]`);
  if (!found) throw new Error(`no ${action} button`);
  return found;
};
/** Lets a started write reach the client. */
const settle = () => act(async () => {});
const playOut = () =>
  act(() => {
    vi.advanceTimersByTime(NOTICE_LEAVE_MS);
  });

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.mocked(useMatrixClient).mockReset();
  document.body.innerHTML = '';
});

describe('TourOffer', () => {
  it('shows nothing before the client has synced with its server, nor after when that brought the answer', async () => {
    const alice = account(ALICE);
    const { page, completeSync, everShown } = show(alice, { synced: false });
    expect(card(page)).toBeNull();

    alice.deliver({ tourOffered: true });
    completeSync();
    await settle();

    expect(everShown()).toBe(false);
    expect(alice.setAccountData).not.toHaveBeenCalled();
  });

  it('offers the tour once the client has synced with its server and found no answer', () => {
    const alice = account(ALICE);
    const { page, completeSync } = show(alice, { synced: false });

    alice.deliver({ showThreadsInSidebar: true });
    completeSync();

    expect(card(page)?.getAttribute('data-tour-offer')).toBe('page');
    expect(card(page)?.textContent).toContain('Take a tour of MindRoom');
    expect(card(page)?.textContent).toContain('See how threads, titles and states work.');
    expect(screen.getByRole('button', { name: 'Quick tour (1 min)' })).toBe(button('quick'));
    expect(screen.getByRole('button', { name: 'Full tour (5 min)' })).toBe(button('full'));
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBe(button('dismiss'));
  });

  it('offers it to an account with no settings, or with settings that are not an object', () => {
    expect(card(show(account(ALICE)).page)).toBeTruthy();
    cleanup();
    expect(card(show(account(BOB, 'nonsense')).page)).toBeTruthy();
    cleanup();
    expect(card(show(account(BOB, { tourOffered: 'yes' })).page)).toBeTruthy();
  });

  it("takes the room list's place while there is one, beside a new version notice", () => {
    const { page, listPlace } = show(account(ALICE), { list: true, withNewVersion: true });

    expect(card(listPlace)?.getAttribute('data-tour-offer')).toBe('list');
    expect(listPlace.querySelector('[data-new-version-card="list"]')).toBeTruthy();
    expect(page.childElementCount).toBe(0);
  });

  it('shows nothing to an account that has answered', async () => {
    const alice = account(ALICE, { tourOffered: true });
    const { everShown } = show(alice);
    await settle();

    expect(everShown()).toBe(false);
    expect(alice.setAccountData).not.toHaveBeenCalled();
  });

  it('shows nothing where the deployment turned the offer off', () => {
    const { everShown } = show(account(ALICE), { config: { tour: { offerAtStart: false } } });
    expect(everShown()).toBe(false);
    cleanup();
    expect(
      card(show(account(ALICE), { config: { tour: { offerAtStart: true } } }).page)
    ).toBeTruthy();
  });

  it("goes when another device's answer arrives, without a write of its own", async () => {
    const alice = account(ALICE, { showThreadsInSidebar: true });
    const { page } = show(alice);
    expect(card(page)).toBeTruthy();

    alice.deliver({ showThreadsInSidebar: true, tourOffered: true });
    await settle();

    expect(card(page)).toBeNull();
    expect(alice.setAccountData).not.toHaveBeenCalled();
  });

  it.each([
    ['quick', { level: 'quick' }],
    ['full', { level: 'full' }],
    ['dismiss', undefined],
  ] as const)('%s plays the card out and stores the answer', async (action, tour) => {
    vi.useFakeTimers();
    const alice = account(ALICE, { showThreadsInSidebar: true, fromANewerClient: 1 });
    const { store, page } = show(alice);

    fireEvent.click(button(action));
    await settle();

    expect(store.get(tourAtom)).toEqual(tour);
    expect(card(page)?.hasAttribute('data-leaving')).toBe(true);
    // Over what the account had stored, which stays.
    expect(alice.setAccountData.mock.calls).toEqual([
      [
        MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE,
        { showThreadsInSidebar: true, fromANewerClient: 1, tourOffered: true },
      ],
    ]);

    playOut();
    expect(card(page)).toBeNull();
    // The tour closes: the answer stands, though the write's echo has not come.
    act(() => store.set(tourAtom, undefined));
    expect(card(page)).toBeNull();
    expect(alice.setAccountData).toHaveBeenCalledOnce();
  });

  it('counts the tour opened from anywhere else as the answer', async () => {
    const alice = account(ALICE);
    const { store, page } = show(alice);
    expect(card(page)).toBeTruthy();

    act(() => store.set(tourAtom, { level: 'full' }));
    await settle();
    expect(card(page)).toBeNull();
    expect(alice.setAccountData.mock.calls).toEqual([
      [MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE, { tourOffered: true }],
    ]);

    act(() => store.set(tourAtom, undefined));
    expect(card(page)).toBeNull();
    expect(alice.setAccountData).toHaveBeenCalledOnce();
  });

  it('stores an answer given before the client has synced with its server only once it has, over what the sync brought', async () => {
    const alice = account(ALICE);
    const { store, completeSync, everShown } = show(alice, { synced: false });

    act(() => store.set(tourAtom, { level: 'quick' }));
    await settle();
    expect(alice.setAccountData).not.toHaveBeenCalled();

    alice.deliver({ showThreadsInSidebar: true });
    await settle();
    expect(alice.setAccountData).not.toHaveBeenCalled();

    completeSync();
    await settle();
    expect(alice.setAccountData.mock.calls).toEqual([
      [MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE, { showThreadsInSidebar: true, tourOffered: true }],
    ]);
    expect(everShown()).toBe(false);
  });

  it('stores nothing for an answer given before the client has synced when the sync brings one', async () => {
    const alice = account(ALICE);
    const { store, completeSync } = show(alice, { synced: false });

    act(() => store.set(tourAtom, { level: 'quick' }));
    alice.deliver({ tourOffered: true });
    completeSync();
    await settle();

    expect(alice.setAccountData).not.toHaveBeenCalled();
  });

  it('remembers an answered account for the life of the page, also after another account', async () => {
    vi.useFakeTimers();
    const alice = account(ALICE);
    const { store } = show(alice);
    fireEvent.click(button('dismiss'));
    await settle();
    playOut();
    cleanup();

    expect(card(show(account(BOB), { store }).page)).toBeTruthy();
    cleanup();

    // Alice's settings still lack the answer: the write's echo has not come.
    const { everShown } = show(alice, { store });
    await settle();
    expect(everShown()).toBe(false);
  });

  it('leaves a refused write alone: the card stays away', async () => {
    vi.useFakeTimers();
    const alice = account(ALICE);
    alice.setAccountData.mockRejectedValue(new Error('offline'));
    const { page, completeSync } = show(alice);

    fireEvent.click(button('dismiss'));
    await settle();
    playOut();
    completeSync();
    await settle();

    expect(card(page)).toBeNull();
    expect(alice.setAccountData).toHaveBeenCalledOnce();
  });

  it('waits on a phone until the drawer over its place has slid away, also when the place comes after the offer', () => {
    vi.useFakeTimers();
    const { store, page, offerPlaces } = show(account(ALICE), { phone: true, places: false });
    expect(card(page)).toBeNull();

    // The page mounts after the offer: it offers its place and brings the drawer out in one go.
    act(() => {
      offerPlaces();
      store.set(phoneNavDrawerOpenAtom, true);
    });
    expect(card(page)).toBeNull();

    act(() => store.set(phoneNavDrawerOpenAtom, false));
    expect(card(page)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(PHONE_SLIDE_OUT_MS);
    });
    expect(card(page)?.getAttribute('data-tour-offer')).toBe('page');
  });
});
