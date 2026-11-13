import type { TFunction } from 'i18next';
import { MsgType, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import {
  getCompactThreadRootPreviewInfo,
  isZeroReplyStandaloneThreadRootEvent,
} from '../event-store/threads/compactThreadRootData';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';
import type { CrossRoomThreadIndexEntry } from '../threads/cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../threads/cross-room/threadSignals';
import { getThreadSignalsReader } from '../threads/cross-room/threadSignalsReader';
import {
  threadActorName,
  threadIndexReplyPreview,
  threadPreviewText,
  threadTitleText,
} from '../threads/cross-room/threadText';
import { revealDirectionControls } from '../ui/directional';
import type { CaptureThread } from './captureItems';

type CaptureReply = Pick<CaptureThread, 'replyText' | 'replySender'>;

/** The reply's whole text, as its newest edit shows it, when it is a text message and loaded. */
const replyBody = (room: Room, rootId: string, eventId: string): string | undefined => {
  const thread = room.getThread(rootId);
  const latest = thread?.replyToEvent;
  const event: MatrixEvent | undefined =
    room.findEventById(eventId) ?? (latest?.getId() === eventId ? latest : undefined);
  if (!event) return undefined;
  const content = getLatestMessageContent(
    event,
    getEditedEvent(eventId, event, thread?.timelineSet)
  );
  return content.msgtype === MsgType.Text && typeof content.body === 'string'
    ? content.body
    : undefined;
};

/** The thread's newest reply and its sender: from the signals, else from the index's preview. */
const readReply = (
  mx: MatrixClient,
  room: Room,
  entry: CrossRoomThreadIndexEntry,
  signals: ThreadSignals,
  t: TFunction
): CaptureReply => {
  const sender = (senderId: string | undefined): CaptureReply =>
    senderId ? { replySender: threadActorName(mx, room, senderId) } : {};
  const reply = signals.lastReply;
  if (reply) {
    return {
      replyText:
        replyBody(room, entry.threadRootId, reply.eventId) ?? threadPreviewText(t, reply.preview),
      ...sender(reply.senderId),
    };
  }
  const indexed = threadIndexReplyPreview(entry);
  return indexed ? { replyText: indexed.text, ...sender(indexed.senderId) } : {};
};

/** The roots in the room's live timeline that nobody answered and `known` does not hold. */
const unansweredRoots = (room: Room, known: Set<string>, now: number): CaptureThread[] =>
  room
    .getLiveTimeline()
    .getEvents()
    .flatMap((event) => {
      const eventId = event.getId();
      if (!eventId || known.has(eventId) || !isZeroReplyStandaloneThreadRootEvent(event, now)) {
        return [];
      }
      known.add(eventId);
      const body = getCompactThreadRootPreviewInfo(event, { eventId, room })?.previewText ?? '';
      return [
        {
          threadId: eventId,
          title: revealDirectionControls(body),
          streaming: false,
          needsYou: false,
          unread: false,
          resolved: false,
          ts: event.getTs(),
        },
      ];
    });

/**
 * The room's threads for the widget: the index's entries of the room and, from the room's live
 * timeline, the roots nobody answered that the index does not hold.
 */
export const readCaptureThreads = (
  mx: MatrixClient,
  room: Room,
  entries: Iterable<CrossRoomThreadIndexEntry>,
  t: TFunction,
  now: number
): CaptureThread[] => {
  const userId = mx.getSafeUserId();
  const reader = getThreadSignalsReader(mx);
  const known = new Set<string>();
  const threads: CaptureThread[] = [];
  for (const entry of entries) {
    if (entry.roomId === room.roomId) {
      known.add(entry.threadRootId);
      const signals = reader.read(room, entry, userId, now);
      threads.push({
        threadId: entry.threadRootId,
        title: threadTitleText(entry),
        ...readReply(mx, room, entry, signals, t),
        streaming: entry.threadRecord.status.isStreaming,
        needsYou: !!signals.pendingApproval || !!signals.pendingQuestion,
        unread: entry.isUnread,
        resolved: entry.isResolved,
        ...(entry.resolvedTs === undefined ? {} : { resolvedTs: entry.resolvedTs }),
        ts: entry.lastActivityTs,
      });
    }
  }
  return [...threads, ...unansweredRoots(room, known, now)];
};
