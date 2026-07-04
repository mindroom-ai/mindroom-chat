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
import { createEngineWriteThrough, type EngineWriteThrough } from './engineWriteThrough';
import { createEngineGapTracker, type EngineGapTracker } from './engineGapTracker';
import { createEnginePersistFacade, type EnginePersistFacade } from './enginePersistFacade';
import type { EngineLiveEventMeta, MindroomSyncEngine } from './types';

const LIVE_SYNC_STATES: ReadonlySet<string> = new Set(['PREPARED', 'SYNCING', 'CATCHUP']);

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
};

export const createMindroomSyncEngine = ({
  mx,
  writeThrough,
  gapTracker,
  persist,
}: CreateMindroomSyncEngineOptions): MindroomSyncEngine => {
  const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
  const effectiveWriteThrough = writeThrough ?? createEngineWriteThrough({ sessionId });
  const effectiveGapTracker = gapTracker ?? createEngineGapTracker({ mx, sessionId });
  const effectivePersist = persist ?? createEnginePersistFacade({ sessionId });

  let started = false;
  let liveMode = false;
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
    if (bindableDocument && (bindableDocument as unknown as Document).visibilityState === 'hidden') {
      flushForVisibility();
    }
  };

  const handleSync: ClientEventHandlerMap[ClientEvent.Sync] = (current) => {
    if (!liveMode && isLiveSyncState(current)) {
      liveMode = true;
    }
    if (current && (current as string) === 'PREPARED') {
      effectiveGapTracker.handleSyncPrepared();
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
  };

  const stop = () => {
    if (!started) return;
    started = false;

    // Flush first so any trailing writes make it out before we cancel
    // the scheduler in Commit 3. In Commit 1 this is a no-op.
    effectiveWriteThrough.flush();

    mx.removeListener(ClientEvent.Sync, handleSync);
    mx.removeListener(RoomEvent.Timeline, handleTimelineEvent);
    mx.removeListener(RoomEvent.Redaction, handleRedaction);
    mx.removeListener(RoomEvent.TimelineReset, handleTimelineReset);

    bindableWindow?.removeEventListener('pagehide', handlePageHide);
    bindableDocument?.removeEventListener('visibilitychange', handleVisibilityChange);

    effectiveGapTracker.stop();

    // liveMode resets so a subsequent start() (e.g. account switch)
    // waits for a fresh Prepared/Syncing signal.
    liveMode = false;
  };

  return {
    mx,
    sessionId,
    start,
    stop,
    isLiveMode: () => liveMode,
    persist: effectivePersist,
  };
};
