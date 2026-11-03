import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  EventStatus,
  MatrixEventEvent,
  RelationType,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import type { Editor } from 'slate';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useKeyDown } from '../../../hooks/useKeyDown';
import { isEmptyEditor } from '../../../components/editor';
import { RenderMessageContent } from '../../../components/RenderMessageContent';
import { Event, Message } from '../../messages/MindroomMessage';
import type { MessageLayout, MessageSpacing } from '../../../state/settings';
import { MessageEvent } from '../../../../types/matrix/room';
import { CollapsibleMessage, CollapsibleMessageStateProvider } from '../CollapsibleMessage';
import { FailedSendActions } from '../../messages/FailedSendActions';
import { ApprovalHistory } from '../../messages/ThreadApprovalControls';
import { MindroomThreadSummaryMarker } from '../../messages/MindroomThreadSummaryMarker';
import { getMindroomThreadSummaryInfo } from '../../messages/threadSummary';
import { MINDROOM_ROOM_TIMELINE_APPROVAL_EVENT } from '../roomTimelineMessageExtensions';
import { isConfirmedMatrixEventId } from '../threadRouteUtils';
import { getLinkedTimelines } from '../linkedTimelines';
import { LiveReplyMessageContent } from './LiveReplyMessageContent';
import type { TimelineMessageData, TimelineMessageKind, TimelineMessageRow } from './types';

export type UseTimelineMessageFeatureOptions = {
  room: Room;
  editor: Editor;
  threadId?: string;
  scrollRef: RefObject<HTMLDivElement>;
  showThreadRepliesInRoom: boolean;






};

/** State events the timeline shows as a one-line notice. */
const RENDERED_STATE_EVENTS = new Set([
  'm.room.member',
  'm.room.name',
  'm.room.topic',
  'm.room.avatar',
  'm.room.create',
  'm.room.encryption',
]);

const getMessageKind = (eventType: string): TimelineMessageKind | undefined => {
  if (eventType === MessageEvent.RoomMessage) return 'message';
  if (eventType === MINDROOM_ROOM_TIMELINE_APPROVAL_EVENT) return 'approval';
  if (eventType === MessageEvent.Sticker) return 'sticker';
  if (eventType === MessageEvent.RoomMessageEncrypted) return 'encrypted';
  return undefined;
};

const isEditableOwnMessage = (event: MatrixEvent, userId: string | null): boolean => {
  if (!userId || event.getSender() !== userId) return false;
  if (!isConfirmedMatrixEventId(event.getId())) return false;
  if (event.getType() !== MessageEvent.RoomMessage || event.isRedacted()) return false;
  if (event.getRelation()?.rel_type === RelationType.Replace) return false;
  const msgtype = event.getContent().msgtype;
  return msgtype === 'm.text' || msgtype === 'm.notice' || msgtype === 'm.emote';
};

/** Whether the row should quote what it replies to (not the message right before it, not a thread fallback). */
const shouldShowReply = (row: TimelineMessageRow): boolean => {
  const { event, previousEventId } = row;
  const replyEventId = event.replyEventId;
  if (!replyEventId) return false;
  const relation = event.getWireContent?.()?.['m.relates_to'] as
    | { rel_type?: string; is_falling_back?: boolean }
    | undefined;
  if (relation?.rel_type === RelationType.Thread && relation.is_falling_back) return false;
  return replyEventId !== previousEventId;
};

/** Re-render rows whose encrypted event decrypts; listens only to the events on screen. */
const useDecryptedEventsRefresh = (events: readonly MatrixEvent[]) => {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const encrypted = events.filter((event) => event.isEncrypted() && !event.getClearContent());
    encrypted.forEach((event) => event.once(MatrixEventEvent.Decrypted, refresh));
    return () => {
      encrypted.forEach((event) => event.removeListener(MatrixEventEvent.Decrypted, refresh));
    };
  });
};

/**
 * How the room and thread timelines render one message row: edit state, reply quotes, collapse,
 * approvals, summary markers and failed sends; plus Up-arrow editing of the user's last message.
 */
