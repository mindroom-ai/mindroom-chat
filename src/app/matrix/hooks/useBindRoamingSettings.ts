import { useEffect } from 'react';
import { useStore } from 'jotai';
import {
  ClientEvent,
  SyncState,
  type MatrixClient,
  type MatrixEvent,
  type SyncStateData,
} from 'matrix-js-sdk';
import { listSessions } from '../session/sessions';
import { DEFAULT_SETTINGS, getSettings } from '../../preferences/settings';
import {
  ROAMING_SETTINGS_EVENT_TYPE,
  type RoamingSettings,
  forgetOrphanedPendingRoamingSettings,
  loadPendingRoamingSettings,
  mergeRoamingSettings,
  pendingRoamingSettingsAtom,
  pendingRoamingSettingsKey,
  readRoamingSettings,
  remainingRoamingEdits,
  roamingAccountContentAtom,
  roamingMigration,
  savePendingRoamingSettings,
  unconfirmedRoamingEdits,
} from '../../preferences/roamingSettings';

type Store = ReturnType<typeof useStore>;

const contentOf = (mx: MatrixClient): unknown =>
  mx.getAccountData(ROAMING_SETTINGS_EVENT_TYPE as never)?.getContent();

const writes = new WeakMap<MatrixClient, Promise<boolean>>();

/**
 * Stores the patch `makePatch` computes from the account's content right before the write, over
 * that content, after any earlier write of this client. An empty patch writes nothing. Resolves
 * `false` without writing when the stored content has a later version.
 */
const writeRoamingSettings = (
  mx: MatrixClient,
  makePatch: (content: unknown) => Partial<RoamingSettings>
): Promise<boolean> => {
  const task = (writes.get(mx) ?? Promise.resolve(true))
    .catch(() => false)
    .then(async () => {
      const content = contentOf(mx);
      const patch = makePatch(content);
      if (Object.keys(patch).length === 0) return true;
      const next = mergeRoamingSettings(content, patch);
      if (!next) return false;
      await mx.setAccountData(ROAMING_SETTINGS_EVENT_TYPE as never, next as never);
      return true;
    });
  writes.set(mx, task);
  return task;
};

/** A sync the homeserver answered just now, not one replayed from this device's cache. */
const isLive = (state: SyncState | null, data: SyncStateData | null | undefined): boolean =>
  (state === SyncState.Prepared || state === SyncState.Syncing) && !data?.fromCache;

/**
 * Binds the roaming settings of `mx`'s account in `store` and keeps the account's copy current;
 * returns the function that stops it.
 * - Seeds the account's content and this login's saved pending edits, and follows the content
 *   through sync.
 * - Sends while sync reaches the homeserver: on start, on each reconnect, and after each edit.
 *   Each write patches over the content of that moment. It holds the pending edits the account
 *   lacks and, once per session, the device values the account lacks (`roamingMigration`).
 * - A sent edit leaves pending once written, unless it changed meanwhile. A failed write keeps
 *   everything for the next reconnect or edit. Incoming account data never causes a write.
 */
export const bindRoamingSettings = (mx: MatrixClient, store: Store): (() => void) => {
  const userId = mx.getUserId();
  const deviceId = mx.getDeviceId();
  const storageKey = userId && deviceId ? pendingRoamingSettingsKey(userId, deviceId) : undefined;
  const logins = listSessions().map((session) =>
    pendingRoamingSettingsKey(session.userId, session.deviceId)
  );
  forgetOrphanedPendingRoamingSettings(storageKey ? [...logins, storageKey] : logins);
  store.set(roamingAccountContentAtom, contentOf(mx));
  store.set(pendingRoamingSettingsAtom, {
    storageKey,
    values: storageKey ? loadPendingRoamingSettings(storageKey) : {},
  });

  let bound = true;
  let online = isLive(mx.getSyncState(), mx.getSyncStateData());
  let migrated = false;
  let flushing = false;
  let again = false;

  /** This login's pending edits; undefined once the store holds another account's or none. */
  const ownPending = (): Partial<RoamingSettings> | undefined => {
    const pending = store.get(pendingRoamingSettingsAtom);
    return storageKey !== undefined && pending.storageKey === storageKey
      ? pending.values
      : undefined;
  };

  /** Drops the edits the account now holds: each one still at the value sent. */
  const confirm = (sent: Partial<RoamingSettings>): void => {
    const pending = ownPending();
    if (!pending || storageKey === undefined) return;
    const values = remainingRoamingEdits(pending, sent);
    if (Object.keys(values).length === Object.keys(pending).length) return;
    store.set(pendingRoamingSettingsAtom, { storageKey, values });
    savePendingRoamingSettings(storageKey, values);
  };

  const flush = (): void => {
    const pending = ownPending();
    if (!bound || !online || !pending) return;
    if (flushing) {
      again = true;
      return;
    }
    if (migrated && Object.keys(pending).length === 0) return;
    flushing = true;
    let sent: Partial<RoamingSettings> = {};
    void writeRoamingSettings(mx, (content) => {
      if (!bound) return {};
      // What happens from here on may be missing from this write, so it asks for another.
      again = false;
      const account = readRoamingSettings(content);
      sent = ownPending() ?? {};
      const migration = migrated ? {} : roamingMigration(account, getSettings(), DEFAULT_SETTINGS);
      return { ...migration, ...unconfirmedRoamingEdits(sent, account) };
    })
      .then((written) => {
        if (!written || !bound) return;
        migrated = true;
        confirm(sent);
      })
      .catch(() => undefined)
      .finally(() => {
        flushing = false;
        if (again) flush();
      });
  };

  const onSync = (state: SyncState, _previous: SyncState | null, data?: SyncStateData): void => {
    const live = isLive(state, data);
    const reconnected = live && !online;
    online = live;
    if (reconnected) flush();
  };
  const onAccountData = (event: MatrixEvent): void => {
    if (event.getType() === ROAMING_SETTINGS_EVENT_TYPE) {
      store.set(roamingAccountContentAtom, event.getContent());
    }
  };
  mx.on(ClientEvent.Sync, onSync);
  mx.on(ClientEvent.AccountData, onAccountData);
  const stopWatchingEdits = store.sub(pendingRoamingSettingsAtom, flush);
  flush();

  return () => {
    bound = false;
    stopWatchingEdits();
    mx.removeListener(ClientEvent.Sync, onSync);
    mx.removeListener(ClientEvent.AccountData, onAccountData);
  };
};

/** Binds the roaming settings of the client's account for as long as the client stays. */
export const useBindRoamingSettings = (mx: MatrixClient): void => {
  const store = useStore();
  useEffect(() => bindRoamingSettings(mx, store), [mx, store]);
};
