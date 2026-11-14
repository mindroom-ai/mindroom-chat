/**
 * ISSUE-207 P3.1: SyncEngine core.
 *
 * The engine is the client-level owner of Tier-1 cache writes (plan
 * decision D2). It attaches SDK listeners at the client scope so live
 * events reach the cache regardless of which room is mounted in the
 * UI — the fix for finding F1 (background room cache freshness).
 *
 * Lifecycle:
 *   - `start()` / `stop()` are idempotent and listener-symmetric.
 *   - `liveMode` flips true the first time the sync state reaches
 *     Prepared, Syncing, or Catchup. It deliberately does NOT flip
 *     back false on Reconnecting/Error — mid-session reconnect events
 *     are exactly the ones we want to keep persisting. Only `stop()`
 *     resets it.
 *   - Live events (and redactions) are dispatched to the write-through,
 *     which persists them.
 *
 * Verified against SDK 41.7.0: `ClientNonUIFeatures.tsx` (mx.on
 * RoomEvent.Timeline at client scope) is the reference precedent for
 * client-level event handling; the Room class re-emits Room events
 * to the client, so the room-scoped `useLiveEventArrive` we're
 * replacing and this client-scoped listener are functionally
 * equivalent per event, just wider in coverage.
 */

import { ClientEvent, RoomEvent, MatrixEventEvent, RelationType } from 'matrix-js-sdk';
import type {
  ClientEventHandlerMap,
  MatrixClient,
  MatrixEvent,
  Room,
  RoomEventHandlerMap,
  SyncState,
} from 'matrix-js-sdk';
import { createSessionId } from '../../matrix/session/sessions';
import {
  noteRoomOpened,
  noteThreadOpened,
  setEvictionProtectedRoomIds,
  revokeCacheStoreWrites,
  captureCacheStoreWriteLease,
} from '../cache/db';
import { createEngineWriteThrough, type EngineWriteThrough } from './engineWriteThrough';
import { createEngineGapTracker, type EngineGapTracker } from './engineGapTracker';
import { createEnginePersistFacade, type EnginePersistFacade } from './enginePersistFacade';
import { createBackfillScheduler, type BackfillScheduler } from './backfillScheduler';
import { createGapFillExecutor } from './gapFillExecutor';
import { DEFAULT_PREFETCH_SCOPE, type PrefetchConfig } from './prefetchPolicy';
import type { EngineLiveEventMeta, SyncEngine } from './types';
import { trackPendingThreadEvent } from '../cache/pendingThreadEvents';
import {
  persistRoomChunkWithPreferLive,
  rememberEventCacheWriteLease,
  canPersistDecryptedEvent,
} from '../cache/eventRepository';
import { createRoomOfflineController } from './roomOffline';
import { registerEncryptedRoomCheck } from '../cache/db/cacheStoreEncryptedRooms';
import type { OfflineConnection } from './offlineConnection';

const LIVE_SYNC_STATES: ReadonlySet<string> = new Set(['PREPARED', 'SYNCING', 'CATCHUP']);

const activeEngineStops = new WeakMap<MatrixClient, () => void>();

export const stopSyncEngineForClient = (mx: MatrixClient): void => {
  activeEngineStops.get(mx)?.();
};

const isLiveSyncState = (state?: SyncState | null): boolean =>
  Boolean(state && LIVE_SYNC_STATES.has(state));

type BindableDocument = Pick<Document, 'addEventListener' | 'removeEventListener'>;
type BindableWindow = Pick<Window, 'addEventListener' | 'removeEventListener'>;

const getBindableWindow = (): BindableWindow | undefined => {
  if (typeof window === 'undefined') return undefined;
  if (typeof window.addEventListener !== 'function') return undefined;
  if (typeof window.removeEventListener !== 'function') return undefined;
  return window;
};

const getBindableDocument = (): BindableDocument | undefined => {
  if (typeof document === 'undefined') return undefined;
  if (typeof document.addEventListener !== 'function') return undefined;
  if (typeof document.removeEventListener !== 'function') return undefined;
  return document;
};

