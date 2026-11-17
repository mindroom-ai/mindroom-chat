import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { MatrixEventEvent, RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
import { useMessageRendererTaken } from '../plugins/messageRenderers';
import {
  NO_INLINE_SECRET_REQUESTS,
  planInlineSecretRequests,
  sameInlineSecretRequestPlan,
  secretRequestCards,
  type InlineSecretRequestPlan,
} from './inlineSecretRequests';

/**
 * The open thread's inline secret requests (planInlineSecretRequests), made again whenever the
 * thread's events change, and when one of them decrypts, is redacted or replaced in place, which
 * leaves the array as it was. A plan that draws the same as the last is the last, so the
 * thread's replies do not redraw for each streamed edit. Only threads plan them; the room's views
 * keep each card's row.
 */
export const useInlineSecretRequestPlan = ({
  room,
  events,
  getContent,
  ignored,
  viewerId,
  threadId,
  routeId,
  focusId,
}: {
  room: Room;
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
  const [changes, countChange] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!threadId) return undefined;
    const inThread = (event: MatrixEvent | undefined, rootId = event?.threadRootId) =>
      event?.getRoomId() === room.roomId && (rootId === threadId || event?.getId() === threadId);
    const changed = (event: MatrixEvent) => {
      if (inThread(event)) countChange();
    };
    const redacted = (_redaction: MatrixEvent, _room: Room, rootId?: string) => {
      if (rootId === threadId) countChange();
    };
    room.client.on(MatrixEventEvent.Decrypted, changed);
    room.client.on(MatrixEventEvent.Replaced, changed);
    room.on(RoomEvent.Redaction, redacted);
    return () => {
      room.client.off(MatrixEventEvent.Decrypted, changed);
      room.client.off(MatrixEventEvent.Replaced, changed);
      room.off(RoomEvent.Redaction, redacted);
    };
  }, [room, threadId]);
  const rendererTaken = useMessageRendererTaken(viewerId);
  const pluginRenders = useCallback(
    (event: MatrixEvent, content: Record<string, unknown>) =>
      !!rendererTaken?.({
        eventId: event.getId(),
        roomId: event.getRoomId(),
        type: event.getType(),
        sender: event.getSender() ?? '',
        content,
      }),
    [rendererTaken]
  );
  const last = useRef(NO_INLINE_SECRET_REQUESTS);
  return useMemo(() => {
    void changes;
    if (routeId) revealed.current.add(routeId);
    if (focusId) revealed.current.add(focusId);
    const cards = threadId
      ? secretRequestCards(events, (userId) => isMindroomAgentUserIdForViewer(userId, viewerId))
      : [];
    const byId = new Map(cards.length > 0 ? events.map((event) => [event.getId(), event]) : []);
    const plan =
      cards.length === 0
        ? NO_INLINE_SECRET_REQUESTS
        : planInlineSecretRequests({
            cards,
            getEvent: (id) => byId.get(id),
            getContent,
            ignored,
            revealed: revealed.current,
            pluginRenders,
            threadId,
          });
    if (!sameInlineSecretRequestPlan(plan, last.current)) last.current = plan;
    return last.current;
  }, [changes, events, getContent, ignored, pluginRenders, threadId, viewerId, routeId, focusId]);
};
