import type { TFunction } from 'i18next';
import { MsgType, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import {
  getCompactThreadRootPreviewInfo,
  isZeroReplyStandaloneThreadRootEvent,
} from '../event-store/threads/compactThreadRootData';
import {
  getThreadMessageBodyPreview,
  localizeThreadPreview,
} from '../event-store/threads/threadMessagePreview';
import { isThreadPinned } from '../event-store/threads/threadPinning';
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
import type { CaptureReply, CaptureThread } from './captureItems';

/**
 * The reply's whole text, as its newest edit shows it, when it is a text message and loaded:
 * cleaned as the app's previews clean it (tool calls counted, Markdown dropped), its lines kept,
 * and as its sender wrote it.
 */
const replyBody = (
  room: Room,
  rootId: string,
  eventId: string,
  t: TFunction
): { text: string; own: string } | undefined => {
  const thread = room.getThread(rootId);
  const latest = thread?.replyToEvent;
  const event: MatrixEvent | undefined =
    room.findEventById(eventId) ?? (latest?.getId() === eventId ? latest : undefined);
  if (!event) return undefined;
  const content = getLatestMessageContent(
    event,
    getEditedEvent(eventId, event, thread?.timelineSet)
  );
  if (content.msgtype !== MsgType.Text || typeof content.body !== 'string') return undefined;
  const { text, localization } = getThreadMessageBodyPreview(content.body);
  const cleaned = localizeThreadPreview(text, localization, t);
  return cleaned === undefined ? undefined : { text: cleaned, own: content.body };
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
    const body = replyBody(room, entry.threadRootId, reply.eventId, t);
    return {
      replyText: body?.text ?? threadPreviewText(t, reply.preview),
      ...(body ? { copyText: body.own } : {}),
      ...sender(reply.senderId),
    };
  }
  const indexed = threadIndexReplyPreview(entry);
  return indexed ? { replyText: indexed.text, ...sender(indexed.senderId) } : {};
};

/**
 * The user's own roots in the room's live timeline that nobody answered and `known` does not
 * hold: the entries posted there. In a chat room every other message would be one too.
 */
const unansweredRoots = (
  room: Room,
  userId: string,
  known: Set<string>,
  now: number
): CaptureThread[] =>
  room
    .getLiveTimeline()
    .getEvents()
    .flatMap((event) => {
      const eventId = event.getId();
      if (
        !eventId ||
        known.has(eventId) ||
        event.getSender() !== userId ||
        !isZeroReplyStandaloneThreadRootEvent(event, now)
      ) {
        return [];
      }
      known.add(eventId);
      const body = getCompactThreadRootPreviewInfo(event, { eventId, room })?.previewText ?? '';
      return [
        {
          threadId: eventId,
          title: revealDirectionControls(body),
          reply: () => ({}),
          pinned: isThreadPinned(room, eventId),
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
 * timeline, the user's roots nobody answered that the index does not hold.
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
        reply: () => readReply(mx, room, entry, signals, t),
        pinned: isThreadPinned(room, entry.threadRootId),
        streaming: entry.threadRecord.status.isStreaming,
        needsYou: !!signals.pendingApproval || !!signals.pendingQuestion,
        unread: entry.isUnread,
        resolved: entry.isResolved,
        ...(entry.resolvedTs === undefined ? {} : { resolvedTs: entry.resolvedTs }),
        ts: entry.lastActivityTs,
      });
    }
  }
  return [...threads, ...unansweredRoots(room, userId, known, now)];
};