export const useTimelineMessageFeature = ({
  room,
  editor,
  threadId,



}: UseTimelineMessageFeatureOptions) => {
  const mx = useMatrixClient();
  const [editingEventId, setEditingEventId] = useState<string>();
  const [liveExpansionIds, setLiveExpansionIds] = useState<ReadonlySet<string>>(() => new Set());
  const manualExpansionState = useRef(new Map<string, boolean>()).current;
  const renderedEventsRef = useRef<MatrixEvent[]>([]);
  renderedEventsRef.current = [];

  const markLiveExpansionCandidate = useCallback((eventId: string) => {
    setLiveExpansionIds((current) =>
      current.has(eventId) ? current : new Set([...current, eventId])
    );
  }, []);
  const consumeLiveExpansion = useCallback((eventId: string) => {
    setLiveExpansionIds((current) => {
      if (!current.has(eventId)) return current;
      const next = new Set(current);
      next.delete(eventId);
      return next;
    });
  }, []);

  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  const findLatestEditableEvent = useCallback((): MatrixEvent | undefined => {
    const userId = mx.getUserId();
    const activeThreadId = threadIdRef.current;
    if (activeThreadId) {
      const thread = room.getThread(activeThreadId);
      // The thread's own live timeline chain; the root may be stored apart from it.
      const events = thread?.liveTimeline
        ? getLinkedTimelines(thread.liveTimeline).flatMap((timeline) => timeline.getEvents())
        : [];
      const reply = [...events].reverse().find((event) => isEditableOwnMessage(event, userId));
      if (reply) return reply;
      const root = thread?.rootEvent;
      return root && isEditableOwnMessage(root, userId) ? root : undefined;
    }
    return [...room.getLiveTimeline().getEvents()]
      .reverse()
      .find((event) => isEditableOwnMessage(event, userId));





      (evt: KeyboardEvent) => {
        if (evt.key !== 'ArrowUp') return;
        const active = document.activeElement;
        if (active?.getAttribute('data-editable-name') !== 'RoomInput') return;
        if (!isEmptyEditor(editor)) return;
        const target = findLatestEditableEvent();
        const targetId = target?.getId();
        if (!targetId) return;
        evt.preventDefault();
        setEditingEventId(targetId);
      },
      [editor, findLatestEditableEvent]
    )
  );

  const renderEvent = useCallback(
    (row: TimelineMessageRow, data: TimelineMessageData): ReactNode | null => {
      const { event, eventId, collapse, highlighted } = row;
      if (event.getStateKey?.() !== undefined) {
        if (!RENDERED_STATE_EVENTS.has(event.getType())) return null;
        return (
          <Event
            key={eventId}
            data-message-id={eventId}
            room={room}
            mEvent={event}



          />
        );
      }

      const kind = getMessageKind(event.getType());
      if (!kind) return null;
      renderedEventsRef.current.push(event);

      const content = event.getContent() as Record<string, unknown>;
      const summaryInfo =
        threadId && kind === 'message' ? getMindroomThreadSummaryInfo(content) : undefined;
      const marker = summaryInfo
        ? data.threadSummaryTimeline.markersByEventId.get(eventId)
        : undefined;
      if (summaryInfo && marker) {
        return (
          <MindroomThreadSummaryMarker key={eventId} summaryInfo={summaryInfo} plan={marker} />
        );
      }

      const historyRecords =
        data.approvalTimeline.historyByResponseId.get(eventId) ??
        data.approvalTimeline.fallbackGroupsByEventId.get(eventId);
      const failed = event.status === EventStatus.NOT_SENT && !(threadId && eventId === threadId);
      const editable = kind === 'message';
      const collapseMode = liveExpansionIds.has(eventId) ? 'initially-expanded' : 'default';
      const msgType = typeof content.msgtype === 'string' ? content.msgtype : '';
      const isAgentReply =
        !!content['io.mindroom.ai_run'] || !!content['io.mindroom.stream_status'];
      const contentProps = {
        mEvent: event,
        eventId,
        displayName: room.getMember(event.getSender() ?? '')?.name ?? event.getSender() ?? '',
        msgType,
        eventType: event.getType(),
        ts: event.getTs(),
        edited: !!event.replacingEvent(),
        getContent: (() => event.getContent()) as <T>() => T,
        mediaAutoLoad: true,
        urlPreview: true,
        htmlReactParserOptions: {},
        linkifyOpts: {},
      };

      return (
        <React.Fragment key={eventId}>
          <Message
            data-message-id={eventId}
            room={room}
            mEvent={event}
            collapse={collapse}
            highlight={highlighted}
            edit={editable && editingEventId === eventId ? true : undefined}
            onEditId={editable ? setEditingEventId : undefined}
            reply={
              kind !== 'sticker' && shouldShowReply(row) ? (
                <span data-reply-to={event.replyEventId} />
              ) : undefined
            }
            reactions={kind !== 'sticker' ? <span data-reactions-for={eventId} /> : undefined}
            resolvedMessageContent={content}
            messageLayout={messageLayout}
            messageSpacing={messageSpacing}
            onReplyClick={data.handleOpenReply as never}
            hour24Clock={false}
            dateFormatString="D MMM YYYY"
          >
            <CollapsibleMessage
              expansionKey={eventId}
              collapseMode={collapseMode}
              onInitialExpandConsumed={() => consumeLiveExpansion(eventId)}
            >
              {isAgentReply ? (
                <LiveReplyMessageContent {...contentProps} />
              ) : (
                <RenderMessageContent {...contentProps} />
              )}
            </CollapsibleMessage>
          </Message>
          {historyRecords && historyRecords.length > 0 && (
            <ApprovalHistory records={historyRecords as never} />
          )}
          {failed && <FailedSendActions room={room} event={event} />}
        </React.Fragment>
      );
    },
    [
      consumeLiveExpansion,
      editingEventId,
      hideActivity,
      liveExpansionIds,
      messageLayout,
      messageSpacing,
      room,
      threadId,
    ]
  );

  const RefreshOnDecryption = useMemo(
    () =>
      function RefreshOnDecryptionInner({ children }: { children: ReactNode }) {
        useDecryptedEventsRefresh(renderedEventsRef.current);
        return <>{children}</>;
      },
    []
  );

  const wrapExpansion = useCallback(
    (node: ReactNode) => (
      <CollapsibleMessageStateProvider
        expandAllInit={undefined}
        manualExpansionState={manualExpansionState}
      >
        <RefreshOnDecryption>{node}</RefreshOnDecryption>
      </CollapsibleMessageStateProvider>
    ),
    [manualExpansionState, RefreshOnDecryption]
  );

  return {
    renderEvent,
    wrapExpansion,
    markLiveExpansionCandidate,
    editingEventId,
    setEditingEventId,
  };
};
