// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { createStore } from 'jotai';
import { ClientEvent, SyncState, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type Settings,
  getSettings,
  settingsAtom,
} from '../../preferences/settings';
import {
  ROAMING_SETTINGS_EVENT_TYPE,
  loadPendingRoamingSettings,
  pendingRoamingSettingsAtom,
  pendingRoamingSettingsKey,
  roamingAccountContentAtom,
  savePendingRoamingSettings,
} from '../../preferences/roamingSettings';
import { bindRoamingSettings } from './useBindRoamingSettings';

const logins = vi.hoisted(() => ({ stored: [] as { userId: string; deviceId: string }[] }));
vi.mock('../session/sessions', () => ({ listSessions: () => logins.stored }));

const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';

type Content = Record<string, unknown> | undefined;

/**
 * One account's `io.mindroom.client.settings` on the homeserver, echoed to its clients by sync:
 * at once, or with `lag` only when `deliver` runs, as one sync carrying the latest content.
 */
const homeserver = ({ lag = false } = {}) => {
  let content: Content;
  const clients = new Set<{ connected: boolean; receive: (next: Content) => void }>();
  const deliver = () => clients.forEach((client) => client.connected && client.receive(content));
  return {
    /** The stored settings, without the revision bookkeeping of each write. */
    get content() {
      if (!content) return content;
      const { rev, base_rev: baseRev, ...settings } = content;
      return settings;
    },
    get raw() {
      return content;
    },
    put(next: Content) {
      content = structuredClone(next);
      if (!lag) deliver();
    },
    deliver,
    attach(client: { connected: boolean; receive: (next: Content) => void }) {
      clients.add(client);
    },
  };
};

type Homeserver = ReturnType<typeof homeserver>;

/**
 * A Matrix client of one login: what sync delivered, the sync state, and writes that reach the
 * homeserver only while connected, at once. As the SDK's `setAccountData` does, a write resolves
 * once sync delivers the next roaming settings account data after the call, whoever wrote it, and
 * after the listeners the app bound before the write.
 */
const login = (
  server: Homeserver,
  userId: string,
  deviceId: string,
  start: { state: SyncState; fromCache?: boolean } = { state: SyncState.Syncing }
) => {
  const emitter = new EventEmitter();
  let held = server.raw;
  let state: SyncState | null = start.state;
  let data: { fromCache?: boolean } = start.fromCache ? { fromCache: true } : {};
  const sync = (next: SyncState, nextData: { fromCache?: boolean } = {}) => {
    const previous = state;
    state = next;
    data = nextData;
    emitter.emit(ClientEvent.Sync, next, previous, nextData);
  };
  const echoed: (() => void)[] = [];
  const client = {
    connected: true,
    receive(next: Content) {
      if (next === held) return;
      held = next;
      emitter.emit(ClientEvent.AccountData, {
        getType: () => ROAMING_SETTINGS_EVENT_TYPE,
        getContent: () => next,
      });
      echoed.splice(0).forEach((resolve) => resolve());
    },
  };
  server.attach(client);
  const setAccountData = vi.fn(async (_type: string, next: Record<string, unknown>) => {
    if (!client.connected) throw new Error('ConnectionError: offline');
    const echo = new Promise<void>((resolve) => {
      echoed.push(resolve);
    });
    server.put(next);
    await echo;
    return {};
  });
  const mx = {
    getUserId: () => userId,
    getDeviceId: () => deviceId,
    getAccountData: (type: string) =>
      type === ROAMING_SETTINGS_EVENT_TYPE && held !== undefined
        ? { getContent: () => held }
        : undefined,
    setAccountData,
    // While sync is Prepared or Syncing the SDK answers from the client's copy, not the homeserver.
    getAccountDataFromServer: vi.fn(async () => {
      if (state === SyncState.Prepared || state === SyncState.Syncing) return held ?? null;
      if (!client.connected) throw new Error('ConnectionError: offline');
      return server.raw ?? null;
    }),
    getSyncState: () => state,
    getSyncStateData: () => data,
    on: (event: string, listener: (...args: unknown[]) => void) => emitter.on(event, listener),
    removeListener: (event: string, listener: (...args: unknown[]) => void) =>
      emitter.removeListener(event, listener),
  } as unknown as MatrixClient;
  return {
    mx,
    setAccountData,
    sync,
    listeners: () =>
      emitter.listenerCount(ClientEvent.Sync) + emitter.listenerCount(ClientEvent.AccountData),
    goOffline() {
      client.connected = false;
      sync(SyncState.Reconnecting);
    },
    goOnline() {
      client.connected = true;
      client.receive(server.raw);
      sync(SyncState.Syncing);
    },
  };
};

