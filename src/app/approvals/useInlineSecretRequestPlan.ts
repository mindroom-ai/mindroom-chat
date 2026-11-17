import { useRef } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
import { planInlineSecretRequests, type InlineSecretRequestPlan } from './inlineSecretRequests';

const EMPTY_PLAN: InlineSecretRequestPlan = { hiddenEventIds: new Set(), byReply: new Map() };

const planKey = (plan: InlineSecretRequestPlan): string =>
  JSON.stringify(
    [...plan.byReply].map(([replyId, calls]) => [
      replyId,
      [...calls].map(([callId, { eventId, agentUserId, request }]) => [
        callId,
        eventId,
        agentUserId,
        request,
      ]),
    ])
  );

/**
 * The open thread's inline secret requests (planInlineSecretRequests), planned again on every
 * render, since a card's status and a reply's trace arrive as edits, which leave the thread's
 * events as they are. Only threads plan them; the room's views keep each card's row. The plan
 * keeps its identity while it stays the same, so the thread's replies redraw only when it changes.
 */
export const useInlineSecretRequestPlan = ({
  events,
  getContent,
  ignored,
  viewerId,
  threadId,
  routeId,
  focusId,
}: {
  events: readonly MatrixEvent[];
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  ignored: ReadonlySet<string>;
  viewerId: string | undefined;
  threadId: string | undefined;
  routeId?: string;
  focusId?: string;
}): InlineSecretRequestPlan => {
  // A card the route or a jump opened keeps its row after the highlight ends.
  const revealed = useRef(new Set<string>());
  const previous = useRef<{ key: string; plan: InlineSecretRequestPlan }>();
  if (!threadId) return EMPTY_PLAN;
  if (routeId) revealed.current.add(routeId);
  if (focusId) revealed.current.add(focusId);
  const plan = planInlineSecretRequests({
    events,
    getContent,
    isAgent: (userId) => isMindroomAgentUserIdForViewer(userId, viewerId),
    ignored,
    revealed: revealed.current,
    threadId,
  });
  const key = planKey(plan);
  if (previous.current?.key === key) return previous.current.plan;
  previous.current = { key, plan };
  return plan;
};
