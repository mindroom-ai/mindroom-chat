import { EventType, MatrixEvent, NotificationCountType, RelationType, Room } from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { canSubmitApprovalDecision } from '../../approvals/approvalActions';
import { getThreadReadState } from '../../event-store/threads/roomThreadList';
import { threadReceiptNamesEvent } from '../../event-store/threads/streamFinish';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { getAiRunInfo, getStreamStatusFromContent } from '../../matrix/protocol/aiRun';
import { isCallRowEvent } from '../../matrix/protocol/callRow';
import { isThinkingPlaceholderBody } from '../../matrix/protocol/thinkingPlaceholder';
import {
  collectThreadApprovals,
  isPendingApproval,
  type ThreadApprovalRecord,
} from '../../matrix/protocol/threadApprovalModel';
import { isThreadSummaryEvent } from '../../matrix/protocol/threadSummary';
import { getEditedEvent } from '../../matrix/room';

export type ThreadPreview =
  | { kind: 'text'; text: string }
  | { kind: 'voice' | 'image' | 'video' | 'file' };
export type ThreadReply = { eventId: string; senderId: string; ts: number; preview: ThreadPreview };
export type ThreadQuestion = {
  eventId: string;
  senderId: string;
  text: string;
  options: { key: string; label: string }[];
};
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
  outcome?: ThreadOutcome;
  /** An agent started it and no person has written in it: a scheduled run, a hook. */
  automation: boolean;
};

/** The newest events of a thread the signals read. */
export const SIGNAL_EVENT_LIMIT = 40;
/** A reply whose last edit came this long after it tells that its run finished. */
export const FINISHED_AFTER_MS = 60_000;

/** Who wrote the message an agent relays (MindRoom's router handoff). */
const ORIGINAL_SENDER_KEY = 'com.mindroom.original_sender';
/** Agent question content (MindRoom's `interactive_prompt_content`). */
const INTERACTIVE_KEY = 'io.mindroom.interactive';
const PREVIEW_LENGTH = 240;
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

const countsAsNews = ({ event, content }: Shown): boolean => {
  if (event.getType() !== 'm.room.message' || !isFirstOrder(event)) return false;
  if (event.isRedacted() || event.isDecryptionFailure()) return false;
  if (content.msgtype === 'm.notice') return false;
  return (
    !isThreadSummaryEvent(event) && !isCallRowEvent(event) && !isThinkingPlaceholderBody(content)
  );
};

/**
 * A message that counts as news in a thread: one of the thread's own messages (not an edit), not a
 * notice (agents' titles, skill reviews and hook reports are notices), a call row, a thinking
 * placeholder, nor redacted or undecryptable.
 */
export const isCountedReply = (event: MatrixEvent): boolean =>
  countsAsNews({ event, content: event.getContent() });

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
      return { kind: 'file' };
    default: {
      const body = typeof content.body === 'string' ? content.body : '';
      return { kind: 'text', text: body.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH) };
    }
  }
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
  const payload = content[INTERACTIVE_KEY] ?? event.getOriginalContent()[INTERACTIVE_KEY];
  if (!isRecord(payload) || !isRecord(payload.options)) return undefined;
  const labels = isRecord(payload.option_labels) ? payload.option_labels : {};
  // Number keys answer by typing; the emoji keys are the reaction buttons.
  const options = Object.entries(payload.options)
    .filter(([key, value]) => !/^\d+$/.test(key) && typeof value === 'string')
    .map(([key, value]) => {
      const label = labels[key];
      return { key, label: typeof label === 'string' && label ? label : String(value) };
    });
  const text = typeof payload.question_text === 'string' ? payload.question_text : '';
  if (options.length === 0 || !text) return undefined;
  return { eventId: event.getId() ?? '', senderId: event.getSender() ?? '', text, options };
};

