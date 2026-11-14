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
import { isRecord } from '../../lib/isRecord';
import { randomUuid } from '../../lib/randomUuid';
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

/** A write of this client: the content it stored, and the content it patched. */
type Write = { stored: Record<string, unknown>; base: Record<string, unknown> };

const writes = new WeakMap<MatrixClient, Promise<Write | null | undefined>>();

/**
 * Stores the patch `makePatch` computes from the account's content right before the write, over
 * that content, after any earlier write of this client. `getAccountDataFromServer` asks the
 * homeserver only until the first sync completes; while sync is live (Prepared or Syncing) the
 * SDK answers from the client's copy, the content sync last delivered, so a change another device
 * stored that sync has not brought yet is missing and gets patched over. The stored content gets
 * a new `rev` and names the one it patched in `base_rev`. Resolves the write once the SDK's
 * `setAccountData` does: when sync delivers the next roaming settings, whoever wrote them (at
 * once when the client already holds this content). Resolves `null` for an empty patch (nothing
 * written), and `undefined` without writing when the stored content has a later version.
 */
const writeRoamingSettings = (
  mx: MatrixClient,
  makePatch: (content: unknown) => Partial<RoamingSettings>
): Promise<Write | null | undefined> => {
  const task = (writes.get(mx) ?? Promise.resolve(null))
    .catch(() => undefined)
    .then(async () => {
      const content: unknown = await mx.getAccountDataFromServer(
        ROAMING_SETTINGS_EVENT_TYPE as never
      );
      const patch = makePatch(content);
      if (Object.keys(patch).length === 0) return null;
      const next = mergeRoamingSettings(content, patch);
      if (!next) return undefined;
      const base = isRecord(content) ? content : {};
      const stored = { ...next, rev: randomUuid(), base_rev: base.rev ?? null };
      await mx.setAccountData(ROAMING_SETTINGS_EVENT_TYPE as never, stored as never);
      return { stored, base };
    });
  writes.set(mx, task);
  return task;
};

/** How long a write is watched for a write from an older copy of the content that undoes it. */
const GUARD_MS = 30_000;
const MAX_REDOS = 3;

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
 *   everything for the next reconnect or edit.
 * - Account data has no compare-and-swap: two devices that write at the same moment both patch
 *   the content from before either write, and the later write undoes the earlier one's edits.
 *   For half a minute after a write, incoming content whose writer read the content this write
 *   replaced (its `base_rev`, or an older client's copied `rev`, is that content's) puts this
 *   write's edits that it set back to their old value into pending again, and they are sent
 *   again. A writer that saw this write changed what it changed on purpose. Other incoming
 *   account data never causes a write. Known limit (#328): when two devices save at the same
 *   moment, the earlier write can resolve on the content of the later one, which undid it; that
 *   content arrives before the write is recorded, so the edit is not sent again and is lost.
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
  /** This device's writes of the last half minute, newest last. */
  let recent: (Write & { patch: Partial<RoamingSettings>; at: number })[] = [];
  const redos = new Map<string, number>();

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
    let patch: Partial<RoamingSettings> = {};
    void writeRoamingSettings(mx, (content) => {
      if (!bound) return {};
      // What happens from here on may be missing from this write, so it asks for another.
      again = false;
      const account = readRoamingSettings(content);
      sent = ownPending() ?? {};
      const migration = migrated ? {} : roamingMigration(account, getSettings(), DEFAULT_SETTINGS);
      patch = { ...migration, ...unconfirmedRoamingEdits(sent, account) };
      return patch;
    })
      .then((written) => {
        if (written === undefined || !bound) return;
        migrated = true;
        if (written) recent = [...recent, { ...written, patch, at: Date.now() }];
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
  /** Sends again the edits of this device that `content`, written from an older copy, undid. */
  const redoUndoneEdits = (content: unknown): void => {
    const now = Date.now();
    recent = recent.filter((write) => now - write.at <= GUARD_MS);
    if (recent.length === 0) redos.clear();
    const incoming = isRecord(content) ? content : {};
    const undone: Record<string, unknown> = {};
    recent.forEach(({ stored, base, patch }) => {
      const sawThisWrite = incoming.rev === stored.rev || incoming.base_rev === stored.rev;
      const readItsBase = incoming.base_rev === stored.base_rev || incoming.rev === stored.base_rev;
      if (sawThisWrite || !readItsBase) return;
      Object.entries(patch).forEach(([key, value]) => {
        const count = redos.get(key) ?? 0;
        if (Object.is(incoming[key], value) || !Object.is(incoming[key], base[key])) return;
        if (count >= MAX_REDOS) return;
        redos.set(key, count + 1);
        undone[key] = value;
      });
    });
    const pending = ownPending();
    if (!pending || storageKey === undefined || Object.keys(undone).length === 0) return;
    // A newer edit of the same setting on this device wins over the one sent again.
    const values = { ...(undone as Partial<RoamingSettings>), ...pending };
    store.set(pendingRoamingSettingsAtom, { storageKey, values });
    savePendingRoamingSettings(storageKey, values);
  };

  const onAccountData = (event: MatrixEvent): void => {
    if (event.getType() === ROAMING_SETTINGS_EVENT_TYPE) {
      redoUndoneEdits(event.getContent());
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
