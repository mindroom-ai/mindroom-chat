import {
  Direction,
  EventType,
  type IEventWithRoomId,
  type MatrixClient,
  MatrixEvent,
  RelationType,
  type Room,
} from 'matrix-js-sdk';
import { isRecord } from '../lib/isRecord';
import {
  getLatestThreadSummaryInfoFromEventSources,
  getThreadSummaryEventInfo,
  isThreadSummaryContent,
  pickLatestThreadSummaryInfo,
  type ThreadSummaryInfo,
} from '../matrix/protocol/threadSummary';
import { getBundledThreadPreviews } from '../event-store/threads/threadBundledPreviews';
import { resolveThreadSummaryInfo } from '../event-store/threads/threadPresentation';
import { storeThreadSummaryInState } from '../event-store/threads/threadSummaryState';
import { getVisibleThreadEventBodyPreviewText } from '../event-store/threads/threadUtils';
import {
  getCrossRoomThreadIndexKey,
  getCrossRoomThreadRootsForEvent,
  type CrossRoomThreadIndexEntry,
  type CrossRoomThreadIndexSnapshot,
} from '../threads/cross-room/crossRoomThreadIndex';
import type { SearchResultOpenTarget } from '../search/searchResultOpenTarget';

const LEGACY_THREAD_REL = 'org.matrix.msc3440.thread';

export type ResolvedEdit = {
  threadRootId: string;
  threadTitle?: true;
  summaryInfo?: ThreadSummaryInfo;
};
export type ResolvedThread = { summaryText?: string; rootPreviewText?: string };

const hasBundledThread = (unsigned: unknown): boolean => {
  const relations = isRecord(unsigned) ? unsigned['m.relations'] : undefined;
  return (
    isRecord(relations) && Boolean(relations[RelationType.Thread] ?? relations[LEGACY_THREAD_REL])
  );
};

const getBundledTitleEvent = (
  room: Room | null | undefined,
  root: MatrixEvent | null | undefined
): MatrixEvent | undefined =>
  room && typeof room.getThread === 'function' && root && typeof root.getId === 'function'
    ? getBundledThreadPreviews(room, root).title
    : undefined;

// crossRoomThreadIndex entry.summaryText falls back to root preview for untitled threads;
// read the real title from threadRecord.presentation when present.
const getEntrySummaryInfo = (
  entry: CrossRoomThreadIndexEntry | undefined
): ThreadSummaryInfo | undefined => {
  if (!entry) return undefined;
  if (entry.threadRecord) {
    const { summaryInfo, summaryText } = entry.threadRecord.presentation;
    return summaryInfo ?? (summaryText ? { summaryText } : undefined);
  }
  return entry.summaryText ? { summaryText: entry.summaryText } : undefined;
};

const inspectEventThread = (
  content: unknown,
  unsigned: unknown,
  selfId: string,
  fallbackRel?: unknown,
  isRoot?: boolean
): ResolvedEdit | null => {
  const record = isRecord(content) ? content : undefined;
  const rel = record?.['m.relates_to'] ?? fallbackRel;
  if (
    isRecord(rel) &&
    (rel.rel_type === RelationType.Thread || rel.rel_type === LEGACY_THREAD_REL) &&
    typeof rel.event_id === 'string' &&
    rel.event_id !== selfId
  ) {
    return {
      threadRootId: rel.event_id,
      ...(record && isThreadSummaryContent(record) ? { threadTitle: true as const } : {}),
    };
  }
  return isRoot || hasBundledThread(unsigned) ? { threadRootId: selfId } : null;
};

