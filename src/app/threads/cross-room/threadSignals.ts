import { MatrixEvent, NotificationCountType, Room } from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { canSubmitApprovalDecision } from '../../approvals/approvalActions';
import { getThreadReadState, isReplyUnread } from '../../event-store/threads/roomThreadList';
import {
  getThreadMessagePreviewText,
  getThreadPreviewLocalization,
  type ThreadPreviewLocalization,
} from '../../event-store/threads/threadMessagePreview';
import { threadReceiptNamesEvent } from '../../event-store/threads/streamFinish';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { getSyncedEdit } from '../../matrix/client/syncedEdits';
import { isMainTimelineMessageUnread } from '../../matrix/mainTimelineRead';
import { getAiRunInfo, readOwnStreamStatus, readStreamStatus } from '../../matrix/protocol/aiRun';
import { STREAM_STATUS_TS_KEY } from '../../matrix/protocol/editMetadata';
import { isCallRowEvent } from '../../matrix/protocol/callRow';
import { hasLongTextMetadata } from '../../matrix/protocol/longText';
import { ORIGINAL_SENDER_KEY } from '../../matrix/protocol/originalSender';
import {
  readInteractiveQuestion,
  readInteractiveSourceEventId,
  readRoomQuestionAnswer,
  type InteractiveQuestion,
} from '../../matrix/protocol/interactiveQuestion';
import { isThinkingPlaceholderBody } from '../../matrix/protocol/thinkingPlaceholder';
import {
  collectThreadApprovals,
  isPendingApproval,
  type ThreadApprovalRecord,
} from '../../matrix/protocol/threadApprovalModel';
import { isThreadSummaryEvent } from '../../matrix/protocol/threadSummary';
import {
  MINDROOM_TOOL_APPROVAL_EVENT,
  parseToolApprovalExpiryTimestamp,
} from '../../matrix/protocol/toolApproval';
import { getEditedEvent, getLatestMessageContent } from '../../matrix/room';
import { hasMessagePreviews, type PluginEvent } from '../../plugins/messageRenderers';
import type { CrossRoomThreadIndexEntry } from './crossRoomThreadIndex';

export type ThreadPreview =
  | { kind: 'text'; text: string; localization?: ThreadPreviewLocalization }
  | { kind: 'voice' | 'image' | 'video' | 'file' };
export type ThreadReply = {
  eventId: string;
  senderId: string;
  ts: number;
  preview: ThreadPreview;
  /** The reply as the timeline gives it to a plugin's message renderer, while one has a preview. */
  event?: PluginEvent;
};
export type ThreadQuestion = InteractiveQuestion & { eventId: string; senderId: string };
export type ThreadOutcome = {
  kind: 'finished' | 'stopped';
  senderId: string;
  ts: number;
  durationMs: number;
  toolCount?: number;
};
/** What a thread has for the person: what waits for them, what is new, how its last run ended. */
export type ThreadSignals = {
  pendingApproval?: ThreadApprovalRecord;
  pendingQuestion?: ThreadQuestion;
  mentionedMe: boolean;
  /** Who sent the newest unread reply that names the person. */
  mentionedBy?: string;
  newCount: number;
  /** The senders of the new replies, newest first. */
  newSenderIds: string[];
  lastReply?: ThreadReply;
  /** Newest counted reply from a sender other than the reader. */
  lastOtherReply?: ThreadReply;
  outcome?: ThreadOutcome;
  /** An agent started it and no person has written in it: a scheduled run, a hook. */
  automation: boolean;
  /** When what it waits on lapses with no event: the approval expires, the question ages out. */
  waitsUntil?: number;
  /** When the newest of what it counts came: a message, by its newest edit, or the approval. */
  newsTs?: number;
  /** The same for messages from others only (not the reader), or the approval. */
  otherNewsTs?: number;
  /** The same for messages from other people only: not agents, not the reader. */
  personNewsTs?: number;
};

