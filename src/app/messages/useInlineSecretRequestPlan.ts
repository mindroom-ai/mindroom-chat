import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { MatrixEventEvent, RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import {
  NO_INLINE_SECRET_REQUESTS,
  createDrawnSecretRequests,
  planInlineSecretRequests,
  sameInlineSecretRequestPlan,
  secretRequestCards,
  type InlineSecretRequestPlan,
} from './inlineSecretRequests';

/**
 * The open thread's inline secret requests (planInlineSecretRequests), made again whenever the
 * thread's events change, and when one of them decrypts, is redacted or replaced in place, which
 * leaves the array as it was. A plan that allows the same as the last is the last, so the
 * thread's replies do not redraw for each streamed edit. With it, this timeline's record of the
 * lines its replies have mounted (`drawn`). Only threads plan them; the room's views keep each
 * card's row.
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
  const mx = useMatrixClient();
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
    mx.on(MatrixEventEvent.Decrypted, changed);
    mx.on(MatrixEventEvent.Replaced, changed);
    room.on(RoomEvent.Redaction, redacted);
    return () => {
      mx.removeListener(MatrixEventEvent.Decrypted, changed);
      mx.removeListener(MatrixEventEvent.Replaced, changed);
      room.removeListener(RoomEvent.Redaction, redacted);
    };
  }, [mx, room, threadId]);
  const [drawn] = useState(createDrawnSecretRequests);
  const last = useRef<InlineSecretRequestPlan>(NO_INLINE_SECRET_REQUESTS);
  return useMemo(() => {
    void changes;
    if (routeId) revealed.current.add(routeId);
    if (focusId) revealed.current.add(focusId);
    const cards = threadId
      ? secretRequestCards(events, (userId) => isMindroomAgentUserIdForViewer(userId, viewerId))
      : [];
    const byId = new Map(cards.length > 0 ? events.map((event) => [event.getId(), event]) : []);
    const plan = planInlineSecretRequests({
      cards,
      getEvent: (id) => byId.get(id),
      getContent,
      ignored,
      revealed: revealed.current,
      threadId,
    });
    if (last.current.drawn !== drawn || !sameInlineSecretRequestPlan(plan, last.current)) {
      last.current = { ...plan, drawn };
    }
    return last.current;
  }, [changes, drawn, events, getContent, ignored, threadId, viewerId, routeId, focusId]);
};
