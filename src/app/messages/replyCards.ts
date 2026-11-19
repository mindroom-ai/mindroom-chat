import type { MatrixEvent } from 'matrix-js-sdk';
import { useRef } from 'react';
import { CHAT_UI_ACTION_KEY } from '../matrix/protocol/chatUiProtocol';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
import {
  isPendingScheduledTaskStatus,
  parseScheduledTaskStateEvent,
  type ParsedScheduledTask,
} from '../matrix/protocol/scheduledTaskContract';

export type ReplyCard = { canvas: MatrixEvent } | { reminder: ParsedScheduledTask };

/** What a thread's agent replies left behind, as cards under each reply; the notices' rows hide. */
export type ReplyCardPlan = {
  hiddenEventIds: ReadonlySet<string>;
  byReply: ReadonlyMap<string, readonly ReplyCard[]>;
};

export const NO_REPLY_CARDS: ReplyCardPlan = { hiddenEventIds: new Set(), byReply: new Map() };

/**
 * A canvas notice (not an inline canvas, whose page is the notice) goes under the reply of its
 * agent that answers the same message; a pending task under the agent reply answering its
 * `sourceEventId`. Of several (a retry), the latest. Anything else keeps today's rendering: events
 * from before the link, a reply not loaded here, a notice the route or a jump opened (`revealed`).
 */
export const planReplyCards = ({
  events,
  taskEvents,
  viewerId,
  revealed,
}: {
  events: readonly MatrixEvent[];
  taskEvents: readonly MatrixEvent[];
  viewerId: string | undefined;
  revealed: ReadonlySet<string>;
}): ReplyCardPlan => {
  // Replies by their agent and the message they answer, and by that message alone.
  const replies = new Map<string, string>();
  const notices: [MatrixEvent, string][] = [];
  events.forEach((event) => {
    const id = event.getId();
    const key = `${event.getSender()} ${event.replyEventId}`;
    // A thread's fallback reply names the latest message, not one it answers.
    const fallback = event.getWireContent()['m.relates_to']?.is_falling_back === true;
    const agent = isMindroomAgentUserIdForViewer(event.getSender(), viewerId);
    if (!id || !event.replyEventId || fallback || !agent || event.isRedacted()) return;
    const content = event.getOriginalContent();
    const action = content[CHAT_UI_ACTION_KEY] as Record<string, unknown> | undefined;
    if (action?.action === 'show_canvas' && action.inline !== true) {
      if (!revealed.has(id)) notices.push([event, key]);
    } else if (!action && content.msgtype === 'm.text') {
      replies.set(key, id).set(event.replyEventId, id);
    }
  });
  const hiddenEventIds = new Set<string>();
  const byReply = new Map<string, ReplyCard[]>();
  const add = (replyId: string | undefined, card: ReplyCard) =>
    replyId && byReply.set(replyId, [...(byReply.get(replyId) ?? []), card]);
  notices.forEach(([canvas, key]) => {
    if (add(replies.get(key), { canvas })) hiddenEventIds.add(canvas.getId()!);
  });
  taskEvents.map(parseScheduledTaskStateEvent).forEach((reminder) => {
    if (!reminder?.sourceEventId || !isPendingScheduledTaskStatus(reminder.status)) return;
    add(replies.get(reminder.sourceEventId), { reminder });
  });
  return byReply.size === 0 ? NO_REPLY_CARDS : { hiddenEventIds, byReply };
};

const cardKey = (card: ReplyCard) => ('canvas' in card ? card.canvas.getId() : card.reminder);

/** `planReplyCards` on each render; one that draws the same is the last, so rows do not redraw. */
export const useReplyCardPlan = (input: Parameters<typeof planReplyCards>[0]): ReplyCardPlan => {
  const last = useRef({ plan: NO_REPLY_CARDS, key: '' });
  const plan = planReplyCards(input);
  const key = JSON.stringify([...plan.byReply].map(([id, cards]) => [id, cards.map(cardKey)]));
  if (key !== last.current.key) last.current = { plan, key };
  return last.current.plan;
};