/** The newest events of a thread the signals read. */
export const SIGNAL_EVENT_LIMIT = 40;
/** A reply whose last edit came this long after it tells that its run finished. */
export const FINISHED_AFTER_MS = 60_000;

const PREVIEW_LENGTH = 240;
/** How long an agent's question waits for an answer before it stops asking. */
export const QUESTION_WAITS_MS = 7 * 24 * 60 * 60 * 1000;
const STOPPED_STATUSES = new Set(['cancelled', 'error', 'interrupted', 'failed', 'stopped']);
const FINISHED_STATUSES = new Set(['completed', 'complete', 'done', 'cached']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** An event of the thread itself: not an edit, a reaction or a redaction of another event. */
const isFirstOrder = (event: MatrixEvent): boolean => {
  if (event.getType() === 'm.reaction' || event.isRedaction()) return false;
  const relation: string | undefined = event.getRelation()?.rel_type;
  return !relation || relation === 'm.thread';
};

/** What a message says now: its newest readable edit by its sender, else itself. */
type Shown = {
  event: MatrixEvent;
  content: Record<string, unknown>;
  editTs?: number;
  editId?: string;
};

const shownOf = (event: MatrixEvent, thread: Thread | null | undefined): Shown => {
  const id = event.getId();
  const edit = id ? getEditedEvent(id, event, thread?.timelineSet) : undefined;
  if (!edit) return { event, content: event.getContent() };
  const editContent = edit.getContent();
  const newContent = editContent['m.new_content'];
  return {
    event,
    content: isRecord(newContent) ? newContent : editContent,
    editTs: edit.getTs(),
    editId: edit.getId(),
  };
};

/** A thread's message as the timeline gives it to a plugin's message renderer: its newest edit. */
const threadMessagePluginEvent = (
  room: Room,
  event: MatrixEvent,
  thread: Thread | null | undefined
): PluginEvent => {
  const id = event.getId();
  return {
    eventId: id,
    roomId: room.roomId,
    type: event.getType(),
    sender: event.getSender() ?? '',
    content: getLatestMessageContent(
      event,
      id ? getEditedEvent(id, event, thread?.timelineSet) : undefined
    ),
  };
};

/**
 * The root of a thread without an AI title as a plugin's message renderer sees it, for a title
 * from the plugin (`useMessagePreview`). Undefined with an AI title or while the root is not loaded.
 */
export const threadRootPluginEvent = (
  room: Room | null,
  entry: Pick<CrossRoomThreadIndexEntry, 'threadRecord' | 'threadRootId'>
): PluginEvent | undefined => {
  // The index's `summaryText` falls back to the root's text; the AI title is the presentation's.
  if (!room || !hasMessagePreviews() || entry.threadRecord.presentation.summaryText !== undefined) {
    return undefined;
  }
  const thread = room.getThread(entry.threadRootId);
  const root = thread?.rootEvent ?? room.findEventById(entry.threadRootId);
  return root ? threadMessagePluginEvent(room, root, thread) : undefined;
};

const countsAsNews = ({ event, content }: Shown): boolean => {
  if (event.getType() !== 'm.room.message' || !isFirstOrder(event)) return false;
  if (event.isRedacted() || event.isDecryptionFailure()) return false;
  if (content.msgtype === 'm.notice') return false;
  return (
    !isThreadSummaryEvent(event) && !isCallRowEvent(event) && !isThinkingPlaceholderBody(content)
  );
};

const previewOf = (content: Record<string, unknown>): ThreadPreview => {
  switch (content.msgtype) {
    case 'm.audio':
      return content['org.matrix.msc3245.voice'] !== undefined
        ? { kind: 'voice' }
        : { kind: 'file' };
    case 'm.image':
      return { kind: 'image' };
    case 'm.video':
      return { kind: 'video' };
    case 'm.file':
      if (!hasLongTextMetadata(content)) return { kind: 'file' };
      break;
    default:
      break;
  }
  // As the rest of the app previews it: tool calls counted, Markdown and reply quotes dropped.
  const text = getThreadMessagePreviewText(content) ?? '';
  const localization = getThreadPreviewLocalization(content, text);
  return {
    kind: 'text',
    text: text.slice(0, PREVIEW_LENGTH),
    ...(localization ? { localization } : {}),
  };
};

/**
 * The thread's events: everything loaded (edits included, which the approvals read), and its own
 * messages, the newest `SIGNAL_EVENT_LIMIT` of them, from the loaded timeline and the summary's
 * latest reply.
 */
const threadEvents = (room: Room, rootId: string) => {
  const thread = room.getThread(rootId);
  const all = [...(thread?.events ?? [])];
  const latest = thread?.replyToEvent;
  if (latest && !all.some((event) => event.getId() === latest.getId())) all.push(latest);
  all.sort((a, b) => a.getTs() - b.getTs());
  const root = thread?.rootEvent ?? room.findEventById(rootId);
  const replies = all
    .filter((event) => event.getId() !== rootId && isFirstOrder(event))
    .slice(-SIGNAL_EVENT_LIMIT);
  return { thread, all, root, replies };
};

const readQuestion = ({ event, content }: Shown): ThreadQuestion | undefined => {
  const question = readInteractiveQuestion(content, event.getOriginalContent());
  return (
    question && { eventId: event.getId() ?? '', senderId: event.getSender() ?? '', ...question }
  );
};

const questionSourceId = ({ event, content }: Shown): string | undefined =>
  readInteractiveSourceEventId(content, event.getOriginalContent());

const readOutcome = ({ event, content, editTs }: Shown): ThreadOutcome | undefined => {
  const run = getAiRunInfo(content);
  const runStatus = run?.status?.toLowerCase();
  const terminalRunStatus =
    runStatus && (STOPPED_STATUSES.has(runStatus) || FINISHED_STATUSES.has(runStatus))
      ? runStatus
      : undefined;
  // A run status that says the run goes on outweighs a stream status borrowed from an older edit,
  // as of a retry after a finished or stopped run; a stop note's own status still gives an outcome.
  const streamStatus =
    runStatus && !terminalRunStatus ? readOwnStreamStatus(content) : readStreamStatus(content);
  const status = terminalRunStatus ?? streamStatus ?? '';
  const borrowedStreamStatusTs =
    !terminalRunStatus && typeof content[STREAM_STATUS_TS_KEY] === 'number'
      ? content[STREAM_STATUS_TS_KEY]
      : undefined;
  const ts = borrowedStreamStatusTs ?? editTs ?? event.getTs();
  const durationMs = ts - event.getTs();
  const base = {
    senderId: event.getSender() ?? '',
    ts,
    durationMs,
    ...(run?.toolCount !== undefined ? { toolCount: run.toolCount } : {}),
  };
  if (STOPPED_STATUSES.has(status)) return { kind: 'stopped', ...base };
  if (FINISHED_STATUSES.has(status) && durationMs >= FINISHED_AFTER_MS) {
    return { kind: 'finished', ...base };
  }
  return undefined;
};

const namesUser = (content: Record<string, unknown>, userId: string): boolean => {
  const mentions = content['m.mentions'];
  return (
    isRecord(mentions) && Array.isArray(mentions.user_ids) && mentions.user_ids.includes(userId)
  );
};

/**
 * Reads one thread's newest messages (`SIGNAL_EVENT_LIMIT`) for what it has for `userId`, each as
 * its newest edit shows it. Only MindRoom agents of the person's own homeserver can ask, need
 * approval or run. The root is never a reply. A resolved thread (`resolvedTs` is set) has no
 * pending question and only keeps approvals asked after the resolve. A counted message from
 * anyone clears a pending question if it was sent after the question was asked.
 */
export const readThreadSignals = (
  room: Room,
  rootId: string,
  userId: string,
  now = Date.now(),
  resolvedTs?: number
): ThreadSignals => {
  const { thread, all, root, replies } = threadEvents(room, rootId);
  const isAgent = (senderId: string | undefined) =>
    isMindroomAgentUserIdForViewer(senderId, userId);
  // An agent's relay of someone's message (the router's handoff) echoes words already counted.
  const isRelay = ({ event, content }: Shown) =>
    isAgent(event.getSender()) && typeof content[ORIGINAL_SENDER_KEY] === 'string';
  const counted = replies
    .map((event) => shownOf(event, thread))
    .filter((shown) => countsAsNews(shown) && !isRelay(shown));
  // A receipt can name a reply's edit that the server bundled with it, outside the thread's
  // timeline (after a reload, on another device): it reads up to that edit, and so the replies
  // before it too.
  const readState = getThreadReadState(thread, userId);
  const readUpToTs = counted.reduce(
    (upTo, { editId, editTs }) =>
      thread &&
      editId &&
      editTs !== undefined &&
      (upTo === undefined || editTs > upTo) &&
      threadReceiptNamesEvent(thread, userId, editId)
        ? editTs
        : upTo,
    readState?.readUpToTs
  );
  // Each reply is unread as the thread list reads its latest one.
  const isUnread = ({ event }: Shown) =>
    thread
      ? isReplyUnread(thread, userId, event, {
          readEventIds: readState?.readEventIds ?? new Set(),
          readUpToTs,
        })
      : event.getSender() !== userId;
  const unread = counted.filter(isUnread);
  const newest = counted.at(-1);
  const otherCounted = counted.filter(({ event }) => {
    const sender = event.getSender();
    return !!sender && sender !== userId;
  });
  const newestOther = otherCounted.at(-1);
  const answeredByResolve = (askedTs: number | undefined) =>
    resolvedTs !== undefined && (askedTs ?? 0) <= resolvedTs;

  // MindRoom answers a card by editing it, which a thread not opened holds back: the edits the
  // sync brought count too.
  const syncedCardEdits = all.flatMap((event) => {
    const edit =
      event.getType() === MINDROOM_TOOL_APPROVAL_EVENT
        ? getSyncedEdit(event.getId() ?? '')
        : undefined;
    return edit && !all.includes(edit) ? [edit] : [];
  });
  const pendingApproval = collectThreadApprovals(
    [...all, ...syncedCardEdits],
    room.roomId,
    rootId,
    now
  )
    .filter(
      (record) =>
        record.sender !== userId &&
        isAgent(record.sender) &&
        isPendingApproval(record, now) &&
        !answeredByResolve(all.find((event) => event.getId() === record.eventId)?.getTs()) &&
        canSubmitApprovalDecision(record, userId, undefined, now)
    )
    .at(-1);

  const newestAgentReply = otherCounted.findLast(({ event }) => isAgent(event.getSender()));
  let pendingQuestion =
    resolvedTs === undefined && newestAgentReply ? readQuestion(newestAgentReply) : undefined;
  // A streamed reply asks once its last edit adds the question.
  const askedAt = newestAgentReply
    ? (newestAgentReply.editTs ?? newestAgentReply.event.getTs())
    : 0;
  if (pendingQuestion && newestAgentReply) {
    // Clock skew can timestamp an edit before its original, so skip the question itself.
    const hasNewerMessage = counted.some(
      ({ event }) => event !== newestAgentReply.event && event.getTs() > askedAt
    );
    // The message it answers, or the router's relay of it, names whom the agent asks.
    // The first turn of a thread answers its root, which the thread's events need not hold.
    const sourceId = questionSourceId(newestAgentReply);
    const source = [...all, ...(root ? [root] : [])].find((event) => event.getId() === sourceId);
    const asker = source?.getContent()[ORIGINAL_SENDER_KEY] ?? source?.getSender();
    const askedSomeoneElse = typeof asker === 'string' && asker !== userId && !isAgent(asker);
    if (
      hasNewerMessage ||
      askedSomeoneElse ||
      now - askedAt >= QUESTION_WAITS_MS ||
      // One answer per question: anyone's answer closes it, as the question card shows.
      readRoomQuestionAnswer(room, pendingQuestion.eventId, pendingQuestion, userId)
    ) {
      pendingQuestion = undefined;
    }
  }

  // A root that names the user, unread, mentions them too. The root is a main-timeline message:
  // the main timeline's receipts read it, as the room's unread state reads it.
  const rootShown = root ? shownOf(root, thread) : undefined;
  const rootUnread = !!root && isMainTimelineMessageUnread(room, root, userId);
  const mentionCandidates = rootShown && rootUnread ? [rootShown, ...unread] : unread;
  const mention = mentionCandidates.findLast(({ content }) => namesUser(content, userId));
  const mentionedMe =
    !!mention || room.getThreadUnreadNotificationCount(rootId, NotificationCountType.Highlight) > 0;
  const mentionedBy = mention?.event.getSender();

  const automation =
    isAgent(root?.getSender()) && !counted.some(({ event }) => !isAgent(event.getSender()));

  // A summary notice or an edit of an approval card is no news; a new message or card is.
  const approvalTs = pendingApproval
    ? all.find((event) => event.getId() === pendingApproval.eventId)?.getTs()
    : undefined;
  const newsTs = Math.max(
    approvalTs ?? 0,
    ...counted.map(({ event, editTs }) => editTs ?? event.getTs())
  );
  const otherNewsTs = Math.max(
    approvalTs ?? 0,
    ...otherCounted.map(({ event, editTs }) => editTs ?? event.getTs())
  );
  const personNewsTs = Math.max(
    0,
    ...otherCounted
      .filter(({ event }) => !isAgent(event.getSender()))
      .map(({ event, editTs }) => editTs ?? event.getTs())
  );
  const toReply = ({ event, content }: Shown): ThreadReply => ({
    eventId: event.getId() ?? '',
    senderId: event.getSender() ?? '',
    ts: event.getTs(),
    preview: previewOf(content),
    ...(hasMessagePreviews() ? { event: threadMessagePluginEvent(room, event, thread) } : {}),
  });
  const lastReply = newest ? toReply(newest) : undefined;
  const lastOtherReply =
    newestOther === newest ? lastReply : newestOther ? toReply(newestOther) : undefined;

  const lapses = [
    pendingApproval && parseToolApprovalExpiryTimestamp(pendingApproval.approval.expiresAt),
    pendingQuestion && askedAt + QUESTION_WAITS_MS,
  ].filter((ts): ts is number => typeof ts === 'number');
  return {
    ...(lapses.length > 0 ? { waitsUntil: Math.min(...lapses) } : {}),
    ...(newsTs > 0 ? { newsTs } : {}),
    ...(otherNewsTs > 0 ? { otherNewsTs } : {}),
    ...(personNewsTs > 0 ? { personNewsTs } : {}),
    ...(pendingApproval ? { pendingApproval } : {}),
    ...(pendingQuestion ? { pendingQuestion } : {}),
    mentionedMe,
    ...(mentionedBy ? { mentionedBy } : {}),
    newCount: unread.length,
    newSenderIds: [...new Set(unread.map(({ event }) => event.getSender() ?? '').reverse())],
    ...(lastReply ? { lastReply } : {}),
    ...(lastOtherReply ? { lastOtherReply } : {}),
    ...(newestAgentReply ? withOutcome(readOutcome(newestAgentReply)) : {}),
    automation,
  };
};

const withOutcome = (outcome: ThreadOutcome | undefined) => (outcome ? { outcome } : {});
