import { useEffect, useMemo, useState } from 'react';
import {
  ClientEvent,
  Direction,
  MatrixEventEvent,
  RelationType,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { hydrateCachedEvents } from '../../event-store/cache/eventCacheEditUtils';
import {
  createPreferLiveEventMapper,
  loadThreadCachedSnapshot,
} from '../../event-store/cache/eventRepository';
import { THREAD_BATCH_SIZE } from '../../event-store/cache/preloadSettings';
import { isCompleteCachedThreadSnapshot } from '../../event-store/cache/threadCacheSnapshot';
import { useFetchRoomEvent } from '../../event-store/cache/useRoomEvent';
import {
  enqueueThreadBackfillJob,
  MAX_THREAD_FETCH_ITERATIONS,
  useSyncEngine,
  type BackfillScheduler,
} from '../../event-store/engine';
import { hasLoadedFirstThreadPage } from '../../event-store/sdk/threadBootstrapSdk';
import { parseThreadForkRef } from '../../event-store/threads/threadFork';
import {
  getFirstLinkedTimeline,
  getThreadTimelineEvents,
} from '../../event-store/timeline/linkedTimelines';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import { useLatestRef } from '../../lib/hooks/useLatestRef';
import { isUnreadableYet } from '../../matrix/decryptionWaits';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { getAppliedEdit } from '../../matrix/protocol/untrustedContent';
import { useActiveSession } from '../../matrix/session/useSessionStore';
import { loadThreadForkPrefix, type ThreadForkPrefix } from './loadThreadForkPrefix';

type Sources = {
  mx: MatrixClient;
  room: Room;
  sessionId: string | undefined;
  scheduler: BackfillScheduler;
  fetchRoomEvent: (eventId: string, threadId?: string) => Promise<MatrixEvent>;
  isCurrent: () => boolean;
};

const uniqueEvents = (events: (MatrixEvent | null | undefined)[]): MatrixEvent[] => {
  const byId = new Map<string, MatrixEvent>();
  events.forEach((event) => {
    const eventId = event?.getId();
    if (event && eventId && !byId.has(eventId)) byId.set(eventId, event);
  });
  return [...byId.values()];
};

const holds = (events: MatrixEvent[], eventId: string): boolean =>
  events.some((event) => event.getId() === eventId);

/** The SDK thread's events, when its timeline reaches back to the root and holds the fork point. */
const sdkThreadEvents = (room: Room, threadId: string, forkPointId: string) => {
  const thread = room.getThread(threadId);
  if (!thread || !hasLoadedFirstThreadPage(thread)) return undefined;
  const first = getFirstLinkedTimeline(
    thread.getUnfilteredTimelineSet().getLiveTimeline(),
    Direction.Backward
  );
  if (first.getPaginationToken(Direction.Backward) !== null) return undefined;
  const root = thread.rootEvent ?? room.findEventById(threadId);
  const events = uniqueEvents([root, ...getThreadTimelineEvents(thread)]);
  return holds(events, forkPointId) ? events : undefined;
};

/** The cached thread, when the cache holds all of it and the fork point. */
const cachedThreadEvents = async (
  { mx, room, sessionId, isCurrent }: Sources,
  threadId: string,
  forkPointId: string
) => {
  if (!sessionId) return undefined;
  const snapshot = await loadThreadCachedSnapshot({
    sessionId,
    roomId: room.roomId,
    threadId,
    limit: THREAD_BATCH_SIZE,
    maxPages: MAX_THREAD_FETCH_ITERATIONS,
    mapEvent: createPreferLiveEventMapper(room, mx.getEventMapper()),
    shouldContinue: isCurrent,
  }).catch(() => undefined);
  if (!snapshot || !holds(snapshot.events, forkPointId)) return undefined;
  const whole = isCompleteCachedThreadSnapshot({
    room,
    threadId,
    rootEvent: room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId),
    cachedRootEvent: snapshot.events.find((event) => event.getId() === threadId),
    cachedEvents: snapshot.events,
    beforeToken: snapshot.beforeToken,
    hasMoreBefore: snapshot.hasMoreBefore,
    expectedReplyCount: snapshot.expectedReplyCount,
    snapshotComplete: snapshot.snapshotComplete === true,
    tailLoaded: snapshot.tailLoaded === true,
  });
  return whole ? snapshot.events : undefined;
};

/**
 * The thread from the server's `/relations`, through the engine's backfill job, with its root. The
 * job may be shared with other consumers, so the engine owns its cancellation; a fetch that
 * stopped before the thread's start keeps the newest events it read.
 */
const backfilledThreadEvents = async (
  { mx, room, scheduler, fetchRoomEvent, isCurrent }: Sources,
  threadId: string
): Promise<MatrixEvent[]> => {
  if (!isCurrent()) return [];
  const page = await enqueueThreadBackfillJob({
    mx,
    scheduler,
    room,
    threadId,
    priority: 0,
  }).catch(() => null);
  if (!page) return [];
  const root =
    room.getThread(threadId)?.rootEvent ??
    room.findEventById(threadId) ??
    (await fetchRoomEvent(threadId, threadId).catch(() => undefined));
  return uniqueEvents([root, ...page.events]);
};

/**
 * A parent thread's events: the SDK's when they reach its fork point, otherwise the cache's,
 * otherwise the server's. Loaded copies get their edits and redactions and are decrypted.
 */