export type CreateSyncEngineOptions = {
  connection?: OfflineConnection;
  mx: MatrixClient;
  /**
   * Optional write-through override for tests. Production always uses
   * the default write-through created in this module.
   */
  writeThrough?: EngineWriteThrough;
  /**
   * Optional gap tracker override for tests.
   */
  gapTracker?: EngineGapTracker;
  /**
   * Optional persist facade override for tests.
   */
  persist?: EnginePersistFacade;
  /**
   * Optional backfill scheduler override for tests.
   */
  scheduler?: BackfillScheduler;
  /**
   * ISSUE-207 P7.2 audit finding #5 — supplies the live user
   * `PrefetchConfig` (scope) to the engine on every check.
   * Snapshot-per-call rather than snapshot-at-construction so a
   * mid-session scope change picks up on the next enqueue.
   *
   * ClientRoot wires this to a jotai store read of
   * `prefetchSettingsAtom` (non-React accessor); without it the engine
   * uses `DEFAULT_PREFETCH_SCOPE`.
   */
  getPrefetchConfig?: () => PrefetchConfig;
  /** Notify the engine when the live prefetch scope changes. */
  subscribePrefetchConfig?: (listener: () => void) => () => void;
};

const DEFAULT_PREFETCH_CONFIG: PrefetchConfig = {
  scope: DEFAULT_PREFETCH_SCOPE,
};

