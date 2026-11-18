import { useCallback, useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from 'react';
import { MatrixEventEvent, RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMessageRendererTaken } from '../plugins/messageRenderers';
import {
  NO_INLINE_SECRET_REQUESTS,
  planInlineSecretRequests,
  sameInlineSecretRequestPlan,
  SecretRequestAttachmentReader,
  secretRequestCards,
  type InlineSecretRequestPlan,
} from './inlineSecretRequests';
import { subscribeLiveMarkdownReady } from './live/liveMarkdown';
import { getLiveReplyStore } from './live/liveReplyStore';

const noSubscription = () => () => undefined;

/**
 * The open thread's inline secret requests (planInlineSecretRequests), made again whenever the
 * thread's events change, and when one of them decrypts, is redacted or replaced in place, which
 * leaves the array as it was. It is made again too when a live frame of a reply it read, or the
 * live Markdown renderer arriving, changes where that reply draws a request: its rows draw the
 * frames, so the plan reads them (SecretRequestAttachmentReader). A plan that draws the same as
 * the last is the last, so the thread's replies do not redraw for each streamed edit or frame.
 * Only threads plan them; the room's views keep each card's row.
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
  const store = getLiveReplyStore(mx);
  const reader = useMemo(() => new SecretRequestAttachmentReader(store), [store]);
  // Synchronous like each row's own (useLiveReplyContent), so a frame's row and plan draw together.
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!threadId) return noSubscription();
      const offFrames = store.subscribeRoom(room.roomId, onChange);
      const offMarkdown = subscribeLiveMarkdownReady(onChange);
      return () => {
        offFrames();
        offMarkdown();
      };
    },
    [room.roomId, store, threadId]
  );
  const frames = useSyncExternalStore(subscribe, reader.getVersion);
  const last = useRef(NO_INLINE_SECRET_REQUESTS);
  return useMemo(() => {
    void changes;
    void frames;
    if (routeId) revealed.current.add(routeId);
    if (focusId) revealed.current.add(focusId);
    const cards = threadId
      ? secretRequestCards(events, (userId) => isMindroomAgentUserIdForViewer(userId, viewerId))
      : [];
    const byId = new Map(cards.length > 0 ? events.map((event) => [event.getId(), event]) : []);
    // Without cards it reads no reply, and keeps none.
    if (cards.length === 0) reader.retain(new Set());
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
            reader,
            threadId,
          });
    if (!sameInlineSecretRequestPlan(plan, last.current)) last.current = plan;
    return last.current;
  }, [
    changes,
    frames,
    events,
    getContent,
    ignored,
    pluginRenders,
    reader,
    threadId,
    viewerId,
    routeId,
    focusId,
  ]);
};