type Login = ReturnType<typeof login>;

/** The app of one device signed in with `client`: its own jotai store, bound as on start. */
const open = (client: Login) => {
  const store = createStore();
  const unbind = bindRoamingSettings(client.mx, store);
  return {
    store,
    unbind,
    shown: () => store.get(settingsAtom),
    pending: () => store.get(pendingRoamingSettingsAtom).values,
    /** What `useSetting` does: one field over everything the atom shows. */
    change: <K extends keyof Settings>(key: K, value: Settings[K]) =>
      store.set(settingsAtom, { ...store.get(settingsAtom), [key]: value }),
  };
};

const storeDevice = (changes: Partial<Settings>) =>
  localStorage.setItem('settings', JSON.stringify({ ...DEFAULT_SETTINGS, ...changes }));

/** Lets queued writes and their echoes run. */
const settle = async () => {
  for (let turn = 0; turn < 5; turn += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

afterEach(() => {
  localStorage.clear();
  logins.stored = [];
});

describe('bindRoamingSettings', () => {
  it('sends nothing while sync replays the cache or is offline, and migrates at the first live sync', async () => {
    storeDevice({ hour24Clock: true, pageZoom: 120 });
    const server = homeserver();
    const phone = login(server, ALICE, 'PHONE', { state: SyncState.Prepared, fromCache: true });
    logins.stored = [{ userId: ALICE, deviceId: 'PHONE' }];
    const app = open(phone);

    await settle();
    phone.sync(SyncState.Reconnecting);
    await settle();
    expect(phone.setAccountData).not.toHaveBeenCalled();
    expect(app.shown().hour24Clock).toBe(true);

    phone.sync(SyncState.Syncing);
    await vi.waitFor(() => expect(server.content).toEqual({ version: 1, hour24Clock: true }));
    // Later syncs while online send nothing more.
    phone.sync(SyncState.Syncing);
    await settle();
    expect(phone.setAccountData).toHaveBeenCalledTimes(1);
    app.unbind();
  });

  it('sends nothing when nothing differs from the default or the account', async () => {
    const server = homeserver();
    server.put({ version: 1, isMarkdown: false });
    const phone = login(server, ALICE, 'PHONE');
    const app = open(phone);

    await settle();
    expect(phone.setAccountData).not.toHaveBeenCalled();
    expect(app.shown().isMarkdown).toBe(false);
    app.unbind();
  });

  it('sends an edit at once, over the stored content, and keeps the keys it does not know', async () => {
    const server = homeserver();
    server.put({ version: 1, isMarkdown: false, laterKey: 'kept' });
    const phone = login(server, ALICE, 'PHONE');
    const app = open(phone);

    app.change('hour24Clock', true);
    expect(app.shown().hour24Clock).toBe(true);
    await vi.waitFor(() =>
      expect(server.content).toEqual({
        version: 1,
        isMarkdown: false,
        laterKey: 'kept',
        hour24Clock: true,
      })
    );
    await vi.waitFor(() => expect(app.pending()).toEqual({}));
    expect(loadPendingRoamingSettings(pendingRoamingSettingsKey(ALICE, 'PHONE'))).toEqual({});
    // The device entry keeps the value it had before the setting roamed: no clock of its own.
    expect(getSettings().hour24Clock).toBeUndefined();
    app.unbind();
  });

  it('keeps an edit that changed while its write was on the way, and sends it next', async () => {
    const server = homeserver();
    const phone = login(server, ALICE, 'PHONE');
    let release: () => void = () => undefined;
    phone.setAccountData.mockImplementationOnce(async (_type, next) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      server.put(next);
      return {};
    });
    const app = open(phone);

    app.change('hour24Clock', true);
    await vi.waitFor(() => expect(phone.setAccountData).toHaveBeenCalledTimes(1));
    app.change('hour24Clock', false);
    release();

    await vi.waitFor(() => expect(phone.setAccountData).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(app.pending()).toEqual({}));
    expect(server.content).toEqual({ version: 1, hour24Clock: false });
    expect(app.shown().hour24Clock).toBe(false);
    app.unbind();
  });

  it('keeps a failed edit, sends nothing more while still online, and retries on reconnect', async () => {
    const server = homeserver();
    const phone = login(server, ALICE, 'PHONE');
    phone.setAccountData.mockRejectedValueOnce(new Error('M_UNKNOWN'));
    const app = open(phone);

    app.change('isMarkdown', false);
    await settle();
    expect(phone.setAccountData).toHaveBeenCalledTimes(1);
    expect(app.pending()).toEqual({ isMarkdown: false });
    expect(app.shown().isMarkdown).toBe(false);
    phone.sync(SyncState.Syncing);
    await settle();
    expect(phone.setAccountData).toHaveBeenCalledTimes(1);

    phone.sync(SyncState.Reconnecting);
    phone.sync(SyncState.Syncing);
    await vi.waitFor(() => expect(server.content).toEqual({ version: 1, isMarkdown: false }));
    await vi.waitFor(() => expect(app.pending()).toEqual({}));
    app.unbind();
  });

  it('lets the account win the migration, also where another device filled a gap before the write', async () => {
    storeDevice({ dateFormatString: 'DD/MM/YYYY', hour24Clock: true, hideActivity: true });
    const server = homeserver();
    server.put({ version: 1, dateFormatString: 'YYYY-MM-DD' });
    const laptop = login(server, ALICE, 'LAPTOP');
    const app = open(laptop);
    // Another device sets the clock after this one queued its write and before the write ran.
    // Sync brings it here at once (no lag), so the write reads it from the client's copy.
    server.put({ version: 1, dateFormatString: 'YYYY-MM-DD', hour24Clock: false });

    await vi.waitFor(() =>
      expect(server.content).toEqual({
        version: 1,
        dateFormatString: 'YYYY-MM-DD',
        hour24Clock: false,
        hideActivity: true,
      })
    );
    expect(laptop.setAccountData).toHaveBeenCalledTimes(1);
    expect(app.shown().dateFormatString).toBe('YYYY-MM-DD');
    expect(app.shown().hour24Clock).toBe(false);
    expect(app.shown().hideActivity).toBe(true);
    expect(getSettings().dateFormatString).toBe('DD/MM/YYYY');
    app.unbind();
  });

  it('gives each device every change of the other; per setting the last write wins', async () => {
    logins.stored = [
      { userId: ALICE, deviceId: 'PHONE' },
      { userId: ALICE, deviceId: 'LAPTOP' },
    ];
    const server = homeserver();
    const phone = open(login(server, ALICE, 'PHONE'));
    const laptop = open(login(server, ALICE, 'LAPTOP'));

    phone.change('hour24Clock', true);
    await vi.waitFor(() => expect(laptop.shown().hour24Clock).toBe(true));
    laptop.change('isMarkdown', false);
    await vi.waitFor(() => expect(phone.shown().isMarkdown).toBe(false));
    expect(server.content).toEqual({ version: 1, hour24Clock: true, isMarkdown: false });

    phone.change('dateFormatString', 'DD/MM/YYYY');
    await vi.waitFor(() => expect(laptop.shown().dateFormatString).toBe('DD/MM/YYYY'));
    laptop.change('dateFormatString', 'YYYY-MM-DD');
    await vi.waitFor(() => expect(phone.shown().dateFormatString).toBe('YYYY-MM-DD'));
    expect(server.content).toEqual({
      version: 1,
      hour24Clock: true,
      isMarkdown: false,
      dateFormatString: 'YYYY-MM-DD',
    });
    phone.unbind();
    laptop.unbind();
  });

  // Known failure, #328: the known limit in the doc of `bindRoamingSettings`. `it.fails` reports a
  // failure once this passes.
  it.fails(
    'keeps both changes when two devices change different settings at the same moment (#328)',
    async () => {
      logins.stored = [
        { userId: ALICE, deviceId: 'PHONE' },
        { userId: ALICE, deviceId: 'LAPTOP' },
      ];
      const server = homeserver({ lag: true });
      const phone = open(login(server, ALICE, 'PHONE'));
      const laptop = open(login(server, ALICE, 'LAPTOP'));
      await settle();

      // Both writes reach the homeserver before sync tells either device about the other.
      phone.change('hour24Clock', true);
      laptop.change('isMarkdown', false);
      await settle();
      server.deliver();
      await settle();
      server.deliver();

      await vi.waitFor(() =>
        expect(server.content).toEqual({ version: 1, hour24Clock: true, isMarkdown: false })
      );
      // The repair names the write it patched: the laptop's.
      expect(server.raw?.base_rev).toEqual(expect.any(String));
      server.deliver();
      for (const app of [phone, laptop]) {
        expect(app.shown().hour24Clock).toBe(true);
        expect(app.shown().isMarkdown).toBe(false);
      }
      phone.unbind();
      laptop.unbind();
    }
  );

  it('takes a change another device made after seeing this one', async () => {
    logins.stored = [
      { userId: ALICE, deviceId: 'PHONE' },
      { userId: ALICE, deviceId: 'LAPTOP' },
    ];
    const server = homeserver();
    const phone = open(login(server, ALICE, 'PHONE'));
    const laptop = open(login(server, ALICE, 'LAPTOP'));

    phone.change('hour24Clock', true);
    await vi.waitFor(() => expect(laptop.shown().hour24Clock).toBe(true));
    laptop.change('hour24Clock', false);
    await vi.waitFor(() => expect(phone.shown().hour24Clock).toBe(false));
    await settle();
    expect(server.content).toEqual({ version: 1, hour24Clock: false });
    phone.unbind();
    laptop.unbind();
  });

  it('applies an offline edit at once, keeps it over a reload, and sends it on reconnect', async () => {
    logins.stored = [
      { userId: ALICE, deviceId: 'PHONE' },
      { userId: ALICE, deviceId: 'LAPTOP' },
    ];
    const server = homeserver();
    const phoneLogin = login(server, ALICE, 'PHONE');
    const phone = open(phoneLogin);
    const laptop = open(login(server, ALICE, 'LAPTOP'));
    await settle();

    phoneLogin.goOffline();
    phone.change('hideMembershipEvents', true);
    phone.change('dateFormatString', 'DD/MM/YYYY');
    expect(phone.shown().hideMembershipEvents).toBe(true);
    // The laptop changes the date format later, while the phone is still offline.
    laptop.change('dateFormatString', 'YYYY-MM-DD');
    await settle();
    expect(phoneLogin.setAccountData).not.toHaveBeenCalled();
    expect(laptop.shown().hideMembershipEvents).toBe(false);

    // The app restarts while offline: the edits come back from localStorage.
    phone.unbind();
    const restarted = open(phoneLogin);
    expect(restarted.shown().hideMembershipEvents).toBe(true);
    expect(restarted.shown().dateFormatString).toBe('DD/MM/YYYY');

    phoneLogin.goOnline();
    await vi.waitFor(() => expect(laptop.shown().hideMembershipEvents).toBe(true));
    // The write order decides: the phone's older edit, sent last, wins everywhere.
    await vi.waitFor(() => expect(laptop.shown().dateFormatString).toBe('DD/MM/YYYY'));
    await vi.waitFor(() => expect(restarted.pending()).toEqual({}));
    expect(restarted.shown().dateFormatString).toBe('DD/MM/YYYY');
    restarted.unbind();
    laptop.unbind();
  });

  it("keeps each account's values and unsent edits to that account across a switch", async () => {
    const aliceServer = homeserver();
    const bobServer = homeserver();
    bobServer.put({ version: 1, isMarkdown: false });
    const alicePhone = login(aliceServer, ALICE, 'ALICEPHONE');
    const bobPhone = login(bobServer, BOB, 'BOBPHONE');
    logins.stored = [
      { userId: ALICE, deviceId: 'ALICEPHONE' },
      { userId: BOB, deviceId: 'BOBPHONE' },
    ];
    const store = createStore();
    const change = <K extends keyof Settings>(key: K, value: Settings[K]) =>
      store.set(settingsAtom, { ...store.get(settingsAtom), [key]: value });
    // What `forgetAccountState` does with these atoms, before the old binding's cleanup.
    const forgetAccount = () => {
      store.set(roamingAccountContentAtom, undefined);
      store.set(pendingRoamingSettingsAtom, { values: {} });
    };

    alicePhone.goOffline();
    let unbind = bindRoamingSettings(alicePhone.mx, store);
    change('hour24Clock', true);
    forgetAccount();
    unbind();

    unbind = bindRoamingSettings(bobPhone.mx, store);
    expect(store.get(settingsAtom).hour24Clock).toBeUndefined();
    expect(store.get(settingsAtom).isMarkdown).toBe(false);
    expect(store.get(pendingRoamingSettingsAtom).values).toEqual({});
    change('hideActivity', true);
    await vi.waitFor(() =>
      expect(bobServer.content).toEqual({ version: 1, isMarkdown: false, hideActivity: true })
    );
    expect(loadPendingRoamingSettings(pendingRoamingSettingsKey(ALICE, 'ALICEPHONE'))).toEqual({
      hour24Clock: true,
    });
    forgetAccount();
    unbind();

    unbind = bindRoamingSettings(alicePhone.mx, store);
    expect(store.get(settingsAtom).hour24Clock).toBe(true);
    expect(store.get(settingsAtom).hideActivity).toBe(false);
    alicePhone.goOnline();
    await vi.waitFor(() => expect(aliceServer.content).toEqual({ version: 1, hour24Clock: true }));
    expect(bobServer.content).toEqual({ version: 1, isMarkdown: false, hideActivity: true });
    unbind();
    expect(alicePhone.listeners()).toBe(0);
    expect(bobPhone.listeners()).toBe(0);
  });

  it('deletes the unsent edits of logins this browser no longer keeps', () => {
    const removed = pendingRoamingSettingsKey(BOB, 'BOBPHONE');
    const own = pendingRoamingSettingsKey(ALICE, 'PHONE');
    savePendingRoamingSettings(removed, { hideActivity: true });
    savePendingRoamingSettings(own, { hour24Clock: true });
    logins.stored = [{ userId: ALICE, deviceId: 'PHONE' }];
    const phone = login(homeserver(), ALICE, 'PHONE');
    phone.goOffline();

    const app = open(phone);

    expect(localStorage.getItem(removed)).toBeNull();
    expect(app.pending()).toEqual({ hour24Clock: true });
    app.unbind();
  });

  it('leaves content of a later version alone and keeps its edits on this device', async () => {
    storeDevice({ hour24Clock: true });
    const server = homeserver();
    server.put({ version: 2, hour24Clock: 'h23', isMarkdown: false });
    const phone = login(server, ALICE, 'PHONE');
    const app = open(phone);

    app.change('enterForNewline', true);
    await settle();
    expect(phone.setAccountData).not.toHaveBeenCalled();
    expect(server.content).toEqual({ version: 2, hour24Clock: 'h23', isMarkdown: false });
    expect(app.shown().hour24Clock).toBe(true);
    expect(app.shown().isMarkdown).toBe(true);
    expect(app.shown().enterForNewline).toBe(true);
    expect(app.pending()).toEqual({ enterForNewline: true });
    app.unbind();
  });
});
