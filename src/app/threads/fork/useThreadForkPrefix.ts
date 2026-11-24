import { useEffect, useMemo, useState } from 'react';
import {
  ClientEvent,
  MatrixEventEvent,
  RelationType,
  RoomEvent,
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
import { fetchRoomEventFor } from '../../event-store/cache/useRoomEvent';
import { isJoinedRoom } from '../../navigation/routeVisibility';
import {
  enqueueThreadBackfillJob,
  MAX_THREAD_FETCH_ITERATIONS,
  useSyncEngine,
  type BackfillScheduler,
} from '../../event-store/engine';
import { parseThreadForkRef } from '../../event-store/threads/threadFork';
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
  isCurrent: () => boolean;
};

const resolveHopRoom = (
  mx: MatrixClient,
  currentRoom: Room,
  hopRoomId: string
): Room | undefined => {
  if (hopRoomId === currentRoom.roomId) return currentRoom;
  const candidate = mx.getRoom(hopRoomId);
  return isJoinedRoom(candidate) ? candidate ?? undefined : undefined;
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
  { mx, room, sessionId, scheduler, isCurrent }: Sources,
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
    (await fetchRoomEventFor(mx, sessionId, room.roomId, threadId, threadId).catch(
      () => undefined
    ));
  return uniqueEvents([root, ...page.events]);
};

/**
 * A parent thread's events: the cache's when it holds all of them and the fork point, otherwise
 * the server's. Not the SDK thread's: a thread opened from the cache keeps its older replies beside
 * it. Loaded copies get their edits and redactions and are decrypted.
 */
