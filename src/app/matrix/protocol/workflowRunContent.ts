import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from './agentIdentity';
import { discardFailedLocalEcho } from './pendingLocalEcho';
import {
  parseWorkflowRunCounts,
  parseWorkflowRunGraph,
  parseWorkflowRunUsage,
  WORKFLOW_RUN_ID_PATTERN,
  type WorkflowRunCounts,
  type WorkflowRunGraph,
  type WorkflowRunStatus,
  type WorkflowRunUsage,
} from './workflowFrame';

export const WORKFLOW_RUN_CONTENT_KEY = 'io.mindroom.workflow_run';
export const WORKFLOW_QUESTION_CONTENT_KEY = 'io.mindroom.workflow_question';
export const WORKFLOW_ANSWER_EVENT_TYPE = 'io.mindroom.workflow_answer';
export const WORKFLOW_ANSWER_REJECTED_EVENT_TYPE = 'io.mindroom.workflow_answer_rejected';
export const WORKFLOW_CONTROL_EVENT_TYPE = 'io.mindroom.workflow_control';

const RUN_STATUSES: ReadonlySet<string> = new Set<WorkflowRunStatus>([
  'starting',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

const QUESTION_STATUSES = ['open', 'answered', 'cancelled'] as const;
export type WorkflowQuestionStatus = (typeof QUESTION_STATUSES)[number];

export type WorkflowRunCard = {
  run: string;
  jobId: string | null;
  requester: string | null;
  title: string | null;
  name?: string | null;
  status: WorkflowRunStatus;
  counts: WorkflowRunCounts;
  usage: WorkflowRunUsage;
  phases: string[];
  attempt: number;
  startedAt: number | null;
  endedAt: number | null;
  error: string | null;
  large: boolean;
  graph?: WorkflowRunGraph;
};

export type WorkflowRunQuestion = {
  run: string;
  node: string;
  questionId: string;
  requester: string | null;
  text: string;
  options: string[];
  freeText: boolean;
  status: WorkflowQuestionStatus;
  answer: string | null;
};

export type WorkflowAnswerRejection = {
  answerEventId: string;
  reason: string;
  run?: string;
  node?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isNullableFinite = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

const unwrapContent = (content: unknown): Record<string, unknown> | null => {
  if (!isRecord(content)) return null;
  const edited = content['m.new_content'];
  return isRecord(edited) ? edited : content;
};

/** Reads `io.mindroom.workflow_run` from a Matrix message content (or its edited replacement). */
export const parseWorkflowRunCard = (content: unknown): WorkflowRunCard | null => {
  const source = unwrapContent(content);
  const raw = source?.[WORKFLOW_RUN_CONTENT_KEY];
  if (!isRecord(raw)) return null;
  const {
    run,
    job_id: jobId = null,
    requester = null,
    title = null,
    name,
    status,
    phases,
    attempt,
    started_at: startedAt = null,
    ended_at: endedAt = null,
    error = null,
    large = false,
  } = raw;
  const counts = parseWorkflowRunCounts(raw.counts);
  const usage = parseWorkflowRunUsage(raw.usage);
  if (
    typeof run !== 'string' ||
    !WORKFLOW_RUN_ID_PATTERN.test(run) ||
    !isNullableString(jobId) ||
    !isNullableString(requester) ||
    !isNullableString(title) ||
    typeof status !== 'string' ||
    !RUN_STATUSES.has(status) ||
    typeof attempt !== 'number' ||
    !Number.isSafeInteger(attempt) ||
    attempt < 0 ||
    !isNullableFinite(startedAt) ||
    !isNullableFinite(endedAt) ||
    !isNullableString(error) ||
    typeof large !== 'boolean' ||
    !counts ||
    !usage
  ) {
    return null;
  }
  const graph = raw.graph === undefined || raw.graph === null ? undefined : parseWorkflowRunGraph(raw.graph);
  return {
    run,
    jobId,
    requester,
    title,
    ...(typeof name === 'string' && name.length > 0 ? { name } : {}),
    status: status as WorkflowRunStatus,
    counts,
    usage,
    phases: Array.isArray(phases)
      ? phases.filter((phase): phase is string => typeof phase === 'string')
      : [],
    attempt,
    startedAt,
    endedAt,
    error,
    large,
    ...(graph ? { graph } : {}),
  };
};

/** Reads `io.mindroom.workflow_question` from a Matrix message content (or its edited replacement). */
export const parseWorkflowRunQuestion = (content: unknown): WorkflowRunQuestion | null => {
  const source = unwrapContent(content);
  const raw = source?.[WORKFLOW_QUESTION_CONTENT_KEY];
  if (!isRecord(raw)) return null;
  const {
    run,
    node,
    question_id: questionId,
    requester = null,
    text,
    options: rawOptions,
    free_text: rawFreeText,
    status,
    answer = null,
  } = raw;
  if (
    typeof run !== 'string' ||
    !WORKFLOW_RUN_ID_PATTERN.test(run) ||
    typeof node !== 'string' ||
    node.length === 0 ||
    typeof questionId !== 'string' ||
    questionId.length === 0 ||
    !isNullableString(requester) ||
    typeof text !== 'string' ||
    typeof status !== 'string' ||
    !(QUESTION_STATUSES as readonly string[]).includes(status) ||
    !isNullableString(answer)
  ) {
    return null;
  }
  const options = Array.isArray(rawOptions)
    ? rawOptions.filter((option): option is string => typeof option === 'string')
    : [];
  const freeText = typeof rawFreeText === 'boolean' ? rawFreeText : options.length === 0;
  return {
    run,
    node,
    questionId,
    requester,
    text,
    options,
    freeText,
    status: status as WorkflowQuestionStatus,
    answer,
  };
};

/**
 * Sends a viewer's answer to a workflow question card, related to the card in its thread,
 * discarding any failed local echo, and resolving to the sent answer event's ID.
 */
export const sendWorkflowRunAnswer = async (
  mx: MatrixClient,
  room: Room,
  threadId: string | null,
  cardEventId: string,
  question: Pick<WorkflowRunQuestion, 'run' | 'node'>,
  answer: { option: string } | { text: string }
): Promise<string> => {
  const relatesTo: Record<string, unknown> = threadId
    ? {
        rel_type: 'm.thread',
        event_id: threadId,
        'm.in_reply_to': { event_id: cardEventId },
      }
    : { 'm.in_reply_to': { event_id: cardEventId } };
  const content: Record<string, unknown> = {
    run: question.run,
    node: question.node,
    ...answer,
    'm.relates_to': relatesTo,
  };
  const txnId = mx.makeTxnId();
  try {
    const response = await mx.sendEvent(
      room.roomId,
      WORKFLOW_ANSWER_EVENT_TYPE as never,
      content as never,
      txnId
    );
    return response.event_id;
  } catch (error) {
    discardFailedLocalEcho(mx, room.getEventForTxnId(txnId));
    throw error;
  }
};

/**
 * Sends an `io.mindroom.workflow_control` resume event in the run's thread, optionally raising
 * `max_cost_usd` (a bare resume raises by one more allowance on the backend).
 */
export const sendWorkflowRunResume = async (
  mx: MatrixClient,
  room: Room,
  threadId: string | null,
  run: string,
  options?: { maxCostUsd?: number }
): Promise<void> => {
  const content: Record<string, unknown> = {
    run,
    action: 'resume',
    ...(options?.maxCostUsd !== undefined ? { max_cost_usd: options.maxCostUsd } : {}),
  };
  if (threadId) content['m.relates_to'] = { rel_type: 'm.thread', event_id: threadId };
  const txnId = mx.makeTxnId();
  try {
    await mx.sendEvent(
      room.roomId,
      WORKFLOW_CONTROL_EVENT_TYPE as never,
      content as never,
      txnId
    );
  } catch (error) {
    discardFailedLocalEcho(mx, room.getEventForTxnId(txnId));
    throw error;
  }
};

/**
 * Reads an `io.mindroom.workflow_answer_rejected` event when sent by a MindRoom agent on the
 * viewer's homeserver; returns null for any other sender or malformed payload.
 */
export const parseWorkflowAnswerRejection = (
  event: MatrixEvent,
  viewerUserId?: string | null
): WorkflowAnswerRejection | null => {
  if (event.getType() !== WORKFLOW_ANSWER_REJECTED_EVENT_TYPE) return null;
  const sender = event.getSender();
  if (!isMindroomAgentUserIdForViewer(sender, viewerUserId ?? undefined)) return null;
  const content = event.getContent();
  if (!isRecord(content)) return null;
  const { reason, run, node } = content;
  const relatesTo = content['m.relates_to'];
  const inReplyTo = isRecord(relatesTo) ? relatesTo['m.in_reply_to'] : undefined;
  const answerEventId = isRecord(inReplyTo) ? inReplyTo.event_id : undefined;
  if (typeof answerEventId !== 'string' || answerEventId.length === 0 || typeof reason !== 'string') {
    return null;
  }
  return {
    answerEventId,
    reason,
    ...(typeof run === 'string' ? { run } : {}),
    ...(typeof node === 'string' ? { node } : {}),
  };
};
