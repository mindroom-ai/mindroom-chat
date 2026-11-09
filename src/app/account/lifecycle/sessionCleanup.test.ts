import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import { getRoomInputDraftKey, roomIdToMsgDraftAtomFamily } from '../../composer/roomInputDrafts';
import { clearLongTextHydrationCache } from '../../matrix/protocol/longText';
import { clearAttachmentRepositoryMemory } from '../../event-store/cache/attachmentRepository';
import { clearIOSPushState } from '../../notifications/push/iosPush';
import { clearRecentThreadsStore } from '../../event-store/threads/recentThreads';
import { clearRecentlyOpenedPanelHeightStore } from '../../preferences/recentlyOpenedPanelHeight';
import { clearCallWindowStore } from '../../calls/window/callWindowState';
import { clearThreadSidebarPreferencesStore } from '../../threads/cross-room/threadSidebarPreferences';
import { clearCrossRoomThreadFiltersStore } from '../../threads/cross-room/crossRoomThreadFilters';
import { clearRoomThreadFiltersStore } from '../../threads/overview/roomThreadFilterState';
import { clearRoomViewModeStore } from '../../navigation/roomViewMode';
import { clearThreadSummarySharedState } from '../../event-store/threads/threadSummaryState';
import { SPACE_ORDER_STORAGE_KEY_PREFIX, makeSpaceOrderAtom } from '../../spaces/sidebarOrder';
import { getDesktopPageNavCollapsedStorageKey } from '../../sidebar/desktopPageNavState';
import { getWelcomeSetupFirstSeenStorageKey } from '../../local-mindroom/provisioning';
import { pendingRoamingSettingsKey } from '../../preferences/roamingSettings';
import { SESSION_STORE_KEY, putSession } from '../../matrix/session/sessions';
import {
  deleteCacheStoreDb,
  getCacheStoreDbName,
  getLegacyRoomEventCacheDbName,
  getLegacySessionScopedCacheDbNames,
  getLegacyThreadEventCacheDbName,
  getLegacyThreadSummaryCacheDbName,
} from '../../event-store/cache/db';
import {
  MINDROOM_SINGLETON_INDEXED_DB_NAMES,
  clearInMemoryCaches,
  clearSessionNativeState,
  clearSessionUiState,
  clearUserUiState,
  deleteSessionCaches,
  getSessionIndexedDbNames,
} from './sessionCleanup';

vi.mock('../../matrix/protocol/longText', () => ({
  clearLongTextHydrationCache: vi.fn(),
}));

vi.mock('../../event-store/cache/attachmentRepository', () => ({
  clearAttachmentRepositoryMemory: vi.fn(),
}));

const stubLocalStorage = (): Map<string, string> => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  });
  return values;
};

/** Writes keys named after `userId` as the app does, and returns them. */
const seedUserUiKeys = (values: Map<string, string>, userId: string): string[] => {
  createStore().set(makeSpaceOrderAtom(userId), { type: 'REORDER', order: ['!space:example.org'] });
  const keys = [
    getDesktopPageNavCollapsedStorageKey(userId),
    getWelcomeSetupFirstSeenStorageKey(userId),
    `mindroom.members.width:${userId}`,
    `mindroom.panel.width:${userId}:example.panel`,
    pendingRoamingSettingsKey(userId, 'DEVICE'),
  ];
  keys.forEach((key) => values.set(key, '1'));
  return [`${SPACE_ORDER_STORAGE_KEY_PREFIX}${userId}`, ...keys];
};

afterEach(() => {
  vi.unstubAllGlobals();
});

it('removes only the logged-out account composer drafts from storage and memory', () => {
  const values = stubLocalStorage();
  const aliceKey = getRoomInputDraftKey('@draft-alice:example.org', '!room:example.org', '$root');
  const bobKey = getRoomInputDraftKey('@draft-bob:example.org', '!room:example.org', '$root');
  const store = createStore();
  const draft = [{ type: 'paragraph' as const, children: [{ text: 'Private draft' }] }];
  store.set(roomIdToMsgDraftAtomFamily(aliceKey), draft);
  store.set(roomIdToMsgDraftAtomFamily(bobKey), draft);
  clearUserUiState('@draft-alice:example.org');
  expect(values.size).toBe(1);
  expect(store.get(roomIdToMsgDraftAtomFamily(aliceKey))).toEqual([]);
  expect(store.get(roomIdToMsgDraftAtomFamily(bobKey))).toEqual(draft);
  roomIdToMsgDraftAtomFamily.remove(aliceKey);
  expect(createStore().get(roomIdToMsgDraftAtomFamily(aliceKey))).toEqual([]);
});

it('removes every key named after the logged-out account, whichever part of the app wrote it', () => {
  const values = stubLocalStorage();
  seedUserUiKeys(values, '@alice:example.org');
  const bobKeys = seedUserUiKeys(values, '@bob:example.org');
  clearUserUiState('@alice:example.org');
  expect([...values.keys()]).toEqual(bobKeys);
});