const loadParentThreadEvents = async (
  sources: Sources,
  threadId: string,
  forkPointId: string
): Promise<MatrixEvent[]> => {
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
type Loaded = {
  rootId: string | undefined;
  parentKey: string;
  prefix: ThreadForkPrefix;
  watchedRoomIds: ReadonlySet<string>;
};

const NOT_A_FORK: ThreadForkPrefix = { events: [] };

/**
 * The prefix of the fork whose root is `root`: its parents' messages up to each fork point. It is
 * loaded again when the root's ID or its reference changes, and the loaded one shows meanwhile
 * while the reference stays; another copy of the same root (the SDK's replacing the cache's)
 * keeps it, also while that copy waits to be decrypted. Edits the
 * parents' messages get later show in the events it holds; a redaction of one, or a membership
 * change in any parent room, loads it again.
 */
export const useThreadForkPrefix = (
  room: Room,
  root: MatrixEvent | undefined
): ThreadForkPrefix => {
  const mx = useMatrixClient();
  const sessionId = useActiveSession()?.sessionId;
  const { scheduler } = useSyncEngine();
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
  const parentKey =
    reference && `${reference.roomId ?? ''} ${reference.threadId} ${reference.eventId}`;

  useEffect(() => {
    // Also after a redaction of a prefix message or parent-room membership change (`reloads`).
    void reloads;
    const shownRoot = rootRef.current;
    if (!shownRoot || !parentKey) return undefined;
    let current = true;
    const watchedRoomIds = new Set<string>();
    const loadThreadEvents = (hopRoomId: string, threadId: string, forkPointId: string) => {
      if (hopRoomId !== room.roomId) watchedRoomIds.add(hopRoomId);
      const hopRoom = resolveHopRoom(mx, room, hopRoomId);
      if (!hopRoom) return Promise.resolve([]);
      const sources: Sources = {
        mx,
        room: hopRoom,
        sessionId,
        scheduler,
        isCurrent: () => current,
      };
      return loadParentThreadEvents(sources, threadId, forkPointId);
    };
    void loadThreadForkPrefix({ loadThreadEvents, roomId: room.roomId }, shownRoot)
      .catch((error: unknown): ThreadForkPrefix => {
        console.warn('[threadFork] prefix load failed', error);
        return { events: [], parent: parseThreadForkRef(shownRoot.getOriginalContent()) };
      })
      .then((prefix) => {
        if (current) setLoaded({ rootId: shownRoot.getId(), parentKey, prefix, watchedRoomIds });
      });
    return () => {
      current = false;
    };
  }, [mx, parentKey, reloads, room, rootId, rootRef, scheduler, sessionId]);

  // The prefix depends on the reference alone: a root that gets its server ID keeps it.
  const shown = loaded?.parentKey === parentKey ? loaded : undefined;
  const events = shown?.prefix.events;
  const watchedRoomIds = shown?.watchedRoomIds;
  const parentRoomId = reference?.roomId;
  useEffect(() => {
    if (!root) return undefined;
    const prefixEvents = events ?? [];
    const held = new Set([root, ...prefixEvents]);
    const prefixRoomIds = new Set(
      prefixEvents.map((prefixEvent) => prefixEvent.getRoomId() ?? room.roomId)
    );
    const membershipRoomIds = new Set<string>(watchedRoomIds ?? []);
    if (parentRoomId && parentRoomId !== room.roomId) membershipRoomIds.add(parentRoomId);
    prefixRoomIds.forEach((id) => {
      if (id !== room.roomId) membershipRoomIds.add(id);
    });
    const onChange = (event: MatrixEvent) => {
      // A held message decrypted or took an edit in place.
      if (held.has(event)) {
        refresh();
        return;
      }
      const targetId = changedEventId(event);
      const eventRoomId = event.getRoomId();
      if (!targetId || !eventRoomId || !prefixRoomIds.has(eventRoomId) || isUnreadableYet(event)) {
        return;
      }
      const editRoom = resolveHopRoom(mx, room, eventRoomId);
      if (!editRoom) return;
      const roomPrefixEvents = prefixEvents.filter(
        (prefixEvent) => (prefixEvent.getRoomId() ?? room.roomId) === eventRoomId
      );
      const edits = roomPrefixEvents
        .map((prefixEvent) => getAppliedEdit(prefixEvent))
        .filter((edit): edit is MatrixEvent => !!edit);
      if (!holds([...roomPrefixEvents, ...edits], targetId)) return;
      // A redacted message leaves its thread. Redacting a copy would put it in the room's main
      // timeline (the SDK's `makeRedacted`), so the prefix is read again, as a new view reads it.
      if (event.isRedaction()) {
        reload();
        return;
      }
      hydrateCachedEvents({ room: editRoom, events: [...roomPrefixEvents, ...edits, event] });
      refresh();
    };
    const onMembershipChange = (changedRoom: Room) => {
      if (membershipRoomIds.has(changedRoom.roomId)) reload();
    };
    mx.on(ClientEvent.Event, onChange);
    mx.on(MatrixEventEvent.Decrypted, onChange);
    mx.on(MatrixEventEvent.Replaced, onChange);
    if (membershipRoomIds.size > 0) {
      mx.on(RoomEvent.MyMembership, onMembershipChange);
      mx.on(ClientEvent.Room, onMembershipChange);
    }
    return () => {
      mx.removeListener(ClientEvent.Event, onChange);
      mx.removeListener(MatrixEventEvent.Decrypted, onChange);
      mx.removeListener(MatrixEventEvent.Replaced, onChange);
      if (membershipRoomIds.size > 0) {
        mx.removeListener(RoomEvent.MyMembership, onMembershipChange);
        mx.removeListener(ClientEvent.Room, onMembershipChange);
      }
    };
  }, [events, mx, parentRoomId, refresh, reload, room, root, watchedRoomIds]);

  return useMemo(() => {
    // The held events change in place; a new list tells consumers so.
    void revision;
    if (!root || !parentKey) return NOT_A_FORK;
    if (!shown) return { events: [], parent: parseThreadForkRef(root.getOriginalContent()) };
    return { ...shown.prefix, events: [...shown.prefix.events] };
  }, [parentKey, revision, root, shown]);
};
