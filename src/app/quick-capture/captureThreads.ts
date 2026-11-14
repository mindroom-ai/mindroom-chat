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
import { getBundledThreadPreviews } from '../event-store/threads/threadBundledPreviews';
import { isThreadPinned } from '../event-store/threads/threadPinning';
import { isThreadResolved } from '../event-store/threads/threadTags';
import { getVisibleThreadEventBodyPreviewText } from '../event-store/threads/threadUtils';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';
import {
  getMessageCopyTexts,
  getMessageCopyTextSource,
  scanToolMarkerLines,
} from '../messages/messageCopyText';
import type { CrossRoomThreadIndexEntry } from '../threads/cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../threads/cross-room/threadSignals';
import { getThreadSignalsReader } from '../threads/cross-room/threadSignalsReader';
import { getRoomThreadTagSnapshotMap } from '../threads/tags/threadTagSnapshots';
import {
  threadActorName,
  threadIndexReplyPreview,
  threadPreviewText,
  threadTitleText,
} from '../threads/cross-room/threadText';
import { revealDirectionControls } from '../ui/directional';
import type { CaptureReply, CaptureThread } from './captureItems';

/** Each reply's copy text with the edit it was read from: the scan of its tool lines is costly. */
const copyTexts = new WeakMap<MatrixEvent, { editId: string | undefined; text: string }>();

/**
 * The reply as the app's Copy text copies it: as its sender wrote it, without MindRoom's tool-call
 * lines (a reply of only tool calls keeps them).
 */
const copyTextOf = (
  event: MatrixEvent,
  edit: MatrixEvent | undefined,
  content: Record<string, unknown>
): string | undefined => {
  const editId = edit?.getId();
  const cached = copyTexts.get(event);
  if (cached && cached.editId === editId) return cached.text;
  const source = getMessageCopyTextSource(content, event.getOriginalContent());
  if (!source) return undefined;
  const { body, formattedBody, plainBodyFallback } = source;
  const { text } = getMessageCopyTexts(
    source,
    scanToolMarkerLines(body, formattedBody, plainBodyFallback)
  );
  copyTexts.set(event, { editId, text });
  return text;
};

/**
 * The reply's whole text, as its newest edit shows it, when it is a text message and loaded:
 * cleaned as the app's previews clean it (tool calls counted, Markdown dropped), its lines kept,
 * and as the app's Copy text copies it.
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
  const edit = getEditedEvent(eventId, event, thread?.timelineSet);
  const content = getLatestMessageContent(event, edit);
  if (content.msgtype !== MsgType.Text || typeof content.body !== 'string') return undefined;
  const { text, localization } = getThreadMessageBodyPreview(content.body);
  const cleaned = localizeThreadPreview(text, localization, t);
  const own = copyTextOf(event, edit, content);
  return cleaned === undefined || own === undefined ? undefined : { text: cleaned, own };
};

/**
 * The reply the server bundled with the root (`io.mindroom.latest_reply`) as the app's Copy text
 * copies it, where it is the reply the index's preview shows: a reply not loaded yet, as after a
 * restart.
 */
const bundledReplyBody = (room: Room, entry: CrossRoomThreadIndexEntry): string | undefined => {
  const root =
    room.findEventById(entry.threadRootId) ?? room.getThread(entry.threadRootId)?.rootEvent;
  const reply = getBundledThreadPreviews(room, root).reply;
  const shown = entry.threadRecord.presentation?.latestReplyPreviewText;
  if (!reply || !shown || getVisibleThreadEventBodyPreviewText(reply) !== shown) return undefined;
  const edit = reply.replacingEvent() ?? undefined;
  const content = getLatestMessageContent(reply, edit);
  return content.msgtype === MsgType.Text && typeof content.body === 'string'
    ? copyTextOf(reply, edit, content)
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
    const body = replyBody(room, entry.threadRootId, reply.eventId, t);
    return {
      replyText: body?.text ?? threadPreviewText(t, reply.preview),
      ...(body ? { copyText: body.own } : {}),
      ...sender(reply.senderId),
    };
  }
  const indexed = threadIndexReplyPreview(entry);
  if (!indexed) return {};
  const own = bundledReplyBody(room, entry);
  return {
    replyText: indexed.text,
    ...(own === undefined ? {} : { copyText: own }),
    ...sender(indexed.senderId),
  };
};

/**
 * The user's own roots in the room's live timeline that nobody answered and `known` does not
 * hold: the entries posted there. In a chat room every other message would be one too. Their
 * resolved tags are read as the index reads them: a pinned thread is never resolved.
 */
const unansweredRoots = (
  room: Room,
  userId: string,
  known: Set<string>,
  now: number
): CaptureThread[] => {
  const tags = getRoomThreadTagSnapshotMap(room);
  return room
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
      const pinned = isThreadPinned(room, eventId);
      const tag = tags.get(eventId);
      const resolved = !!tag && isThreadResolved(tag.content, pinned);
      return [
        {
          threadId: eventId,
          title: revealDirectionControls(body),
          reply: () => ({}),
          pinned,
          streaming: false,
          needsYou: false,
          unread: false,
          resolved,
          ...(resolved && tag.resolvedTs !== undefined ? { resolvedTs: tag.resolvedTs } : {}),
          ts: event.getTs(),
        },
      ];
    });
};

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