export const createSyncEngine = ({
  mx,
  writeThrough,
  gapTracker,
  persist,
  scheduler,
  getPrefetchConfig,
  subscribePrefetchConfig,
  connection,
}: CreateSyncEngineOptions): SyncEngine => {
  const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());

  const effectiveScheduler = scheduler ?? createBackfillScheduler({ mx });
  const effectivePersist = persist ?? createEnginePersistFacade({ sessionId });
  const recoveryListeners = new Map<string, Set<() => void>>();
  const subscribeRoomRecovery = (roomId: string, listener: () => void): (() => void) => {
    const listeners = recoveryListeners.get(roomId) ?? new Set();
    listeners.add(listener);
    recoveryListeners.set(roomId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) recoveryListeners.delete(roomId);
    };
  };

  const effectiveGetPrefetchConfig = getPrefetchConfig ?? (() => DEFAULT_PREFETCH_CONFIG);
  const offline = createRoomOfflineController({
    mx,
    sessionId,
    scheduler: effectiveScheduler,
    connection,
    getPrefetchConfig: effectiveGetPrefetchConfig,
    onChanged: (roomId) => recoveryListeners.get(roomId)?.forEach((notify) => notify()),
    onPolicyChange: () => gapFillExecutor.recheckDeferred(),
  });

  const effectiveWriteThrough =
    writeThrough ??
    createEngineWriteThrough({
      sessionId,
      persist: (room, events, roomTailLoaded, threadId) => {
        const lease = captureCacheStoreWriteLease(sessionId, room.roomId);
        void persistRoomChunkWithPreferLive({
          mx,
          sessionId,
          room,
          chunk: events.map((event) => event.event),
          mappedEvents: events,
          roomTailLoaded: roomTailLoaded ?? false,
          threadId,
          writeLease: lease,
        })
          .then((saved) => saved && offline.observe(saved.events, room.roomId, lease))
          .catch(() => undefined);
      },
    });

  // ISSUE-207 P4.2: the executor runs every limited-sync / startup job the
  // gap tracker enqueues. A test's stub `gapTracker` enqueues none.
  const gapFillExecutor = createGapFillExecutor({
    mx,
    sessionId,
    scheduler: effectiveScheduler,
    // One controller owns automatic and explicit-download eligibility.
    pageAllowance: offline.allowance,
    reservePage: offline.reservePage,
    canSavePage: offline.canSavePage,
    onRoomRecovered: (roomId) => {
      offline.recheck();
      Array.from(recoveryListeners.get(roomId) ?? []).forEach((notify) => {
        try {
          notify();
        } catch {
          // A reader must not prevent another reader's refresh or undo
          // the executor's successful cache commit and cursor advance.
        }
      });
    },
  });
  const effectiveGapTracker =
    gapTracker ??
    createEngineGapTracker({
      mx,
      sessionId,
      enqueueGapFill: gapFillExecutor.enqueue,
    });

  let started = false;
  let liveMode = false;
  let unsubscribePrefetchConfig: (() => void) | undefined;
  let forgetEncryptedRoomCheck: (() => void) | undefined;
  const bindableWindow = getBindableWindow();
  const bindableDocument = getBindableDocument();

  // Drain the edit compaction debounce before the page freezes.
  const flushForVisibility = () => {
    effectiveWriteThrough.flush();
  };

  const handlePageHide = () => flushForVisibility();
  const handleVisibilityChange = () => {
    offline.recheck();
    if (
      bindableDocument &&
      (bindableDocument as unknown as Document).visibilityState === 'hidden'
    ) {
      flushForVisibility();
    }
  };

  const handleSync: ClientEventHandlerMap[ClientEvent.Sync] = (current) => {
    if (!liveMode && isLiveSyncState(current)) {
      liveMode = true;
    }
    if (current && (current as string) === 'PREPARED') {
      void effectiveGapTracker.handleSyncPrepared().catch(() => undefined);
    }
  };

  /** Confirmed events already saved from a timeline, so their echo is not saved again. */
  const confirmedTimelineEvents = new WeakSet<MatrixEvent>();

  const handleTimeline: RoomEventHandlerMap[RoomEvent.Timeline] = (
    event: MatrixEvent,
    room: Room | undefined,
    toStartOfTimeline: boolean | undefined,
    removed: boolean | undefined,
    data
  ) => {
    // Guard order matches the plan's F1 checklist: skip anything that
    // isn't a live tail append in a real room while the engine is in
    // live mode. `toStartOfTimeline` is `true` for backfill; `removed`
    // is `true` for optimistic pending-event teardown; `data.liveEvent`
    // is `false` for IDB-replay events (which is exactly what we want
    // to skip until `liveMode` is set).
    if (!room || removed || toStartOfTimeline) return;
    if (!data?.liveEvent) return;
    if (!liveMode) return;
    // The SDK's thread lists re-add a root as a live event whenever it lists
    // the thread or the thread gets a reply. The root is not a new room
    // event, and persisting it cost four IndexedDB transactions per listed
    // thread on every launch.
    const timelineSet = data.timeline?.getTimelineSet();
    if (timelineSet && room.threadsTimelineSets.some((set) => set === timelineSet)) return;

    if (!event.status) confirmedTimelineEvents.add(event);
    rememberEventCacheWriteLease(event, captureCacheStoreWriteLease(sessionId, room.roomId));
    const meta: EngineLiveEventMeta = {
      kind: 'timeline',
      roomId: room.roomId,
      liveEvent: true,
      toStartOfTimeline: false,
    };
    effectiveWriteThrough.handleLiveEvent(event, room, meta);
  };

  // The SDK keeps the edits of a thread it has not fetched off every timeline, to replay when the
  // thread opens, so they never come through the timeline event: a reply that streamed in a thread
  // the reader had not opened stayed in the cache as its placeholder. A redaction of an event the
  // SDK does not hold is on no timeline either: a thread reply the server deleted, which /relations
  // leaves out, stayed in the cache. The sync announces every event once the room has taken it; an
  // edit or a redaction then on no timeline is persisted from here.
  const handleUnplacedEvent = (event: MatrixEvent) => {
    if (!liveMode || event.status) return;
    if (!event.isRedaction() && event.getRelation()?.rel_type !== RelationType.Replace) return;
    const roomId = event.getRoomId();
    const room = roomId ? mx.getRoom(roomId) : undefined;
    const eventId = event.getId();
    if (!room || !eventId || room.findEventById(eventId)) return;
    rememberEventCacheWriteLease(event, captureCacheStoreWriteLease(sessionId, room.roomId));
    effectiveWriteThrough.handleLiveEvent(event, room, {
      kind: 'timeline',
      roomId: room.roomId,
      liveEvent: true,
      toStartOfTimeline: false,
    });
  };

  const handleDecrypted = (event: MatrixEvent) => {
    const roomId = event.getRoomId();
    const room = roomId ? mx.getRoom(roomId) : undefined;
    if (!room || !started || !canPersistDecryptedEvent(event, sessionId)) return;
    effectiveWriteThrough.handleLiveEvent(event, room, {
      kind: 'timeline',
      roomId: room.roomId,
      liveEvent: true,
      toStartOfTimeline: false,
    });
  };

  const handleRedaction: RoomEventHandlerMap[RoomEvent.Redaction] = (
    event: MatrixEvent,
    room: Room | undefined,
    threadId?: string
  ) => {
    if (!room || !liveMode) return;

    // ISSUE-207 P3 gate re-fix (layer 2): matrix-js-sdk's
    // `applyEventAsRedaction` captures the redacted target's
    // `threadRootId` BEFORE calling `makeRedacted` and passes it as
    // the third arg to this emission. That capture is pre-prune, so
    // it is a reliable attribution hint for the write-through even
    // when the redacted target has since been pruned + moved off its
    // thread. Layer 1 (cache-derived scopes) still runs when this is
    // absent (e.g. the SDK re-emits redactions through the Timeline
    // channel without the extra arg).
    const meta: EngineLiveEventMeta = {
      kind: 'redaction',
      roomId: room.roomId,
      liveEvent: true,
      toStartOfTimeline: false,
      sdkThreadId: threadId,
    };
    effectiveWriteThrough.handleLiveEvent(event, room, meta);
  };

  // The SDK confirms a sent event in place: the remote echo updates the local
  // echo, and only a thread timeline announces it again, while the pending
  // echo itself was not saved. Without this, the user's own room messages,
  // thread roots included, reached the room cache only through other paths.
  // Redactions are confirmed through the Redaction channel.
  const handleLocalEchoUpdated: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (
    event,
    room,
    _oldEventId,
    oldStatus
  ) => {
    trackPendingThreadEvent(event, room);
    if (!liveMode || !oldStatus || event.status || event.isRedaction()) return;
    if (confirmedTimelineEvents.has(event)) return;
    rememberEventCacheWriteLease(event, captureCacheStoreWriteLease(sessionId, room.roomId));
    effectiveWriteThrough.handleLiveEvent(event, room, {
      kind: 'timeline',
      roomId: room.roomId,
      liveEvent: true,
      toStartOfTimeline: false,
    });
  };

  const handleTimelineReset: RoomEventHandlerMap[RoomEvent.TimelineReset] = (
    room,
    timelineSet,
    resetAllTimelines
  ) => {
    effectiveGapTracker.handleTimelineReset(room, timelineSet, resetAllTimelines);
  };

  const start = () => {
    if (started) return;
    const previousStop = activeEngineStops.get(mx);
    if (previousStop && previousStop !== stop) previousStop();
    activeEngineStops.set(mx, stop);
    started = true;
    offline.start();
    // The cache keeps no text it read out of an encrypted room's events.
    forgetEncryptedRoomCheck = registerEncryptedRoomCheck(
      sessionId,
      (roomId) => !!mx.getRoom(roomId)?.hasEncryptionStateEvent()
    );

    // Prime liveMode against the current sync state so an engine that
    // starts after a warm client (e.g. hot reload) doesn't have to
    // wait for the next Sync event to unblock persistence.
    if (isLiveSyncState(mx.getSyncState())) {
      liveMode = true;
    }

    mx.on(ClientEvent.Sync, handleSync);
    mx.on(RoomEvent.Timeline, handleTimeline);
    mx.on(ClientEvent.Event, handleUnplacedEvent);
    mx.on(RoomEvent.Redaction, handleRedaction);
    mx.on(RoomEvent.TimelineReset, handleTimelineReset);
    mx.on(RoomEvent.LocalEchoUpdated, handleLocalEchoUpdated);
    mx.on(MatrixEventEvent.Decrypted, handleDecrypted);

    bindableWindow?.addEventListener('pagehide', handlePageHide);
    bindableDocument?.addEventListener('visibilitychange', handleVisibilityChange);
    unsubscribePrefetchConfig = subscribePrefetchConfig?.(() => {
      gapFillExecutor.recheckDeferred();
      offline.recheck();
    });
  };

  const stop = () => {
    if (!started) return;
    started = false;
    if (activeEngineStops.get(mx) === stop) activeEngineStops.delete(mx);

    try {
      // Flush first so any trailing writes make it out before cancellation.
      effectiveWriteThrough.flush();
    } finally {
      // Structural teardown must finish even if the best-effort flush fails;
      // destructive account cleanup may delete these stores immediately.
      mx.removeListener(ClientEvent.Sync, handleSync);
      mx.removeListener(RoomEvent.Timeline, handleTimeline);
      mx.removeListener(ClientEvent.Event, handleUnplacedEvent);
      mx.removeListener(RoomEvent.Redaction, handleRedaction);
      mx.removeListener(RoomEvent.TimelineReset, handleTimelineReset);
      mx.removeListener(RoomEvent.LocalEchoUpdated, handleLocalEchoUpdated);
      mx.removeListener(MatrixEventEvent.Decrypted, handleDecrypted);
      offline.stop();
      revokeCacheStoreWrites(sessionId);
      forgetEncryptedRoomCheck?.();

      bindableWindow?.removeEventListener('pagehide', handlePageHide);
      bindableDocument?.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribePrefetchConfig?.();
      unsubscribePrefetchConfig = undefined;

      effectiveGapTracker.stop();
      gapFillExecutor.stop();

      // Abort every queued/in-flight backfill job. Callers receive a
      // rejection so their finally-blocks can release local state.
      effectiveScheduler.abortAll();

      // A subsequent start (for example after an account switch) must wait
      // for a fresh Prepared/Syncing signal.
      liveMode = false;
    }
  };

  /**
   * ISSUE-207 P4.2: consolidate the per-room bookkeeping that was
   * previously scattered across the P3.3 controllers. Called from
   * `MindroomRoomTimeline` whenever the mounted room (and optionally
   * the currently-open thread) changes. Idempotent per-call.
   *
   * Bookkeeping performed:
   *   - `setEvictionProtectedRoomIds([roomId])` — single-element v1
   *     (Deviations §8): only the currently focused room is protected
   *     in memory.
   *   - `offline.focus` and a recheck of the room's deferred gap-fill.
   *   - `noteRoomOpened` / `noteThreadOpened` — bump the meta
   *     `lastOpenedTs`, which protects the room from eviction until the
   *     window rolls past and then orders it by when it was last opened.
   */
  const noteRoomFocused = (roomId: string, threadId?: string): void => {
    if (!mx.getRoom?.(roomId)) return;
    // Protect the room before its offline work can ask for space.
    setEvictionProtectedRoomIds([roomId]);
    offline.focus(roomId);
    gapFillExecutor.recheckDeferred(roomId);
    noteRoomOpened(sessionId, roomId).catch(() => undefined);
    if (threadId) {
      noteThreadOpened(sessionId, roomId, threadId).catch(() => undefined);
    }
  };

  return {
    mx,
    sessionId,
    start,
    stop,
    isLiveMode: () => liveMode,
    persist: effectivePersist,
    scheduler: effectiveScheduler,
    subscribeRoomRecovery,
    noteRoomFocused,
    offline: offline.controller,
    backgroundPageAllowance: offline.allowance,
    clearRoomFocus: (roomId) => {
      offline.blur(roomId);
      setEvictionProtectedRoomIds([]);
    },
  };
};