export const resolveSyncHitThread = (
  roomId: string,
  event: IEventWithRoomId,
  target: SearchResultOpenTarget,
  room: Room | null | undefined,
  threadIndex: CrossRoomThreadIndexSnapshot,
  summaries: ReadonlyMap<string, ThreadSummaryInfo>
): { threadRootId?: string; isThreadTitle?: boolean; needsEditFetch?: boolean } => {
  if (target.threadRootId) {
    return { threadRootId: target.threadRootId, isThreadTitle: target.threadTitle };
  }
  const { mainEventId } = target;
  const isKnownRoot =
    threadIndex.entries.has(getCrossRoomThreadIndexKey(roomId, mainEventId)) ||
    summaries.has(mainEventId) ||
    Boolean(room?.getThread?.(mainEventId));
  if (mainEventId === event.event_id) {
    return {
      threadRootId: isKnownRoot || hasBundledThread(event.unsigned) ? mainEventId : undefined,
    };
  }
  const loaded = room?.findEventById?.(mainEventId);
  if (loaded) {
    const fallbackRel =
      loaded.getRelation?.() ??
      (loaded.threadRootId && loaded.threadRootId !== mainEventId
        ? { rel_type: RelationType.Thread, event_id: loaded.threadRootId }
        : undefined);
    const fromLoaded = inspectEventThread(
      loaded.getWireContent?.() ?? loaded.getContent?.(),
      loaded.getUnsigned?.(),
      mainEventId,
      fallbackRel,
      loaded.isThreadRoot
    );
    if (fromLoaded) {
      return { threadRootId: fromLoaded.threadRootId, isThreadTitle: fromLoaded.threadTitle };
    }
  }
  const [reverseRootId] = getCrossRoomThreadRootsForEvent(threadIndex, roomId, mainEventId);
  if (reverseRootId) {
    return {
      threadRootId: reverseRootId,
      isThreadTitle: summaries.get(reverseRootId)?.eventId === mainEventId,
    };
  }
  return isKnownRoot ? { threadRootId: mainEventId } : { needsEditFetch: !loaded };
};

export const resolveLocalThreadSummary = (
  room: Room | null | undefined,
  event: IEventWithRoomId,
  threadRootId: string,
  entry: CrossRoomThreadIndexEntry | undefined,
  summaries: ReadonlyMap<string, ThreadSummaryInfo>,
  fetchedSummary?: ThreadSummaryInfo
): string | undefined => {
  const localRoot =
    room?.getThread?.(threadRootId)?.rootEvent ?? room?.findEventById?.(threadRootId);
  const bundled =
    getBundledTitleEvent(room, localRoot) ??
    (threadRootId === event.event_id && hasBundledThread(event.unsigned)
      ? getBundledTitleEvent(room, new MatrixEvent(event))
      : undefined);
  return pickLatestThreadSummaryInfo(
    getEntrySummaryInfo(entry),
    summaries.get(threadRootId),
    resolveThreadSummaryInfo({ thread: room?.getThread?.(threadRootId) }),
    bundled ? getThreadSummaryEventInfo(bundled) : undefined,
    fetchedSummary
  )?.summaryText;
};

export const resolveThreadRootPreview = (
  room: Room | null | undefined,
  threadRootId: string,
  entry: CrossRoomThreadIndexEntry | undefined,
  fetchedPreview?: string
): string | undefined =>
  entry?.threadRecord?.presentation.rootPreviewText ||
  entry?.rootPreviewText ||
  fetchedPreview ||
  getVisibleThreadEventBodyPreviewText(
    room?.getThread?.(threadRootId)?.rootEvent ?? room?.findEventById?.(threadRootId)
  );

export const fetchEditThread = async (
  client: MatrixClient,
  sessionId: string | undefined,
  roomId: string,
  eventId: string
): Promise<ResolvedEdit | null> => {
  const fetched = await client.fetchRoomEvent(roomId, eventId);
  const resolved = inspectEventThread(fetched?.content, fetched?.unsigned, eventId);
  if (!resolved) return null;
  if (resolved.threadRootId === eventId && fetched && hasBundledThread(fetched.unsigned)) {
    const bundled = getBundledTitleEvent(
      client.getRoom(roomId),
      new MatrixEvent({ ...fetched, event_id: fetched.event_id ?? eventId, room_id: roomId })
    );
    const info = bundled ? getThreadSummaryEventInfo(bundled) : undefined;
    if (info) {
      if (sessionId) storeThreadSummaryInState(sessionId, roomId, eventId, info);
      else return { ...resolved, summaryInfo: info };
    }
  }
  return resolved;
};

export const fetchThreadSummary = async (
  client: MatrixClient,
  sessionId: string | undefined,
  roomId: string,
  threadRootId: string
): Promise<ResolvedThread> => {
  const result = await client.relations(
    roomId,
    threadRootId,
    RelationType.Thread,
    EventType.RoomMessage,
    { dir: Direction.Backward, limit: 50 }
  );
  const bundled = getBundledTitleEvent(client.getRoom(roomId), result?.originalEvent);
  const info = getLatestThreadSummaryInfoFromEventSources(
    bundled ? [bundled] : undefined,
    result?.events
  );
  if (info && sessionId) storeThreadSummaryInState(sessionId, roomId, threadRootId, info);
  return {
    ...(sessionId ? {} : { summaryText: info?.summaryText }),
    rootPreviewText: getVisibleThreadEventBodyPreviewText(result?.originalEvent ?? undefined),
  };
};
