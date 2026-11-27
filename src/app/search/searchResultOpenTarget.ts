import { IEventWithRoomId, MatrixClient, MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import { getBundledThreadPreviews } from '../event-store/threads/threadBundledPreviews';
import { resolveThreadSummaryInfo } from '../event-store/threads/threadPresentation';
import { storeThreadSummaryInState } from '../event-store/threads/threadSummaryState';
import { isRecord } from '../lib/isRecord';
import {
  getThreadSummaryEventInfo,
  isThreadSummaryContent,
  pickLatestThreadSummaryInfo,
  type ThreadSummaryInfo,
} from '../matrix/protocol/threadSummary';

const LEGACY_THREAD_REL = 'org.matrix.msc3440.thread';

export type SearchResultOpenTarget = {
  mainEventId: string;
  threadRootId?: string;
  /** A thread's title notice: it opens its thread, which it stands for, not the notice. */
  threadTitle?: true;
};

export type SearchHitThread = { threadRootId: string; threadTitle?: true };
type MaybeRoom = Room | null | undefined;

export const getSearchResultOpenTarget = (
  event: Pick<IEventWithRoomId, 'content' | 'event_id'>
): SearchResultOpenTarget => {
  const relation = event.content['m.relates_to'];
  const threadRootId =
    relation?.rel_type === RelationType.Thread && relation.event_id ? relation.event_id : undefined;

  return {
    mainEventId:
      relation?.rel_type === RelationType.Replace && relation.event_id
        ? relation.event_id
        : event.event_id,
    threadRootId,
    ...(threadRootId && isThreadSummaryContent(event.content) ? { threadTitle: true } : {}),
  };
};

const hasBundledThread = (unsigned: unknown): boolean => {
  const rels = isRecord(unsigned) ? unsigned['m.relations'] : undefined;
  return isRecord(rels) && Boolean(rels[RelationType.Thread] ?? rels[LEGACY_THREAD_REL]);
};

const getBundledTitle = (room: MaybeRoom, root: MatrixEvent | null | undefined) => {
  if (typeof room?.getThread !== 'function' || typeof root?.getId !== 'function') return undefined;
  const title = getBundledThreadPreviews(room, root).title;
  return title ? getThreadSummaryEventInfo(title) : undefined;
};

const threadRelId = (rel: unknown) =>
  isRecord(rel) &&
  (rel.rel_type === RelationType.Thread || rel.rel_type === LEGACY_THREAD_REL) &&
  typeof rel.event_id === 'string'
    ? rel.event_id
    : undefined;

const toThread = (id: string, content: unknown, unsigned: unknown, root: boolean, rel?: string) => {
  const rec = isRecord(content) ? content : undefined;
  const rootId = threadRelId(rec?.['m.relates_to']) ?? rel;
  if (rootId && rootId !== id) {
    return rec && isThreadSummaryContent(rec)
      ? { threadRootId: rootId, threadTitle: true as const }
      : { threadRootId: rootId };
  }
  return root || hasBundledThread(unsigned) ? { threadRootId: id } : null;
};

const inspectLoaded = (room: MaybeRoom, id: string, knownRoot: boolean) => {
  const ev = room?.findEventById?.(id);
  if (!ev) return undefined;
  const rel = threadRelId(ev.getRelation?.()) ?? ev.threadRootId;
  const isRoot = Boolean(ev.isThreadRoot || knownRoot || room?.getThread?.(id));
  return toThread(id, ev.getWireContent?.() ?? ev.getContent?.(), ev.getUnsigned?.(), isRoot, rel);
};

export const resolveSyncSearchHitThread = (
  event: IEventWithRoomId,
  target: SearchResultOpenTarget,
  room: MaybeRoom,
  isKnownRoot = false
): { threadRootId?: string; isThreadTitle?: boolean; needsFetch?: boolean } => {
  const { mainEventId: id, threadRootId, threadTitle } = target;
  if (threadRootId) return { threadRootId, isThreadTitle: threadTitle };
  const knownRoot = isKnownRoot || Boolean(room?.getThread?.(id));
  if (id === event.event_id) {
    return knownRoot || hasBundledThread(event.unsigned) ? { threadRootId: id } : {};
  }
  const res = inspectLoaded(room, id, knownRoot);
  if (res === undefined) return knownRoot ? { threadRootId: id } : { needsFetch: true };
  return res ? { threadRootId: res.threadRootId, isThreadTitle: res.threadTitle } : {};
};

export const fetchSearchHitThread = async (
  client: MatrixClient,
  roomId: string,
  id: string,
  sessionId?: string
): Promise<SearchHitThread | null> => {
  const room = client.getRoom(roomId);
  const loaded = inspectLoaded(room, id, false);
  if (loaded !== undefined) return loaded;
  const ev = await client.fetchRoomEvent(roomId, id);
  const res = toThread(id, ev?.content, ev?.unsigned, Boolean(room?.getThread?.(id)));
  if (sessionId && res?.threadRootId === id && ev && hasBundledThread(ev.unsigned)) {
    const root = new MatrixEvent({ ...ev, event_id: ev.event_id ?? id, room_id: roomId });
    const info = getBundledTitle(room, root);
    if (info) storeThreadSummaryInState(sessionId, roomId, id, info);
  }
  return res;
};

export const resolveSearchThreadTitle = (
  room: MaybeRoom,
  event: IEventWithRoomId,
  rootId: string,
  summaries: ReadonlyMap<string, ThreadSummaryInfo>,
  extraSummaryInfo?: ThreadSummaryInfo
): string | undefined => {
  const thread = room?.getThread?.(rootId);
  const localRoot = thread?.rootEvent ?? room?.findEventById?.(rootId);
  const hasHit = rootId === event.event_id && hasBundledThread(event.unsigned);
  return pickLatestThreadSummaryInfo(
    extraSummaryInfo,
    summaries.get(rootId),
    resolveThreadSummaryInfo({ thread }),
    getBundledTitle(room, localRoot),
    getBundledTitle(room, hasHit ? new MatrixEvent(event) : undefined)
  )?.summaryText;
};
