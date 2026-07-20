/**
 * CINNY-207 P3.1: MindroomSyncEngine core (Commit 1 — skeleton).
 *
 * The engine is the client-level owner of Tier-1 cache writes (plan
 * decision D2). It attaches SDK listeners at the client scope so live
 * events reach the cache regardless of which room is mounted in the
 * UI — the fix for finding F1 (background room cache freshness).
 *
 * Commit 1 delivers the plumbing only:
 *   - `start()` / `stop()` are idempotent and listener-symmetric.
 *   - `liveMode` flips true the first time the sync state reaches
 *     Prepared, Syncing, or Catchup. It deliberately does NOT flip
 *     back false on Reconnecting/Error — mid-session reconnect events
 *     are exactly the ones we want to keep persisting. Only `stop()`
 *     resets it.
 *   - Live events (and redactions) are dispatched to the write-through
 *     layer, which for Commit 1 only bumps `engineLiveWrites` on the
 *     probe. Real persistence lands in Commit 3.
 *
 * Verified against SDK 41.7.0: `ClientNonUIFeatures.tsx` (mx.on
 * RoomEvent.Timeline at client scope) is the reference precedent for
 * client-level event handling; the Room class re-emits Room events
 * to the client, so the room-scoped `useLiveEventArrive` we're
 * replacing and this client-scoped listener are functionally
 * equivalent per event, just wider in coverage.
 */

import { ClientEvent, RoomEvent } from 'matrix-js-sdk';
import type {
  ClientEventHandlerMap,
  MatrixClient,
  MatrixEvent,
  Room,
  RoomEventHandlerMap,
  SyncState,
} from 'matrix-js-sdk';
import { createSessionId } from '../../state/sessions';
import {
  noteRoomFederated,
  noteRoomOpened,
  noteThreadOpened,
  setEvictionProtectedRoomIds,
} from '../threads/cacheStore';
import { createEngineWriteThrough, type EngineWriteThrough } from './engineWriteThrough';
import { createEngineGapTracker, type EngineGapTracker } from './engineGapTracker';
import { createEnginePersistFacade, type EnginePersistFacade } from './enginePersistFacade';
import { createBackfillScheduler, type BackfillScheduler } from './backfillScheduler';
import { createGapFillExecutor } from './gapFillExecutor';
import {
  DEFAULT_PREFETCH_SCOPE,
  resolveRoomPrefetchTier,
  type PrefetchConfig,
} from './prefetchPolicy';
import type { EngineLiveEventMeta, MindroomSyncEngine } from './types';
import {
  getDeepTraceRuntimeStatus,
  incrementDeepTraceCounter,
  recordDeepTraceEvent,
} from '../diagnostics/deepTrace';

const LIVE_SYNC_STATES: ReadonlySet<string> = new Set(['PREPARED', 'SYNCING', 'CATCHUP']);
const DEEP_TRACE_SYNC_STATE_CODES: Readonly<Record<string, number>> = {
  ERROR: 1,
  PREPARED: 2,
  SYNCING: 3,
  CATCHUP: 4,
  RECONNECTING: 5,
  STOPPED: 6,
};

const activeEngineStops = new WeakMap<MatrixClient, () => void>();

