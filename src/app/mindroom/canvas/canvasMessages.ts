import { MsgType } from 'matrix-js-sdk';
import { sanitizeText } from '../../utils/sanitize';
import { getMessageRelation } from '../threads/composeMessageRelation';
import { CANVAS_SUBMIT_MESSAGE } from './canvasDocument';

export const CANVAS_RESPONSE_KEY = 'io.mindroom.canvas_response';

const MAX_DATA_BYTES = 8 * 1024;
const MAX_LABEL_LENGTH = 200;

export type CanvasSubmission = {
  data: unknown;
  label?: string;
};

export type CanvasTarget = {
  eventId: string;
  /** The edit (or the original request) whose document the user answered. */
  revisionEventId: string;
  agentUserId: string;
  agentName: string;
  threadId?: string;
};

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const serialize = (data: unknown): string | undefined => {
  try {
    const json = JSON.stringify(data);
    return typeof json === 'string' ? json : undefined;
  } catch {
    return undefined;
  }
};

/** Accept only the bridge message shape, from this canvas frame, within the payload budget. */
export const readCanvasSubmission = (
  event: MessageEvent,
  frame: Window | null | undefined
): CanvasSubmission | undefined => {
  if (!frame || event.source !== frame || event.origin !== 'null') return undefined;
  const message = event.data;
  if (!record(message) || message.type !== CANVAS_SUBMIT_MESSAGE || message.version !== 1) {
    return undefined;
  }
  if (message.label !== undefined && typeof message.label !== 'string') return undefined;
  const json = serialize(message.data);
  if (json === undefined || new TextEncoder().encode(json).length > MAX_DATA_BYTES) {
    return undefined;
  }
  const label = message.label?.trim().slice(0, MAX_LABEL_LENGTH);
  return { data: JSON.parse(json), ...(label ? { label } : {}) };
};

const responseSummary = (canvasEventId: string, revisionEventId: string, label: string) =>
  `Canvas response (${canvasEventId}, revision ${revisionEventId}): ${label}`;

const canonicalBody = (
  agentUserId: string,
  canvasEventId: string,
  revisionEventId: string,
  label: string,
  json: string
) => `${agentUserId} ${responseSummary(canvasEventId, revisionEventId, label)}\n${json}`;

/** A commit is an ordinary mention so the agent's existing turn pipeline receives it. */
export const buildCanvasResponseContent = (canvas: CanvasTarget, submission: CanvasSubmission) => {
  const label = submission.label ?? 'Submitted';
  const json = serialize(submission.data) ?? 'null';
  const summary = responseSummary(canvas.eventId, canvas.revisionEventId, label);
  const relation = getMessageRelation(canvas.eventId, undefined, canvas.threadId);
  return {
    msgtype: MsgType.Text,
    body: canonicalBody(canvas.agentUserId, canvas.eventId, canvas.revisionEventId, label, json),
    format: 'org.matrix.custom.html',
    formatted_body: `<a href="https://matrix.to/#/${encodeURIComponent(
      canvas.agentUserId
    )}">${sanitizeText(canvas.agentName)}</a> ${sanitizeText(summary)}<pre><code>${sanitizeText(
      json
    )}</code></pre>`,
    'm.mentions': { user_ids: [canvas.agentUserId] },
    ...(relation ? { 'm.relates_to': relation } : {}),
    [CANVAS_RESPONSE_KEY]: {
      version: 1,
      canvas_event_id: canvas.eventId,
      canvas_revision_event_id: canvas.revisionEventId,
      agent_user_id: canvas.agentUserId,
      ...(submission.label ? { label: submission.label } : {}),
      data: submission.data,
    },
  };
};

export type CanvasResponseReceipt = {
  canvasEventId: string;
  label: string;
  json: string;
};

/**
 * Chat shows a commit as a receipt; other clients and the agent read its body.
 * Only a body that says exactly what the metadata says may be replaced by the receipt.
 */
export const readCanvasResponse = (
  content: Record<string, unknown>
): CanvasResponseReceipt | undefined => {
  const response = content[CANVAS_RESPONSE_KEY];
  if (
    content.msgtype !== MsgType.Text ||
    typeof content.body !== 'string' ||
    !record(response) ||
    response.version !== 1 ||
    typeof response.canvas_event_id !== 'string' ||
    !response.canvas_event_id.startsWith('$') ||
    typeof response.agent_user_id !== 'string' ||
    typeof response.canvas_revision_event_id !== 'string' ||
    (response.label !== undefined && typeof response.label !== 'string')
  ) {
    return undefined;
  }
  const label = typeof response.label === 'string' ? response.label : 'Submitted';
  const json = serialize(response.data);
  if (
    json === undefined ||
    content.body !==
      canonicalBody(
        response.agent_user_id,
        response.canvas_event_id,
        response.canvas_revision_event_id,
        label,
        json
      )
  ) {
    return undefined;
  }
  return { canvasEventId: response.canvas_event_id, label, json };
};
