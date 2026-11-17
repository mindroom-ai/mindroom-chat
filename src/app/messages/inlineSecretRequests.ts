import { createContext, useContext } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import {
  MINDROOM_SECRET_REQUEST_KEY,
  effectiveSecretRequestStatus,
  parseSecretRequestContent,
  type SecretRequest,
} from '../matrix/protocol/secretRequest';
import {
  MINDROOM_TOOL_TRACE_KEY,
  getToolTraceV2Events,
  toolTraceCallId,
} from '../matrix/protocol/toolTrace';
import { hasLongTextMetadata } from '../matrix/protocol/longText';
import { sanitizeCustomHtml } from '../rich-text/sanitize';
import { MINDROOM_TOOL_REF_ICON, formatMarkdownTextBodyAsHtml } from './html/blocks';
import { getRenderedToolRefs } from './agent-run/toolRefDom';

/** A secret request drawn in the reply whose tool call asked, at that call's line. */
export type InlineSecretRequest = {
  /** The card's event, whose own row the timeline hides. */
  eventId: string;
  request: SecretRequest;
  /** The card's sender, the agent whose server takes the answer. */
  agentUserId: string;
};

/** The requests each reply draws, by the reply's event ID, then by the marker index of the call. */
export type InlineSecretRequests = ReadonlyMap<string, ReadonlyMap<number, InlineSecretRequest>>;

export type InlineSecretRequestPlan = {
  /** Cards drawn in their reply, whose rows the timeline hides. */
  hiddenEventIds: ReadonlySet<string>;
  byReply: InlineSecretRequests;
};

/**
 * Where a reply can draw a request: from each call ID of its trace to the index of that call's
 * marker, for the markers its body renders as tool lines (getRenderedToolRefs, the renderer's
 * rule, on the HTML the renderer parses). A reply of long text renders other content than its
 * row's, so it draws none.
 */
export const secretRequestAttachments = (
  content: Record<string, unknown>
): ReadonlyMap<string, number> => {
  const attachments = new Map<string, number>();
  const trace = getToolTraceV2Events(content[MINDROOM_TOOL_TRACE_KEY]);
  if (!trace || hasLongTextMetadata(content)) return attachments;
  const { formatted_body: formatted, body } = content;
  // As renderAgentMessageContent: a reply without HTML renders its Markdown body.
  const html =
    typeof formatted === 'string'
      ? formatted
      : typeof body === 'string'
      ? formatMarkdownTextBodyAsHtml(body)
      : undefined;
  if (!html?.includes(MINDROOM_TOOL_REF_ICON)) return attachments;
  getRenderedToolRefs(sanitizeCustomHtml(html)).toolBlocks.forEach(({ index }) => {
    const callId = toolTraceCallId(trace[index - 1]);
    if (callId && !attachments.has(callId)) attachments.set(callId, index);
  });
  return attachments;
};

/** The agent cards among `events` that carry a request, the ones a plan reads. */
export const secretRequestCards = (
  events: readonly MatrixEvent[],
  isAgent: (userId: string | undefined) => boolean
): MatrixEvent[] =>
  events.filter(
    (event) =>
      // A card's first content has the key too.
      MINDROOM_SECRET_REQUEST_KEY in event.getOriginalContent() && isAgent(event.getSender())
  );

/**
 * Which secret request cards a thread's replies draw instead of their rows. A card counts when it
 * names a reply loaded in the thread from the card's agent, and that reply renders the marker of
 * the named call (secretRequestAttachments). Every other card keeps its row, as do the thread's
 * root, an ignored sender's card, one the route or a jump opened (`revealed`), and a pending one
 * in `rows`, which already showed as a row: moving it would lose what was typed in its field.
 * Each reply is read once, however many cards name it. Contents are read as their rows show them,
 * latest edit included (`getContent`).
 */
export const planInlineSecretRequests = ({
  cards,
  getEvent,
  getContent,
  ignored,
  revealed,
  rows,
  threadId,
  now = Date.now(),
}: {
  cards: readonly MatrixEvent[];
  getEvent: (eventId: string) => MatrixEvent | undefined;
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  ignored: ReadonlySet<string>;
  revealed: ReadonlySet<string>;
  rows: ReadonlySet<string>;
  threadId?: string;
  now?: number;
}): InlineSecretRequestPlan & { pending: ReadonlySet<string> } => {
  const hiddenEventIds = new Set<string>();
  const pending = new Set<string>();
  const byReply = new Map<string, Map<number, InlineSecretRequest>>();
  const attachments = new Map<string, ReadonlyMap<string, number>>();
  cards.forEach((card) => {
    const eventId = card.getId();
    const agentUserId = card.getSender();
    if (!eventId || !agentUserId || card.isRedacted() || ignored.has(agentUserId)) return;
    const request = parseSecretRequestContent(getContent(card));
    if (!request) return;
    const waiting = effectiveSecretRequestStatus(request, now) === 'pending';
    if (waiting) pending.add(eventId);
    const anchor = request.anchor;
    if (!anchor || eventId === threadId || revealed.has(eventId)) return;
    if (waiting && rows.has(eventId)) return;
    const reply = getEvent(anchor.responseEventId);
    if (!reply || reply === card || reply.isRedacted() || reply.getSender() !== agentUserId) return;
    let replyAttachments = attachments.get(anchor.responseEventId);
    if (!replyAttachments) {
      replyAttachments = secretRequestAttachments(getContent(reply));
      attachments.set(anchor.responseEventId, replyAttachments);
    }
    const index = replyAttachments.get(anchor.toolCallId);
    if (index === undefined) return;
    const calls = byReply.get(anchor.responseEventId) ?? new Map<number, InlineSecretRequest>();
    // One request per call; another card naming the same call keeps its row.
    if (calls.has(index)) return;
    calls.set(index, { eventId, request, agentUserId });
    byReply.set(anchor.responseEventId, calls);
    hiddenEventIds.add(eventId);
  });
  return { hiddenEventIds, byReply, pending };
};

const NO_REQUESTS: InlineSecretRequests = new Map();

/** The timeline's inline secret requests (planInlineSecretRequests), for its replies to draw. */
export const InlineSecretRequestsContext = createContext<InlineSecretRequests>(NO_REQUESTS);

const NO_CALLS: ReadonlyMap<number, InlineSecretRequest> = new Map();

/** The requests a reply draws, by marker index; none outside a timeline that plans them. */
export const useInlineSecretRequests = (
  replyEventId: string | undefined
): ReadonlyMap<number, InlineSecretRequest> => {
  const requests = useContext(InlineSecretRequestsContext);
  return (replyEventId && requests.get(replyEventId)) || NO_CALLS;
};