export const stopMindroomSyncEngineForClient = (mx: MatrixClient): void => {
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

export type CreateMindroomSyncEngineOptions = {
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
   * CINNY-207 P7.2 audit finding #5 — supplies the live user
   * `PrefetchConfig` (scope + depth) to the engine on every check.
   * Snapshot-per-call rather than snapshot-at-construction so a
   * mid-session scope change picks up on the next enqueue.
   *
   * ClientRoot wires this to a jotai store read of
   * `mindroomSettingsAtom` (non-React accessor); tests default to
   * `{ scope: 'my-server', ... }` so behavior is unchanged from the
   * pre-#5 hardcoded policy.
   */
  getPrefetchConfig?: () => PrefetchConfig;
  /** Notify the engine when the live prefetch scope changes. */
  subscribePrefetchConfig?: (listener: () => void) => () => void;
};

const DEFAULT_PREFETCH_CONFIG: PrefetchConfig = {
  scope: DEFAULT_PREFETCH_SCOPE,
};

export const createMindroomSyncEngine = ({
  mx,
  writeThrough,
  gapTracker,
  persist,
  scheduler,
  getPrefetchConfig,
  subscribePrefetchConfig,
}: CreateMindroomSyncEngineOptions): MindroomSyncEngine => {
  const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
  const effectiveWriteThrough = writeThrough ?? createEngineWriteThrough({ sessionId });
  const effectiveScheduler = scheduler ?? createBackfillScheduler({ mx });
  const effectiveGapTracker = gapTracker ?? createEngineGapTracker({ mx, sessionId });
  const effectivePersist = persist ?? createEnginePersistFacade({ sessionId });

  // CINNY-207 P7.2 audit finding #5: focused room tracker. Populated
  // by `noteRoomFocused`; the gap-fill executor consults it via
  // `getFocusedRoomId` when `prefetchScope === 'current-room-only'`.
  let focusedRoomId: string | undefined;
  const getFocusedRoomId = (): string | undefined => focusedRoomId;
  const effectiveGetPrefetchConfig = getPrefetchConfig ?? (() => DEFAULT_PREFETCH_CONFIG);

  // CINNY-207 P4.2: wire the executor over the gap tracker's queue so
  // limited-sync / startup jobs actually drain. Test overrides can pass
  // a stub `gapTracker` — in that case skip the executor (the stub
  // controls its own queue).
  const gapFillExecutor = gapTracker
    ? undefined
    : createGapFillExecutor(
        {
          mx,
          sessionId,
          scheduler: effectiveScheduler,
          // CINNY-207 P7.2 audit finding #5: thread scope + focus into
          // the executor so the runtime gate can honor
          // `current-room-only` (suppress background bands on non-focused
          // rooms) and `all-rooms` (admit federated tiers).
          getPrefetchConfig: effectiveGetPrefetchConfig,
          getFocusedRoomId,
        },
        effectiveGapTracker.scheduler
      );

  let started = false;
  let liveMode = false;
  let unsubscribePrefetchConfig: (() => void) | undefined;
  const bindableWindow = getBindableWindow();
  const bindableDocument = getBindableDocument();

  const flushForVisibility = () => {
    // Commit 1 has nothing to flush. Once Commit 3 moves the edit
    // compaction scheduler in, this is where the trailing debounce
    // gets drained before the page freezes.
    effectiveWriteThrough.flush();
  };

  const handlePageHide = () => flushForVisibility();
  const handleVisibilityChange = () => {
    if (
      bindableDocument &&
      (bindableDocument as unknown as Document).visibilityState === 'hidden'
    ) {
      flushForVisibility();
    }
  };

  const handleSync: ClientEventHandlerMap[ClientEvent.Sync] = (current) => {
    if (getDeepTraceRuntimeStatus() === 'recording') {
      const stateCode = DEEP_TRACE_SYNC_STATE_CODES[String(current ?? '').toUpperCase()] ?? 0;
      recordDeepTraceEvent('matrix_sync.state', {
        state_code: stateCode,
        room_count: mx.getRooms?.().length ?? 0,
        live_mode: liveMode,
      });
    }
    if (!liveMode && isLiveSyncState(current)) {
      liveMode = true;
    }
    if (current && (current as string) === 'PREPARED') {
      void effectiveGapTracker.handleSyncPrepared().catch(() => undefined);
    }
  };

  const handleTimelineEvent: RoomEventHandlerMap[RoomEvent.Timeline] = (
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
    incrementDeepTraceCounter(
      event.isEncrypted?.() ? 'matrix_timeline.live.encrypted' : 'matrix_timeline.live.plain'
    );

    const meta: EngineLiveEventMeta = {
      kind: 'timeline',
      roomId: room.roomId,
      liveEvent: true,
      toStartOfTimeline: false,
    };
    effectiveWriteThrough.handleLiveEvent(event, room, meta);
  };

  const handleRedaction: RoomEventHandlerMap[RoomEvent.Redaction] = (
    event: MatrixEvent,
    room: Room | undefined,
    threadId?: string
  ) => {
    if (!room || !liveMode) return;

    // CINNY-207 P3 gate re-fix (layer 2): matrix-js-sdk's
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

    // Prime liveMode against the current sync state so an engine that
    // starts after a warm client (e.g. hot reload) doesn't have to
    // wait for the next Sync event to unblock persistence.
    if (isLiveSyncState(mx.getSyncState())) {
      liveMode = true;
    }

    mx.on(ClientEvent.Sync, handleSync);
    mx.on(RoomEvent.Timeline, handleTimelineEvent);
    mx.on(RoomEvent.Redaction, handleRedaction);
    mx.on(RoomEvent.TimelineReset, handleTimelineReset);

    bindableWindow?.addEventListener('pagehide', handlePageHide);
    bindableDocument?.addEventListener('visibilitychange', handleVisibilityChange);
    unsubscribePrefetchConfig = subscribePrefetchConfig?.(() => {
      gapFillExecutor?.recheckDeferred();
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
      mx.removeListener(RoomEvent.Timeline, handleTimelineEvent);
      mx.removeListener(RoomEvent.Redaction, handleRedaction);
      mx.removeListener(RoomEvent.TimelineReset, handleTimelineReset);

      bindableWindow?.removeEventListener('pagehide', handlePageHide);
      bindableDocument?.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribePrefetchConfig?.();
      unsubscribePrefetchConfig = undefined;

      effectiveGapTracker.stop();
      gapFillExecutor?.stop();

      // Abort every queued/in-flight backfill job. Callers receive a
      // rejection so their finally-blocks can release local state.
      effectiveScheduler.abortAll();

      // A subsequent start (for example after an account switch) must wait
      // for a fresh Prepared/Syncing signal.
      liveMode = false;
    }
  };

  /**
   * CINNY-207 P4.2: consolidate the per-room bookkeeping that was
   * previously scattered across the P3.3 controllers. Called from
   * `MindroomRoomTimeline` whenever the mounted room (and optionally
   * the currently-open thread) changes. Idempotent per-call.
   *
   * Bookkeeping performed:
   *   - Resolve the room's prefetch tier via `resolveRoomPrefetchTier`
   *     (D3, homeserver-domain comparison; never parses room ids).
   *   - `noteRoomFederated` — stamp the ledger attribution so eviction
   *     favors federated rooms first (D9).
   *   - `setEvictionProtectedRoomIds([roomId])` — single-element v1
   *     (Deviations §8): only the currently focused room is protected;
   *     LRU inside priority covers the rest.
   *   - `noteRoomOpened` / `noteThreadOpened` — bump the meta
   *     `lastOpenedTs` so the recent-open guard skips this room for
   *     eviction consideration until the window rolls past.
   */
  const noteRoomFocused = (roomId: string, threadId?: string): void => {
    const room = mx.getRoom?.(roomId);
    if (!room) return;
    // CINNY-207 P7.2 audit finding #5: record the focus so scope-aware
    // gates in the gap-fill executor and any other consumer can honor
    // `current-room-only`. The band-0 (foreground) pathways below run
    // unconditionally — a room the user actively opens is always
    // eligible for a foreground fetch.
    focusedRoomId = roomId;
    gapFillExecutor?.recheckDeferred(roomId);
    const tier = resolveRoomPrefetchTier(mx, room);
    // `background` (create event missing) is treated as federated for
    // eligibility, but we don't stamp the ledger flag since we don't
    // yet know the truth — leaves the flag at its previous value.
    if (tier !== 'background') {
      noteRoomFederated(sessionId, roomId, tier !== 'own').catch(() => undefined);
    }
    setEvictionProtectedRoomIds([roomId]);
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
    noteRoomFocused,
  };
};