it('keeps the keys of logins this browser keeps, also ones that name the logged-out account', () => {
  const values = stubLocalStorage();
  const alice = '@alice:example.org';
  const aliceOnPort = '@alice:example.org:8448';
  const bob = '@bob:example.org';
  [aliceOnPort, bob].forEach((userId) =>
    putSession({ baseUrl: 'https://example.org', userId, deviceId: 'DEVICE', accessToken: 't' })
  );
  const keys = [
    `mindroom.members.width:${aliceOnPort}`,
    `mindroom.panel.width:${aliceOnPort}:example.panel`,
    pendingRoamingSettingsKey(aliceOnPort, 'DEVICE'),
    // A value Bob's plugin keeps under a key of its own that names Alice.
    `mindroom.plugin:${encodeURIComponent(bob)}/notes/contact:${alice}`,
  ];
  keys.forEach((key) => values.set(key, '1'));
  values.set(`mindroom.panel.width:${alice}:example.panel`, '1');
  clearUserUiState(alice);
  expect([...values.keys()]).toEqual([SESSION_STORE_KEY, ...keys]);
});

it('removes the keys of a logged-out account whose user ID extends a kept one', () => {
  const values = stubLocalStorage();
  const alice = '@alice:example.org';
  const aliceOnPort = '@alice:example.org:8448';
  putSession({
    baseUrl: 'https://example.org',
    userId: alice,
    deviceId: 'DEVICE',
    accessToken: 't',
  });
  const aliceKeys = [
    `mindroom.members.width:${alice}`,
    `mindroom.panel.width:${alice}:example.panel`,
  ];
  aliceKeys.forEach((key) => values.set(key, '1'));
  seedUserUiKeys(values, aliceOnPort);
  clearUserUiState(aliceOnPort);
  expect([...values.keys()]).toEqual([SESSION_STORE_KEY, ...aliceKeys]);
});

vi.mock('../../notifications/push/iosPush', () => ({
  IOS_PUSH_LOCAL_STORAGE_KEY_PREFIX: 'mindroom_ios_push_',
  clearIOSPushState: vi.fn(),
}));

vi.mock('../../event-store/threads/recentThreads', () => ({
  clearRecentThreadsStore: vi.fn(),
}));

vi.mock('../../preferences/recentlyOpenedPanelHeight', () => ({
  clearRecentlyOpenedPanelHeightStore: vi.fn(),
}));

vi.mock('../../calls/window/callWindowState', () => ({
  clearCallWindowStore: vi.fn(),
}));

vi.mock('../../threads/cross-room/threadSidebarPreferences', () => ({
  clearThreadSidebarPreferencesStore: vi.fn(),
}));

vi.mock('../../threads/cross-room/crossRoomThreadFilters', () => ({
  clearCrossRoomThreadFiltersStore: vi.fn(),
}));

vi.mock('../../threads/overview/roomThreadFilterState', () => ({
  clearRoomThreadFiltersStore: vi.fn(),
}));

vi.mock('../../navigation/roomViewMode', () => ({
  clearRoomViewModeStore: vi.fn(),
}));

vi.mock('../../event-store/threads/threadSummaryState', () => ({
  clearThreadSummarySharedState: vi.fn(),
}));

// ISSUE-207 P2.3: sessionCleanup now imports directly from `cacheStore`
// (the shim modules are gone). This single mock covers every accessor
// the module needs. Legacy DB name accessors are STILL exported by the
// store (via the `legacyCacheDbNames` submodule) so logout cleanup
// keeps working for rolled-back installs that never opened v3.
vi.mock('../../event-store/cache/db', () => ({
  LEGACY_MINDROOM_ROOM_EVENT_CACHE_DB_NAME: 'mindroom-room-event-cache',
  LEGACY_MINDROOM_THREAD_EVENT_CACHE_DB_NAME: 'mindroom-thread-event-cache',
  LEGACY_MINDROOM_THREAD_SUMMARY_CACHE_DB_NAME: 'mindroom-thread-summary-cache',
  MINDROOM_CACHE_DB_BASE_NAME: 'mindroom-cache',
  deleteCacheStoreDb: vi.fn().mockResolvedValue(undefined),
  getCacheStoreDbName: vi.fn((sessionId: string) => `mindroom-cache::${sessionId}`),
  getLegacyRoomEventCacheDbName: vi.fn((sessionId: string) => `room-cache::${sessionId}`),
  getLegacyThreadEventCacheDbName: vi.fn((sessionId: string) => `thread-cache::${sessionId}`),
  getLegacyThreadSummaryCacheDbName: vi.fn((sessionId: string) => `summary-cache::${sessionId}`),
  getLegacySessionScopedCacheDbNames: vi.fn((sessionId: string) => [
    `room-cache::${sessionId}`,
    `thread-cache::${sessionId}`,
    `summary-cache::${sessionId}`,
  ]),
  revokeAllCacheStoreWrites: vi.fn(),
}));

