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
import { hasLongTextMetadata } from '../matrix/protocol/longText';
import { sanitizeCustomHtml } from '../rich-text/sanitize';
import { MINDROOM_TOOL_REF_ICON, formatMarkdownTextBodyAsHtml } from './html/blocks';
import { getRenderedToolRefs } from './agent-run/toolRefDom';
import { isLiveMarkdownReady } from './live/liveMarkdown';
import type { LiveReplyEntry, LiveReplyStore } from './live/liveReplyStore';
import { getDrawnReplyContent } from './live/useLiveReplyContent';

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

type AttachmentSource = {
  /** The HTML the renderer parses for the reply's tool lines. */
  html: string;
  /** The call ID of each entry of the reply's trace. */
  callIds: (string | undefined)[];
};

/** What a reply's attachments come from, or nothing where it can draw none. */
const attachmentSource = (content: Record<string, unknown>): AttachmentSource | undefined => {
  const trace = getToolTraceV2Events(content[MINDROOM_TOOL_TRACE_KEY]);
  if (!trace || hasLongTextMetadata(content)) return undefined;
  const { formatted_body: formatted, body } = content;
  // As renderAgentMessageContent: a reply without HTML renders its Markdown body.
  const html =
    typeof formatted === 'string'
      ? formatted
      : typeof body === 'string'
      ? formatMarkdownTextBodyAsHtml(body)
      : undefined;
  if (!html?.includes(MINDROOM_TOOL_REF_ICON)) return undefined;
  return { html, callIds: trace.map(toolTraceCallId) };
};

const sameSource = (a: AttachmentSource | undefined, b: AttachmentSource | undefined) =>
  a === b ||
  (!!a &&
    !!b &&
    a.html === b.html &&
    a.callIds.length === b.callIds.length &&
    a.callIds.every((id, index) => id === b.callIds[index]));

const NO_ATTACHMENTS: ReadonlyMap<string, number> = new Map();

const indexAttachments = (source: AttachmentSource | undefined): ReadonlyMap<string, number> => {
  if (!source) return NO_ATTACHMENTS;
  const attachments = new Map<string, number>();
  getRenderedToolRefs(sanitizeCustomHtml(source.html)).toolBlocks.forEach(({ index }) => {
    const callId = source.callIds[index - 1];
    if (callId && !attachments.has(callId)) attachments.set(callId, index);
  });
  return attachments;
};

/**
 * Where a reply can draw a request: from each call ID of its trace to the index of that call's
 * marker, for the markers its body renders as tool lines (getRenderedToolRefs, the renderer's
 * rule, on the HTML the renderer parses). `content` is what the reply's row draws: a streaming
 * reply's live frames while they show (getDrawnReplyContent). None for a reply of long text,
 * whose row shows a preview or the sidecar instead.
 */
export const secretRequestAttachments = (
  content: Record<string, unknown>
): ReadonlyMap<string, number> => indexAttachments(attachmentSource(content));

const sameAttachments = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>) =>
  a === b || (a.size === b.size && [...a].every(([callId, index]) => b.get(callId) === index));

type PluginRenders = (event: MatrixEvent, content: Record<string, unknown>) => boolean;

type ReplyReading = {
  reply: MatrixEvent;
  content: Record<string, unknown>;
  pluginRenders: PluginRenders | undefined;
  entry: LiveReplyEntry | undefined;
  held: LiveReplyEntry | undefined;
  markdownReady: boolean;
  source: AttachmentSource | undefined;
  attachments: ReadonlyMap<string, number>;
};

/**
 * Reads replies' attachments from what their rows draw (getDrawnReplyContent), live frames
 * included, and keeps each reply's last reading. A reply is read again only when its durable
 * content, its live entry or the live Markdown renderer changed, and its body parsed again only
 * when the drawn HTML or the trace's call IDs did, so the frames that grow only the reasoning, the
 * activity or a call's output cost a few comparisons.
 */
export class SecretRequestAttachmentReader {
  private readonly readings = new Map<string, ReplyReading>();

  private version = 0;

  public constructor(private readonly store: LiveReplyStore) {}

  /** The reply's attachments as its row draws `content` now. */
  public read(
    reply: MatrixEvent,
    content: Record<string, unknown>,
    pluginRenders?: PluginRenders
  ): ReadonlyMap<string, number> {
    const replyId = reply.getId() ?? '';
    const roomId = reply.getRoomId();
    const entry = roomId ? this.store.get(roomId, replyId) : undefined;
    const held = roomId ? this.store.getHeld(roomId, replyId) : undefined;
    const markdownReady = isLiveMarkdownReady();
    const last = this.readings.get(replyId);
    if (
      last?.reply === reply &&
      last.content === content &&
      last.pluginRenders === pluginRenders &&
      last.entry === entry &&
      last.held === held &&
      last.markdownReady === markdownReady
    ) {
      return last.attachments;
    }
    const drawn = getDrawnReplyContent(this.store, reply, content);
    const source = pluginRenders?.(reply, drawn) ? undefined : attachmentSource(drawn);
    const attachments =
      last && sameSource(last.source, source) ? last.attachments : indexAttachments(source);
    this.readings.set(replyId, {
      reply,
      content,
      pluginRenders,
      entry,
      held,
      markdownReady,
      source,
      attachments,
    });
    return attachments;
  }

  /** Forgets the replies other than `replyIds`, the ones the last plan read. */
  public retain(replyIds: ReadonlySet<string>): void {
    [...this.readings.keys()].forEach((replyId) => {
      if (!replyIds.has(replyId)) this.readings.delete(replyId);
    });
  }

  /**
   * A number that grows when a reply read last draws other attachments than it did, after a frame
   * or the live Markdown renderer changed what its row draws: the plan's cue to plan again.
   */
  public getVersion = (): number => {
    let changed = false;
    this.readings.forEach((last) => {
      const before = last.attachments;
      if (!sameAttachments(before, this.read(last.reply, last.content, last.pluginRenders))) {
        changed = true;
      }
    });
    if (changed) this.version += 1;
    return this.version;
  };
}

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
 * named call's marker (secretRequestAttachments) as its row draws it now, a streaming reply's live
 * frames included (`reader`). Every other card keeps its row, as do the thread's root, an ignored
 * sender's card and one the route or a jump opened (`revealed`). Each reply is read once, however
 * many cards name it, as its row shows it (`getContent`); `reader` keeps the replies read.
 */
export const planInlineSecretRequests = ({
  cards,
  getEvent,
  getContent,
  ignored,
  revealed,
  pluginRenders,
  reader,
  threadId,
}: {
  cards: readonly MatrixEvent[];
  getEvent: (eventId: string) => MatrixEvent | undefined;
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  ignored: ReadonlySet<string>;
  revealed: ReadonlySet<string>;
  pluginRenders?: PluginRenders;
  reader: SecretRequestAttachmentReader;
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
      replyAttachments = reader.read(reply, getContent(reply), pluginRenders);
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
  reader.retain(new Set(attachments.keys()));
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
