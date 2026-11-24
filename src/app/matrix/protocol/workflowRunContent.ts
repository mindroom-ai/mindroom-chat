import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { isRecord } from '../../lib/isRecord';
import { isMindroomAgentUserIdForViewer } from './agentIdentity';
import { discardFailedLocalEcho } from './pendingLocalEcho';
import {
  optStr,
  parseRunSummary,
  parseWorkflowRunGraph,
  stringList,
  WORKFLOW_RUN_ID_PATTERN,
} from './workflowFrame';

export const WORKFLOW_RUN_CONTENT_KEY = 'io.mindroom.workflow_run';
export const WORKFLOW_QUESTION_CONTENT_KEY = 'io.mindroom.workflow_question';
export const WORKFLOW_ANSWER_EVENT_TYPE = 'io.mindroom.workflow_answer';
export const WORKFLOW_ANSWER_REJECTED_EVENT_TYPE = 'io.mindroom.workflow_answer_rejected';
export const WORKFLOW_CONTROL_EVENT_TYPE = 'io.mindroom.workflow_control';
export type WorkflowQuestionStatus = 'open' | 'answered' | 'cancelled';

const QUESTION_STATUSES: ReadonlySet<string> = new Set(['open', 'answered', 'cancelled']);

const readKey = (content: unknown, key: string): Record<string, unknown> | null => {
  if (!isRecord(content)) return null;
  const root = isRecord(content['m.new_content']) ? content['m.new_content'] : content;
  const inner = root[key];
  return isRecord(inner) ? inner : null;
};

/** Parses `io.mindroom.workflow_run` from a Matrix message content object, or returns null. */
export const parseWorkflowRunCard = (content: unknown) => {
  const raw = readKey(content, WORKFLOW_RUN_CONTENT_KEY);
  if (!raw || typeof raw.run !== 'string' || !WORKFLOW_RUN_ID_PATTERN.test(raw.run)) return null;
  const summary = parseRunSummary(raw, false);
  if (!summary) return null;
  const graph =
    raw.graph !== undefined ? (parseWorkflowRunGraph(raw.graph) ?? undefined) : undefined;
  return {
    ...summary,
    run: raw.run,
    jobId: optStr(raw.job_id) ?? null,
    requester: optStr(raw.requester) ?? null,
    phases: stringList(raw.phases),
    error: typeof raw.error === 'string' ? raw.error : null,
    ...(graph ? { graph } : {}),
  };
};
export type WorkflowRunCard = NonNullable<ReturnType<typeof parseWorkflowRunCard>>;

/** Parses `io.mindroom.workflow_question` from a Matrix message content object, or returns null. */
export const parseWorkflowRunQuestion = (content: unknown) => {
  const raw = readKey(content, WORKFLOW_QUESTION_CONTENT_KEY);
  if (!raw || typeof raw.run !== 'string' || !WORKFLOW_RUN_ID_PATTERN.test(raw.run)) return null;
  const node = optStr(raw.node);
  const questionId = optStr(raw.question_id);
  const { text, status } = raw;
  if (
    !node ||
    !questionId ||
    typeof text !== 'string' ||
    typeof status !== 'string' ||
    !QUESTION_STATUSES.has(status)
  )
    return null;
  const options = stringList(raw.options);
  return {
    run: raw.run,
    node,
    questionId,
    requester: optStr(raw.requester) ?? null,
    text,
    options,
    freeText: typeof raw.free_text === 'boolean' ? raw.free_text : options.length === 0,
    status: status as WorkflowQuestionStatus,
    answer: typeof raw.answer === 'string' ? raw.answer : null,
  };
};
export type WorkflowRunQuestion = NonNullable<ReturnType<typeof parseWorkflowRunQuestion>>;

const sendWorkflowEvent = async (
  mx: MatrixClient,
  room: Room,
  eventType: string,
  content: Record<string, unknown>
): Promise<string> => {
  const txnId = mx.makeTxnId();
  try {
    return (await mx.sendEvent(room.roomId, eventType as never, content as never, txnId)).event_id;
  } catch (error) {
    discardFailedLocalEcho(mx, room.getEventForTxnId(txnId));
    throw error;
  }
};

export const sendWorkflowRunAnswer = (
  mx: MatrixClient,
  room: Room,
  threadId: string | null,
  cardEventId: string,
  question: WorkflowRunQuestion,
  answer: { option: string } | { text: string }
): Promise<string> =>
  sendWorkflowEvent(mx, room, WORKFLOW_ANSWER_EVENT_TYPE, {
    run: question.run,
    node: question.node,
    ...answer,
    'm.relates_to': threadId
      ? { rel_type: 'm.thread', event_id: threadId, 'm.in_reply_to': { event_id: cardEventId } }
      : { 'm.in_reply_to': { event_id: cardEventId } },
  });

export const sendWorkflowRunResume = async (
  mx: MatrixClient,
  room: Room,
  threadId: string | null,
  run: string,
  options?: { maxCostUsd?: number }
): Promise<void> => {
  await sendWorkflowEvent(mx, room, WORKFLOW_CONTROL_EVENT_TYPE, {
    run,
    action: 'resume',
    ...(options?.maxCostUsd !== undefined ? { max_cost_usd: options.maxCostUsd } : {}),
    ...(threadId ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadId } } : {}),
  });
};

const replyId = (c: unknown): string | undefined => {
  const rel = isRecord(c) && isRecord(c['m.relates_to']) ? c['m.relates_to'] : null;
  return rel && isRecord(rel['m.in_reply_to']) ? optStr(rel['m.in_reply_to'].event_id) : undefined;
};

export type WorkflowAnswerRejection = { answerEventId: string; reason: string };

/** Parses `io.mindroom.workflow_answer_rejected` from a MindRoom agent, checking clear and wire relations. */
export const parseWorkflowAnswerRejection = (
  event: MatrixEvent,
  viewerUserId: string | null | undefined
): WorkflowAnswerRejection | null => {
  if (event.getType() !== WORKFLOW_ANSWER_REJECTED_EVENT_TYPE) return null;
  const sender = event.getSender();
  if (!sender || !isMindroomAgentUserIdForViewer(sender, viewerUserId ?? undefined)) return null;
  const content = event.getContent();
  const reason = isRecord(content) ? optStr(content.reason) : undefined;
  const answerEventId = reason ? (replyId(content) ?? replyId(event.getWireContent())) : undefined;
  return reason && answerEventId ? { answerEventId, reason } : null;
};