describe('MindRoom session cleanup', () => {
  const originalIndexedDB = (globalThis as { indexedDB?: unknown }).indexedDB;
  let deleteCalls: string[];

  beforeEach(() => {
    deleteCalls = [];
    (globalThis as { indexedDB?: unknown }).indexedDB = {
      deleteDatabase: vi.fn((dbName: string) => {
        deleteCalls.push(dbName);
        const request: {
          onsuccess?: () => void;
          onerror?: () => void;
          onblocked?: () => void;
        } = {};
        queueMicrotask(() => request.onsuccess?.());
        return request;
      }),
    };
  });

  afterEach(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = originalIndexedDB;
    vi.clearAllMocks();
  });

  it('exposes MindRoom-owned app cleanup keys from one boundary', () => {
    // ISSUE-207 P2.1 (D8) / P2.3: legacy singleton names are RETAINED
    // here so logout cleanup keeps working on installs that never opened
    // v3 (e.g. rolled-back binaries); the unified `mindroom-cache` name
    // is listed alongside. The legacy summary DB is deleted per-session
    // via `getLegacySessionScopedCacheDbNames`, not through this list.
    expect(MINDROOM_SINGLETON_INDEXED_DB_NAMES).toEqual([
      'mindroom-room-event-cache',
      'mindroom-thread-event-cache',
      'mindroom-cache',
    ]);
  });

  it('derives session-scoped MindRoom IndexedDB names', () => {
    expect(getSessionIndexedDbNames('session-a')).toEqual([
      'thread-cache::session-a',
      'room-cache::session-a',
      'summary-cache::session-a',
      'mindroom-cache::session-a',
    ]);
    expect(vi.mocked(getLegacyThreadEventCacheDbName)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(getLegacyRoomEventCacheDbName)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(getLegacyThreadSummaryCacheDbName)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(getCacheStoreDbName)).toHaveBeenCalledWith('session-a');
  });

  it('deletes the unified DB plus every legacy per-session DB together', async () => {
    await deleteSessionCaches('session-a');

    // The unified deleteCacheStoreDb still gets called through the store
    // API. Every legacy per-session DB is deleted directly via the
    // origin's indexedDB.deleteDatabase gesture — the three-way legacy
    // split collapsed to a single unified DB in P2.1, but the logout
    // gesture must still target rolled-back installs.
    expect(vi.mocked(deleteCacheStoreDb)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(getLegacySessionScopedCacheDbNames)).toHaveBeenCalledWith('session-a');
    expect(deleteCalls.sort()).toEqual(
      ['room-cache::session-a', 'summary-cache::session-a', 'thread-cache::session-a'].sort()
    );
  });

  it('attempts every database without rejecting blocked logout cleanup', async () => {
    const blockedError = new Error('blocked');
    blockedError.name = 'CacheStoreBlockedError';
    vi.mocked(deleteCacheStoreDb).mockRejectedValueOnce(blockedError);
    (globalThis as { indexedDB?: unknown }).indexedDB = {
      deleteDatabase: vi.fn((dbName: string) => {
        deleteCalls.push(dbName);
        const request: { onblocked?: () => void } = {};
        queueMicrotask(() => request.onblocked?.());
        return request;
      }),
    };

    await expect(deleteSessionCaches('session-a')).resolves.toBeUndefined();

    expect(vi.mocked(deleteCacheStoreDb)).toHaveBeenCalledWith('session-a');
    expect(deleteCalls.sort()).toEqual(
      ['room-cache::session-a', 'summary-cache::session-a', 'thread-cache::session-a'].sort()
    );
  });

  it('clears MindRoom UI, native, and in-memory state', () => {
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });

    clearUserUiState('@alice:example.com');
    clearSessionUiState('session-a');
    clearSessionNativeState('session-a');
    clearInMemoryCaches();

    expect(removeItem).toHaveBeenCalledWith('lastOpenThread@alice:example.com');
    expect(vi.mocked(clearRoomThreadFiltersStore)).toHaveBeenCalledWith('@alice:example.com');
    expect(vi.mocked(clearCrossRoomThreadFiltersStore)).toHaveBeenCalledWith('@alice:example.com');
    expect(vi.mocked(clearRecentThreadsStore)).toHaveBeenCalledWith('@alice:example.com');
    expect(vi.mocked(clearRecentlyOpenedPanelHeightStore)).toHaveBeenCalledWith(
      '@alice:example.com'
    );
    expect(vi.mocked(clearCallWindowStore)).toHaveBeenCalledWith('@alice:example.com');
    expect(vi.mocked(clearThreadSidebarPreferencesStore)).toHaveBeenCalledWith(
      '@alice:example.com'
    );
    expect(vi.mocked(clearRoomViewModeStore)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(clearThreadSummarySharedState)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(clearIOSPushState)).toHaveBeenCalledWith('session-a');
    expect(vi.mocked(clearLongTextHydrationCache)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(clearAttachmentRepositoryMemory)).toHaveBeenCalledTimes(1);
  });
});