const answeredByReaction = (room: Room, question: ThreadQuestion, userId: string): boolean => {
  const reactions = room
    .getUnfilteredTimelineSet()
    .relations.getChildEventsForEvent(
      question.eventId,
      RelationType.Annotation,
      EventType.Reaction
    );
  const keys = new Set(question.options.map((option) => option.key));
  return (reactions?.getRelations() ?? []).some(
    (reaction) =>
      reaction.getSender() === userId &&
      !reaction.isRedacted() &&
      keys.has(reaction.getRelation()?.key ?? '')
  );
};

const readOutcome = ({ event, content, editTs }: Shown): ThreadOutcome | undefined => {
  const run = getAiRunInfo(content);
  const status = (run?.status ?? getStreamStatusFromContent(content) ?? '').toLowerCase();
  const ts = editTs ?? event.getTs();
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
 * approval or run. The root is never a reply.
 */
export const readThreadSignals = (
  room: Room,
  rootId: string,
  userId: string,
  now = Date.now()
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
  // timeline (after a reload, on another device): it reads up to that edit.
  const readUpToTs = counted.reduce(
    (upTo, { editId, editTs }) =>
      thread &&
      editId &&
      editTs !== undefined &&
      (upTo === undefined || editTs > upTo) &&
      threadReceiptNamesEvent(thread, userId, editId)
        ? editTs
        : upTo,
    getThreadReadState(thread, userId)?.readUpToTs
  );
  const isUnread = (shown: Shown) =>
    shown.event.getSender() !== userId &&
    (readUpToTs === undefined || (shown.editTs ?? shown.event.getTs()) > readUpToTs);
  const unread = counted.filter(isUnread);
  const newest = counted.at(-1);

  const pendingApproval = collectThreadApprovals(all, room.roomId, rootId, now)
    .filter(
      (record) =>
        isAgent(record.sender) &&
        isPendingApproval(record, now) &&
        canSubmitApprovalDecision(record, userId, undefined, now)
    )
    .at(-1);

  const newestAgentReply = counted.findLast(({ event }) => isAgent(event.getSender()));
  let pendingQuestion = newestAgentReply ? readQuestion(newestAgentReply) : undefined;
  if (pendingQuestion && newestAgentReply) {
    const askedAt = newestAgentReply.event.getTs();
    const wroteSince = counted.some(
      ({ event }) => event.getSender() === userId && event.getTs() > askedAt
    );
    if (wroteSince || answeredByReaction(room, pendingQuestion, userId)) {
      pendingQuestion = undefined;
    }
  }

  // A root that names the user, unread, mentions them too.
  const rootShown = root ? shownOf(root, thread) : undefined;
  const mentionCandidates = rootShown && isUnread(rootShown) ? [rootShown, ...unread] : unread;
  const mention = mentionCandidates.findLast(({ content }) => namesUser(content, userId));
  const mentionedMe =
    !!mention || room.getThreadUnreadNotificationCount(rootId, NotificationCountType.Highlight) > 0;
  const mentionedBy = mention?.event.getSender();

  const automation =
    isAgent(root?.getSender()) && !counted.some(({ event }) => !isAgent(event.getSender()));

  return {
    ...(pendingApproval ? { pendingApproval } : {}),
    ...(pendingQuestion ? { pendingQuestion } : {}),
    mentionedMe,
    ...(mentionedBy ? { mentionedBy } : {}),
    newCount: unread.length,
    newSenderIds: [...new Set(unread.map(({ event }) => event.getSender() ?? '').reverse())],
    ...(newest
      ? {
          lastReply: {
            eventId: newest.event.getId() ?? '',
            senderId: newest.event.getSender() ?? '',
            ts: newest.event.getTs(),
            preview: previewOf(newest.content),
          },
        }
      : {}),
    ...(newestAgentReply ? withOutcome(readOutcome(newestAgentReply)) : {}),
    automation,
  };
};

const withOutcome = (outcome: ThreadOutcome | undefined) => (outcome ? { outcome } : {});