const loadParentThreadEvents = async (
  sources: Sources,
  threadId: string,
  forkPointId: string
): Promise<MatrixEvent[]> => {
  const sdkEvents = sdkThreadEvents(sources.room, threadId, forkPointId);
  if (sdkEvents) return sdkEvents;
  const events =
    (await cachedThreadEvents(sources, threadId, forkPointId)) ??
    (await backfilledThreadEvents(sources, threadId));
  hydrateCachedEvents({ room: sources.room, events });
  await Promise.all(
    events
      .flatMap((event) => [event, getAppliedEdit(event)])
      .map((event) => event && sources.mx.decryptEventIfNeeded(event).catch(() => undefined))
  );
  return events;
};

/** The message an edit or a redaction changes. */
const changedEventId = (event: MatrixEvent): string | undefined => {
  if (event.isRedaction()) return event.getAssociatedId();
  const relation = event.getRelation();
  return relation?.rel_type === RelationType.Replace ? relation.event_id : undefined;
};

/** A loaded prefix, for the root with this ID and this reference (whichever copy of it). */
type Loaded = { rootId: string | undefined; parentKey: string; prefix: ThreadForkPrefix };

const NOT_A_FORK: ThreadForkPrefix = { events: [] };

/**
 * The prefix of the fork whose root is `root`: its parents' messages up to each fork point. It is
 * loaded again when the root's ID or its reference changes; another copy of the same root (the
 * SDK's replacing the cache's) keeps it, also while that copy waits to be decrypted. Edits the
 * parents' messages get later show in the events it holds; a redaction of one loads it again.
 */
export const useThreadForkPrefix = (room: Room, root: MatrixEvent | undefined): ThreadForkPrefix => {
  const mx = useMatrixClient();
  const sessionId = useActiveSession()?.sessionId;
  const { scheduler } = useSyncEngine();
  const fetchRoomEvent = useFetchRoomEvent(room);
  const [loaded, setLoaded] = useState<Loaded>();
  const [revision, refresh] = useForceUpdate();
  const [reloads, reload] = useForceUpdate();
  const rootId = root?.getId();
  const rootRef = useLatestRef(root);
  // An encrypted root shows its reference once decrypted: the key changes then. A new copy of
  // the loaded root that is not decrypted yet keeps the reference the loaded one had.
  const reference =
    (root && parseThreadForkRef(root.getOriginalContent())) ??
    (root && isUnreadableYet(root) && loaded?.rootId === rootId
      ? loaded?.prefix.parent
      : undefined);
  const parentKey = reference && `${reference.threadId} ${reference.eventId}`;

  useEffect(() => {
    // Also after a redaction of a prefix message (`reloads`); the loaded prefix shows meanwhile.
    void reloads;
    const shownRoot = rootRef.current;
    if (!shownRoot || !parentKey) return undefined;
    let current = true;
    const sources: Sources = {
      mx,
      room,
      sessionId,
      scheduler,
      fetchRoomEvent,
      isCurrent: () => current,
    };
    const loadThreadEvents = (threadId: string, forkPointId: string) =>
      loadParentThreadEvents(sources, threadId, forkPointId);
    void loadThreadForkPrefix({ loadThreadEvents }, shownRoot)
      .catch((error: unknown): ThreadForkPrefix => {
        console.warn('[threadFork] prefix load failed', error);
        return { events: [], parent: parseThreadForkRef(shownRoot.getOriginalContent()) };
      })
      .then((prefix) => {
        if (current) setLoaded({ rootId: shownRoot.getId(), parentKey, prefix });
      });
    return () => {
      current = false;
    };
  }, [fetchRoomEvent, mx, parentKey, reloads, room, rootId, rootRef, scheduler, sessionId]);

  const shown = loaded?.rootId === rootId && loaded?.parentKey === parentKey ? loaded : undefined;
  const events = shown?.prefix.events;
  useEffect(() => {
    if (!root) return undefined;
    const prefixEvents = events ?? [];
    const held = new Set([root, ...prefixEvents]);
    const onChange = (event: MatrixEvent) => {
      // A held message decrypted or took an edit in place.
      if (held.has(event)) {
        refresh();
        return;
      }
      const targetId = changedEventId(event);
      if (!targetId || event.getRoomId() !== room.roomId || isUnreadableYet(event)) return;
      const edits = prefixEvents
        .map((prefixEvent) => getAppliedEdit(prefixEvent))
        .filter((edit): edit is MatrixEvent => !!edit);
      if (!holds([...prefixEvents, ...edits], targetId)) return;
      // A redacted message leaves its thread. Redacting a copy would put it in the room's main
      // timeline (the SDK's `makeRedacted`), so the prefix is read again, as a new view reads it.
      if (event.isRedaction()) {
        reload();
        return;
      }
      hydrateCachedEvents({ room, events: [...prefixEvents, ...edits, event] });
      refresh();
    };
    mx.on(ClientEvent.Event, onChange);
    mx.on(MatrixEventEvent.Decrypted, onChange);
    mx.on(MatrixEventEvent.Replaced, onChange);
    return () => {
      mx.removeListener(ClientEvent.Event, onChange);
      mx.removeListener(MatrixEventEvent.Decrypted, onChange);
      mx.removeListener(MatrixEventEvent.Replaced, onChange);
    };
  }, [events, mx, refresh, reload, room, root]);

  return useMemo(() => {
    // The held events change in place; a new list tells consumers so.
    void revision;
    if (!root || !parentKey) return NOT_A_FORK;
    if (!shown) return { events: [], parent: parseThreadForkRef(root.getOriginalContent()) };
    return { ...shown.prefix, events: [...shown.prefix.events] };
  }, [parentKey, revision, root, shown]);
};
