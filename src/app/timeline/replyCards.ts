import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { useContext, useMemo, useRef } from 'react';
import { CHAT_UI_ACTION_KEY, type ChatUiAction } from '../matrix/protocol/chatUiProtocol';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';
import type { ReplyCard } from '../messages/content/ReplyCards';
import { genuineReplyEventId } from './timelineRowFold';
import { useScheduledTaskEvents } from '../schedules/useScheduledTaskEvents';
import { getPendingRoomSchedules } from '../schedules/roomSchedules';
import { ChatUiActionContext } from '../ui-actions/ChatUiActionProvider';
import { useOptionalClientConfig } from '../config/useClientConfig';

/** What a thread's agent replies left behind, as cards under each reply; the notices' rows hide. */
export type ReplyCardPlan = {
  hiddenEventIds: ReadonlySet<string>;
  byReply: ReadonlyMap<string, readonly ReplyCard[]>;
};

export const NO_REPLY_CARDS: ReplyCardPlan = { hiddenEventIds: new Set(), byReply: new Map() };

/**
 * In the open thread, a canvas notice (not an inline canvas, whose page is the notice) that this
 * viewer may open (`readCanvas`, none with canvases off) goes under the shown reply of its agent
 * answering the same message; a pending task of this thread under the agent reply answering its
 * `sourceEventId`. Of several (a retry), the latest. Anything else keeps today's rendering: events
 * from before the link, a reply not loaded or hidden here, a notice the route or a jump opened.
 */
export const planReplyCards = ({
  threadId,
  events,
  tasks,
  viewerId,
  readCanvas,
  isHidden,
  revealed,
}: {
  threadId: string | undefined;
  events: readonly MatrixEvent[];
  tasks: readonly ParsedScheduledTask[];
  viewerId: string | undefined;
  readCanvas: ((event: MatrixEvent) => ChatUiAction | undefined) | undefined;
  isHidden: (event: MatrixEvent) => boolean;
  revealed: ReadonlySet<string>;
}): ReplyCardPlan => {
  if (!threadId) return NO_REPLY_CARDS;
  // Replies by their agent and the message they answer, and by that message alone.
  const replies = new Map<string, string>();
  const notices: [MatrixEvent, string][] = [];
  events.forEach((event) => {
    const id = event.getId();
    const answered = genuineReplyEventId(event);
    if (!id || !answered || !isMindroomAgentUserIdForViewer(event.getSender(), viewerId)) return;
    if (event.isRedacted() || isHidden(event)) return;
    const content = event.getOriginalContent();
    const action = content[CHAT_UI_ACTION_KEY] as Record<string, unknown> | undefined;
    if (action?.action === 'show_canvas' && action.inline !== true) {
      if (!revealed.has(id)) notices.push([event, `${event.getSender()} ${answered}`]);
    } else if (!action && content.msgtype === 'm.text') {
      replies.set(`${event.getSender()} ${answered}`, id).set(answered, id);
    }
  });
  const hiddenEventIds = new Set<string>();
  const byReply = new Map<string, ReplyCard[]>();
  const add = (replyId: string | undefined, card: ReplyCard) =>
    replyId && (byReply.get(replyId)?.push(card) ?? byReply.set(replyId, [card]));
  notices.forEach(([notice, key]) => {
    const action = replies.has(key) ? readCanvas?.(notice) : undefined;
    if (action?.action !== 'show_canvas') return;
    add(replies.get(key), { canvas: action });
    hiddenEventIds.add(action.eventId);
  });
  tasks.forEach((reminder) => {
    if (reminder.threadId === threadId)
      add(replies.get(reminder.sourceEventId ?? ''), { reminder });
  });
  return byReply.size === 0 ? NO_REPLY_CARDS : { hiddenEventIds, byReply };
};

const cardKey = (card: ReplyCard) =>
  'canvas' in card ? [card.canvas.revisionEventId, card.canvas.canvas.title] : card.reminder;

type PlanInput = Parameters<typeof planReplyCards>[0];

/**
 * `planReplyCards` on each render, with the room's tasks parsed once per state change and the
 * canvases the viewer's message buttons would open; one that draws the same is the last.
 */
export const useReplyCardPlan = (
  room: Room,
  input: Omit<PlanInput, 'tasks' | 'readCanvas'>
): ReplyCardPlan => {
  const taskEvents = useScheduledTaskEvents(room);
  const tasks = useMemo(() => getPendingRoomSchedules(taskEvents), [taskEvents]);
  const actions = useContext(ChatUiActionContext);
  const canvasEnabled = useOptionalClientConfig()?.mindroom?.canvas?.enabled === true;
  const last = useRef({ plan: NO_REPLY_CARDS, key: '' });
  const readCanvas = canvasEnabled ? actions?.read : undefined;
  const plan = planReplyCards({ ...input, tasks, readCanvas });
  const key = JSON.stringify([...plan.byReply].map(([id, cards]) => [id, cards.map(cardKey)]));
  if (key !== last.current.key) last.current = { plan, key };
  return last.current.plan;
};
