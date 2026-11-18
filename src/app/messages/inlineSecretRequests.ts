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
import { ACTIVE_STREAM_STATUSES, getStreamStatusFromContent } from '../matrix/protocol/aiRun';
import { hasLongTextMetadata } from '../matrix/protocol/longText';
import { sanitizeCustomHtml } from '../rich-text/sanitize';
import { MINDROOM_TOOL_REF_ICON, formatMarkdownTextBodyAsHtml } from './html/blocks';
import { getRenderedToolRefs } from './agent-run/toolRefDom';

/** A done secret request drawn in the reply whose tool call asked, at that call's line. */
export type InlineSecretRequest = {
  /** The card's event, whose own row the timeline hides. */
  eventId: string;
  request: SecretRequest;
  /** The card's sender, the agent that asked. */
  agentUserId: string;
};

/** The requests each reply draws, by the reply's event ID, then by the marker index of the call. */
export type InlineSecretRequests = ReadonlyMap<string, ReadonlyMap<number, InlineSecretRequest>>;

export type InlineSecretRequestPlan = {
  /** Cards drawn in their reply, whose rows the timeline hides. */
  hiddenEventIds: ReadonlySet<string>;
  byReply: InlineSecretRequests;
  /** Replies with a request not done yet (its card a row of its own): their work stays unfolded. */
  waitingReplyIds: ReadonlySet<string>;
};

export const NO_INLINE_SECRET_REQUESTS: InlineSecretRequestPlan = {
  hiddenEventIds: new Set(),
  byReply: new Map(),
  waitingReplyIds: new Set(),
};

/**
 * Where a reply can draw a request: from each call ID of its trace to the index of that call's
 * marker, for the markers its body renders as tool lines (getRenderedToolRefs, the renderer's
 * rule, on the HTML the renderer parses). None where the reply may show other content than this:
 * a reply of long text, and one still streaming, which live frames draw over.
 */
export const secretRequestAttachments = (
  content: Record<string, unknown>
): ReadonlyMap<string, number> => {
  const attachments = new Map<string, number>();
  const trace = getToolTraceV2Events(content[MINDROOM_TOOL_TRACE_KEY]);
  if (!trace || hasLongTextMetadata(content)) return attachments;
  if (ACTIVE_STREAM_STATUSES.has(getStreamStatusFromContent(content) ?? '')) return attachments;
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
 * Which secret request cards a thread's replies draw instead of their rows. Only a request the
 * agent's edit marked done moves: one still open keeps its row, the form in it, right under the
 * reply its call blocks. A done card moves when it names a reply loaded in the thread from the
 * card's agent, which the app renders itself (`pluginRenders` false) and whose body renders the
 * named call's marker (secretRequestAttachments). Every other card keeps its row, as do the
 * thread's root, an ignored sender's card and one the route or a jump opened (`revealed`). Each
 * reply is read once, however many cards name it, as its row shows it (`getContent`).
 */
export const planInlineSecretRequests = ({
  cards,
  getEvent,
  getContent,
  ignored,
  revealed,
  pluginRenders,
  threadId,
}: {
  cards: readonly MatrixEvent[];
  getEvent: (eventId: string) => MatrixEvent | undefined;
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  ignored: ReadonlySet<string>;
  revealed: ReadonlySet<string>;
  pluginRenders?: (event: MatrixEvent, content: Record<string, unknown>) => boolean;
  threadId?: string;
}): InlineSecretRequestPlan => {
  const hiddenEventIds = new Set<string>();
  const waitingReplyIds = new Set<string>();
  const byReply = new Map<string, Map<number, InlineSecretRequest>>();
  const attachments = new Map<string, ReadonlyMap<string, number>>();
  cards.forEach((card) => {
    const eventId = card.getId();
    const agentUserId = card.getSender();
    if (!eventId || !agentUserId || card.isRedacted() || ignored.has(agentUserId)) return;
    const request = parseSecretRequestContent(getContent(card));
    const anchor = request?.anchor;
    if (!request || !anchor || eventId === threadId) return;
    const replyId = anchor.responseEventId;
    const reply = getEvent(replyId);
    if (!reply || reply === card || reply.isRedacted() || reply.getSender() !== agentUserId) return;
    if (request.status === 'pending') {
      waitingReplyIds.add(replyId);
      return;
    }
    if (revealed.has(eventId)) return;
    let replyAttachments = attachments.get(replyId);
    if (!replyAttachments) {
      const content = getContent(reply);
      replyAttachments = pluginRenders?.(reply, content)
        ? new Map()
        : secretRequestAttachments(content);
      attachments.set(replyId, replyAttachments);
    }
    const index = replyAttachments.get(anchor.toolCallId);
    if (index === undefined) return;
    const calls = byReply.get(replyId) ?? new Map<number, InlineSecretRequest>();
    // One request per call; another card naming the same call keeps its row.
    if (calls.has(index)) return;
    calls.set(index, { eventId, request, agentUserId });
    byReply.set(replyId, calls);
    hiddenEventIds.add(eventId);
  });
  return { hiddenEventIds, byReply, waitingReplyIds };
};

/** Plain data the same, as parsed requests are: objects, arrays and primitives. */
const sameData = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) =>
      sameData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    )
  );
};

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

/** Whether two plans draw the same: the timeline keeps the older, so its replies do not redraw. */
export const sameInlineSecretRequestPlan = (
  a: InlineSecretRequestPlan,
  b: InlineSecretRequestPlan
): boolean =>
  sameSet(a.hiddenEventIds, b.hiddenEventIds) &&
  sameSet(a.waitingReplyIds, b.waitingReplyIds) &&
  a.byReply.size === b.byReply.size &&
  [...a.byReply].every(([replyId, calls]) => {
    const others = b.byReply.get(replyId);
    return (
      others?.size === calls.size &&
      [...calls].every(([index, drawn]) => {
        const other = others.get(index);
        return other?.eventId === drawn.eventId && sameData(other.request, drawn.request);
      })
    );
  });

/** The timeline's inline secret requests (planInlineSecretRequests), for its replies to draw. */
export const InlineSecretRequestsContext =
  createContext<InlineSecretRequestPlan>(NO_INLINE_SECRET_REQUESTS);

const NO_CALLS: ReadonlyMap<number, InlineSecretRequest> = new Map();

/** The requests a reply draws, by marker index; none outside a timeline that plans them. */
export const useInlineSecretRequests = (
  replyEventId: string | undefined
): ReadonlyMap<number, InlineSecretRequest> => {
  const { byReply } = useContext(InlineSecretRequestsContext);
  return (replyEventId && byReply.get(replyEventId)) || NO_CALLS;
};

/** Whether a request of the reply's tool calls is not done yet, its card a row under the reply. */
export const useSecretRequestWaiting = (replyEventId: string | undefined): boolean => {
  const { waitingReplyIds } = useContext(InlineSecretRequestsContext);
  return !!replyEventId && waitingReplyIds.has(replyEventId);
};
