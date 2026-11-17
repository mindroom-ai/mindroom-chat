import { createContext, useContext } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import {
  MINDROOM_SECRET_REQUEST_KEY,
  parseSecretRequestContent,
  type SecretRequest,
} from '../matrix/protocol/secretRequest';
import {
  MINDROOM_TOOL_TRACE_KEY,
  getToolTraceV2Events,
  toolTraceCallId,
} from '../matrix/protocol/toolTrace';

/** A secret request drawn in the reply whose tool call asked, at that call's line. */
export type InlineSecretRequest = {
  /** The card's event, whose own row the timeline hides. */
  eventId: string;
  request: SecretRequest;
  /** The card's sender, the agent whose server takes the answer. */
  agentUserId: string;
};

/** The requests each reply draws, by the reply's event ID, then by tool call ID. */
export type InlineSecretRequests = ReadonlyMap<string, ReadonlyMap<string, InlineSecretRequest>>;

export type InlineSecretRequestPlan = {
  /** Cards drawn in their reply, whose rows the timeline hides. */
  hiddenEventIds: ReadonlySet<string>;
  byReply: InlineSecretRequests;
};

// The tool marker a reply's body shows for each call of its trace (messages/html/blocks.ts).
const TOOL_MARKER = '🔧';

const hasToolMarker = (content: Record<string, unknown>): boolean =>
  [content.formatted_body, content.body].some(
    (value) => typeof value === 'string' && value.includes(TOOL_MARKER)
  );

/**
 * Which secret request cards of a timeline its replies draw instead. A card counts when a MindRoom
 * agent sent it, it names a reply loaded in the same timeline from the same agent, and that
 * reply's trace has the named tool call and its body shows tool markers. Every other card keeps its
 * own row, as do the thread's root, an ignored sender's card, and one the route or a jump opened
 * (`revealed`). Contents are read as their rows show them, latest edit included (`getContent`).
 */
export const planInlineSecretRequests = ({
  events,
  getContent,
  isAgent,
  ignored,
  revealed,
  threadId,
}: {
  events: readonly MatrixEvent[];
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  isAgent: (userId: string | undefined) => boolean;
  ignored: ReadonlySet<string>;
  revealed: ReadonlySet<string>;
  threadId?: string;
}): InlineSecretRequestPlan => {
  const hiddenEventIds = new Set<string>();
  const byReply = new Map<string, Map<string, InlineSecretRequest>>();
  const shown = events.filter(
    (event) => !event.isRedacted() && !ignored.has(event.getSender() ?? '')
  );
  const loaded = new Map(shown.map((event) => [event.getId(), event]));
  shown.forEach((card) => {
    const eventId = card.getId();
    const agentUserId = card.getSender();
    if (!eventId || !agentUserId || eventId === threadId || revealed.has(eventId)) return;
    // A card's first content has the key too, so only those rows are read in full.
    if (!(MINDROOM_SECRET_REQUEST_KEY in card.getOriginalContent()) || !isAgent(agentUserId)) {
      return;
    }
    const request = parseSecretRequestContent(getContent(card));
    const anchor = request?.anchor;
    if (!request || !anchor) return;
    const reply = loaded.get(anchor.responseEventId);
    if (!reply || reply === card || reply.getSender() !== agentUserId) return;
    const replyContent = getContent(reply);
    const trace = getToolTraceV2Events(replyContent[MINDROOM_TOOL_TRACE_KEY]);
    if (!hasToolMarker(replyContent)) return;
    if (!trace?.some((event) => toolTraceCallId(event) === anchor.toolCallId)) return;
    const calls = byReply.get(anchor.responseEventId) ?? new Map<string, InlineSecretRequest>();
    // One request per call; another card naming the same call keeps its row.
    if (calls.has(anchor.toolCallId)) return;
    calls.set(anchor.toolCallId, { eventId, request, agentUserId });
    byReply.set(anchor.responseEventId, calls);
    hiddenEventIds.add(eventId);
  });
  return { hiddenEventIds, byReply };
};

const NO_REQUESTS: InlineSecretRequests = new Map();

/** The timeline's inline secret requests (planInlineSecretRequests), for its replies to draw. */
export const InlineSecretRequestsContext = createContext<InlineSecretRequests>(NO_REQUESTS);

const NO_CALLS: ReadonlyMap<string, InlineSecretRequest> = new Map();

/** The requests a reply draws, by tool call ID; none outside a timeline that plans them. */
export const useInlineSecretRequests = (
  replyEventId: string | undefined
): ReadonlyMap<string, InlineSecretRequest> => {
  const requests = useContext(InlineSecretRequestsContext);
  return (replyEventId && requests.get(replyEventId)) || NO_CALLS;
};
