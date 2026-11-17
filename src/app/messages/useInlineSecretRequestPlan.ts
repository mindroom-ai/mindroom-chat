import { useEffect, useMemo, useReducer, useRef } from 'react';
import { MatrixEventEvent, type MatrixEvent } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
import { MINDROOM_SECRET_REQUEST_KEY } from '../matrix/protocol/secretRequest';
import {
  planInlineSecretRequests,
  secretRequestCards,
  type InlineSecretRequestPlan,
} from './inlineSecretRequests';

type Plan = ReturnType<typeof planInlineSecretRequests>;
const NO_PLAN: Plan = { hiddenEventIds: new Set(), byReply: new Map(), pending: new Set() };
const NO_CARDS: MatrixEvent[] = [];

/** The reply a card names in its first content, which its edits keep. */
const namedReplyId = (card: MatrixEvent): string | undefined => {
  const request: unknown = card.getOriginalContent()[MINDROOM_SECRET_REQUEST_KEY];
  const id = (request as { response_event_id?: unknown } | null)?.response_event_id;
  return typeof id === 'string' ? id : undefined;
};

/**
 * The open thread's inline secret requests (planInlineSecretRequests). A card's status and a
 * reply's trace arrive as edits, so the plan is made again when a card comes, decrypts or gets a
 * newer edit (`getRevision`, the ID of the edit its row shows), or the reply it names loads or
 * gets one; else the last plan stays, the same object. Only threads plan them; the room's views
 * keep each card's row.
 */
export const useInlineSecretRequestPlan = ({
  events,
  getContent,
  getRevision,
  ignored,
  viewerId,
  threadId,
  routeId,
  focusId,
}: {
  events: readonly MatrixEvent[];
  getContent: (event: MatrixEvent) => Record<string, unknown>;
  getRevision: (event: MatrixEvent) => string | undefined;
  ignored: ReadonlySet<string>;
  viewerId: string | undefined;
  threadId: string | undefined;
  routeId?: string;
  focusId?: string;
}): InlineSecretRequestPlan => {
  // A card the route or a jump opened keeps its row after the highlight ends.
  const revealed = useRef(new Set<string>());
  // Pending cards that showed as rows, which stay rows until they are done.
  const rows = useRef(new Set<string>());
  // A card is found by its content, which an encrypted event has once it decrypts.
  const [decryptions, countDecryption] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!threadId) return undefined;
    const encrypted = events.filter((event) => event.isEncrypted());
    encrypted.forEach((event) => event.on(MatrixEventEvent.Decrypted, countDecryption));
    return () => {
      encrypted.forEach((event) => event.off(MatrixEventEvent.Decrypted, countDecryption));
    };
  }, [events, threadId]);
  const cards = useMemo(() => {
    void decryptions;
    return threadId
      ? secretRequestCards(events, (userId) => isMindroomAgentUserIdForViewer(userId, viewerId))
      : NO_CARDS;
  }, [events, threadId, viewerId, decryptions]);
  const byId = useMemo(
    () => new Map(cards.length > 0 ? events.map((event) => [event.getId(), event]) : []),
    [cards, events]
  );
  // What the plan reads: the cards, the replies they name and the edit each shows.
  const revision = cards
    .map((card) => {
      const replyId = namedReplyId(card);
      const reply = replyId === undefined ? undefined : byId.get(replyId);
      const replyRevision = reply ? `+${getRevision(reply) ?? ''}` : '-';
      return `${card.getId()}:${getRevision(card) ?? ''}:${replyId ?? ''}${replyRevision}`;
    })
    .join(' ');
  if (routeId) revealed.current.add(routeId);
  if (focusId) revealed.current.add(focusId);
  const key = [threadId, routeId, focusId, revision].join('|');
  const last = useRef<{ key: string; getContent: unknown; ignored: unknown; plan: Plan }>();
  if (
    last.current?.key !== key ||
    last.current.getContent !== getContent ||
    last.current.ignored !== ignored
  ) {
    const plan =
      cards.length === 0
        ? NO_PLAN
        : planInlineSecretRequests({
            cards,
            getEvent: (id) => byId.get(id),
            getContent,
            ignored,
            revealed: revealed.current,
            rows: rows.current,
            threadId,
          });
    last.current = { key, getContent, ignored, plan };
  }
  const { plan } = last.current;
  // After it rendered, a pending card left as a row stays one.
  useEffect(() => {
    plan.pending.forEach((id) => {
      if (!plan.hiddenEventIds.has(id)) rows.current.add(id);
    });
  }, [plan]);
  return plan;
};
