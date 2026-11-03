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
  EventType,
  MatrixEventEvent,
  RelationType,
  type MatrixEvent,
  type Relations,
  type Room,
} from 'matrix-js-sdk';
import type { Editor } from 'slate';
import { useSetAtom } from 'jotai';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useKeyDown } from '../../../hooks/useKeyDown';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { usePowerLevelsContext } from '../../../hooks/usePowerLevels';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { isEmptyEditor } from '../../../components/editor';
import { Reply } from '../../../components/message';
import { MessageAside } from '../../../components/message/layout/MessageAside';
import { RenderMessageContent } from '../../../components/RenderMessageContent';
import { Reactions } from '../../../features/room/message/Reactions';
import { getReactCustomHtmlParser, LINKIFY_OPTS } from '../../../plugins/react-custom-html-parser';
import { useSettingValue } from '../../../state/hooks/useSettingValue';
import { settingsAtom, type Settings } from '../../../state/settings';
import { roomIdToReplyDraftAtomFamily } from '../../../state/room/roomInputDrafts';
import { getEditedEvent, getEventReactions, getLatestMessageContent } from '../../../utils/room';
import { MessageEvent } from '../../../../types/matrix/room';
import { EncryptedContent } from '../../../features/room/message/EncryptedContent';
import { Event, Message } from '../../messages/MindroomMessage';
import { CollapsibleMessage, CollapsibleMessageStateProvider } from '../CollapsibleMessage';
import {
  getCollapsibleMessageMeasurementKey,
  getCollapsibleMessageMode,
  shouldForceCollapsibleMessageOverflow,
} from '../threadCollapsibleMessages';
import { useTimelineBulkExpansionAnchor } from '../useTimelineBulkExpansionAnchor';
import { isMindroomAgentUserId } from '../../matrix/agentIdentity';
import { FailedSendActions } from '../../messages/FailedSendActions';
import { ApprovalHistory } from '../../messages/ThreadApprovalControls';
import { MindroomThreadSummaryMarker } from '../../messages/MindroomThreadSummaryMarker';
import { getMindroomThreadSummaryInfo } from '../../messages/threadSummary';
import {
  getMindroomRoomTimelineApprovalContent,
  MINDROOM_ROOM_TIMELINE_APPROVAL_EVENT,
  renderMindroomRoomTimelineThreadBadge,
} from '../roomTimelineMessageExtensions';
import { buildMindroomRoomTimelineReplyDraft } from '../roomTimelineReplyDraft';
import { isConfirmedMatrixEventId } from '../threadRouteUtils';
import { canPinRoomEvents } from '../threadPinning';
import { getLinkedTimelines } from '../linkedTimelines';
import { LiveReplyMessageContent } from './LiveReplyMessageContent';
import type { TimelineMessageData, TimelineMessageKind, TimelineMessageRow } from './types';

/**
 * The settings below come from the user's preferences; `hideActivity` keeps read receipts
 * private, so the rows show none either.
 */
type TimelineSettings = Pick<
  Settings,
  | 'messageLayout'
  | 'messageSpacing'
  | 'hideActivity'
  | 'hideMembershipEvents'
  | 'hideNickAvatarEvents'
  | 'showHiddenEvents'
>;

export type UseTimelineMessageFeatureOptions = TimelineSettings & {
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

const REPAINT_EVENTS = [MatrixEventEvent.Decrypted, MatrixEventEvent.Replaced] as const;

/** The settings each message row reads; the row list re-renders when one changes. */
const useMessageDisplaySettings = () => ({
  dateFormatString: useSettingValue(settingsAtom, 'dateFormatString'),
  hour24Clock: useSettingValue(settingsAtom, 'hour24Clock'),
  mediaAutoLoad: useSettingValue(settingsAtom, 'mediaAutoLoad'),
  urlPreview: useSettingValue(settingsAtom, 'urlPreview'),
  encUrlPreview: useSettingValue(settingsAtom, 'encUrlPreview'),
});

/**
 * Re-render the host when an encrypted row on screen decrypts or gets new content from an edit.
 * An encrypted edit, such as each step of an agent reply streaming in an encrypted room, replaces
 * its target only once decrypted, after the timeline change that brought it; an edit in a room
 * without encryption replaces its target before that change. Listens to exactly the events the
 * last render showed: new rows subscribe, rows that left the screen unsubscribe.
 */
const useDecryptionRepaint = (renderedEventsRef: RefObject<MatrixEvent[]>): number => {
  const [decryptions, repaint] = useReducer((value: number) => value + 1, 0);
  const subscribedRef = useRef(new Set<MatrixEvent>());
  useEffect(() => {
    const subscribed = subscribedRef.current;
    const current = new Set(
      (renderedEventsRef.current ?? []).filter((event) => event.isEncrypted?.())
    );
    subscribed.forEach((event) => {
      if (current.has(event)) return;
      REPAINT_EVENTS.forEach((name) => event.removeListener(name, repaint));
      subscribed.delete(event);
    });
    current.forEach((event) => {
      // Rows can hold stand-ins for events that never decrypt and emit nothing.
      if (subscribed.has(event) || typeof event.on !== 'function') return;
      REPAINT_EVENTS.forEach((name) => event.on(name, repaint));
      subscribed.add(event);
    });
  });
  useEffect(
    () => () => {
      subscribedRef.current.forEach((event) =>
        REPAINT_EVENTS.forEach((name) => event.removeListener(name, repaint))
      );
      subscribedRef.current.clear();
    },
    []
  );
  return decryptions;
};

type ReactionToggle = (
  targetEventId: string,
  key: string,
  shortcode: string | undefined,
  relations?: Relations
) => void;

/** The reaction chips under a message; renders nothing until it has reactions. */
function TimelineReactions({
  room,
  event,
  relations,
  onReactionToggle,
}: {
  room: Room;
  event: MatrixEvent;
  relations: Relations | undefined;
  onReactionToggle: ReactionToggle;
}) {
  const eventId = event.getId();
  if (!relations || !eventId) return null;
  return (
    <Reactions
      room={room}
      mEventId={eventId}
      targetEvent={event}
      canSendReaction
      relations={relations}
      onReactionToggle={onReactionToggle}
    />
  );
}

/** Toggle the user's reaction `key` on `targetEventId`: redact it when present, send it otherwise. */
const useReactionToggle = (room: Room, threadId: string | undefined) => {
  const client = useMatrixClient();
  return useCallback(
    (targetEventId: string, key: string, shortcode: string | undefined, relations?: Relations) => {
      const userId = client.getUserId();
      const own = relations
        ?.getSortedAnnotationsByKey()
        ?.find(([annotationKey]) => annotationKey === key)?.[1];
      const ownEvent =
        own && [...own].find((event) => event.getSender() === userId && !event.isRedacted());
      const ownEventId = ownEvent?.getId();
      if (ownEventId) {
        client.redactEvent(room.roomId, ownEventId).catch(() => undefined);
        return;
      }
      const content = {
        'm.relates_to': { rel_type: RelationType.Annotation, event_id: targetEventId, key },
        ...(shortcode ? { shortcode } : {}),
      };
      client
        .sendEvent(room.roomId, threadId ?? null, EventType.Reaction, content as never)
        .catch(() => undefined);
    },
    [client, room.roomId, threadId]
  );
};

/** What the user may do with the room's events, for the actions of a message row. */
const useMessagePermissions = (room: Room, userId: string | null) => {
  const creators = useRoomCreators(room);
  const levels = usePowerLevelsContext();
  const permissions = useRoomPermissions(creators, levels);
  if (!userId) return { canPinEvent: false, canSendRedaction: false, canRedactOthers: false };
  return {
    canPinEvent: canPinRoomEvents(creators, levels, userId),
    // A redaction needs permission to send `m.room.redaction`; redacting someone else's event also
    // needs the room's `redact` level (Matrix specification, redaction authorization rules).
    canSendRedaction: permissions.event(MessageEvent.RoomRedaction, userId),
    canRedactOthers: permissions.action('redact', userId),
  };
};

/** A row is still on its way to the server while its event, or its edit, is in one of these. */
const PENDING_SEND_STATUSES: ReadonlySet<EventStatus | null> = new Set([
  EventStatus.ENCRYPTING,
  EventStatus.QUEUED,
  EventStatus.SENDING,
]);

/** The edit carries the send state of an edited row while it is still being sent or failed. */
const getSendStateEvent = (event: MatrixEvent, editedEvent: MatrixEvent | undefined) =>
  editedEvent?.status ? editedEvent : event;

/**
 * Rows that arrived live open once, however long, and fold like history afterwards. Marking
 * repaints the rows; consuming does not, so the open row keeps its paint until the next one.
 */
const useLiveExpansion = () => {
  const idsRef = useRef(new Set<string>());
  const [, repaint] = useReducer((value: number) => value + 1, 0);
  const mark = useCallback((eventId: string) => {
    if (idsRef.current.has(eventId)) return;
    idsRef.current.add(eventId);
    repaint();
  }, []);
  const consume = useCallback((eventId: string) => {
    idsRef.current.delete(eventId);
  }, []);
  return { ids: idsRef.current, mark, consume };
};

/**
 * How the room and thread timelines render one message row: edit state, reply quotes, collapse,
 * approvals, summary markers and failed sends; plus Up-arrow editing of the user's last message.
 */
export const useTimelineMessageFeature = ({
  room,
  editor,
  threadId,
  scrollRef,
  showThreadRepliesInRoom,
  hideActivity,
  messageLayout,
  messageSpacing,
}: UseTimelineMessageFeatureOptions) => {
  const client = useMatrixClient();
  const [editingEventId, setEditingEventId] = useState<string>();
  const liveExpansion = useLiveExpansion();
  const { mark: markLiveExpansionCandidate, consume: consumeLiveExpansion } = liveExpansion;
  const liveExpansionIds = liveExpansion.ids;
  const manualExpansionState = useRef(new Map<string, boolean>()).current;
  const [expandAll, setExpandAll] = useState(false);
  const restoreExpansionAnchor = useTimelineBulkExpansionAnchor(expandAll, scrollRef);
  const toggleExpandAll = useCallback(() => {
    // The new baseline replaces every choice made for a single message.
    manualExpansionState.clear();
    setExpandAll((current) => !current);
  }, [manualExpansionState]);
  const renderedEventsRef = useRef<MatrixEvent[]>([]);
  renderedEventsRef.current = [];

  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  const findLatestEditableEvent = useCallback((): MatrixEvent | undefined => {
    const userId = client.getUserId();
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
  }, [client, room]);

  // Up in an empty composer edits the user's latest message, as in most chat clients.
  const editLatestOnArrowUp = useCallback(
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
  );
  useKeyDown(window, editLatestOnArrowUp);

  const decryptions = useDecryptionRepaint(renderedEventsRef);

  const userId = client.getUserId();
  const { canPinEvent, canSendRedaction, canRedactOthers } = useMessagePermissions(room, userId);

  const toggleReaction = useReactionToggle(room, threadId);
  const useAuthentication = useMediaAuthentication();
  const { dateFormatString, hour24Clock, mediaAutoLoad, urlPreview, encUrlPreview } =
    useMessageDisplaySettings();
  // Encrypted rooms preview links only when the user allows it: the preview request reveals the
  // link to the homeserver.
  const showUrlPreview = room.hasEncryptionStateEvent?.() ? encUrlPreview : urlPreview;
  const htmlReactParserOptions = useMemo(
    () =>
      getReactCustomHtmlParser(client, room.roomId, {
        linkifyOpts: LINKIFY_OPTS,
        useAuthentication,
      }),
    [client, room.roomId, useAuthentication]
  );

  const setReplyDraft = useSetAtom(roomIdToReplyDraftAtomFamily(room.roomId));
  const { navigateRoomThread } = useRoomNavigate();
  const handleReplyClick = useCallback(
    (replyEventId: string, startThread = false) => {
      const reply = buildMindroomRoomTimelineReplyDraft(room, replyEventId, startThread);
      if (!reply) return;
      setReplyDraft(reply.draft);
      if (startThread && threadIdRef.current !== reply.threadRootId) {
        navigateRoomThread(room.roomId, reply.threadRootId);
      }
      document
        .querySelector<HTMLElement>('[data-editable-name="RoomInput"]')
        ?.focus({ preventScroll: true });
    },
    [navigateRoomThread, room, setReplyDraft]
  );
  // A thread badge under a room row opens its thread.
  const handleOpenThread = useCallback(
    (evt: React.MouseEvent) => {
      const rootId = (evt.currentTarget as HTMLElement).getAttribute('data-thread-root-id');
      if (rootId) navigateRoomThread(room.roomId, rootId);
    },
    [navigateRoomThread, room.roomId]
  );

  /** The row of a message, approval, sticker or undecryptable event; read at render time. */
  const renderMessageRow = useCallback(
    (row: TimelineMessageRow, data: TimelineMessageData): ReactNode | null => {
      const { event, eventId, collapse, highlighted } = row;
      const kind = getMessageKind(event.getType());
      if (!kind) return null;

      const editedEvent = getEditedEvent(eventId, event, row.timelineSet);
      const content = (
        kind === 'approval'
          ? getMindroomRoomTimelineApprovalContent(event, editedEvent)
          : getLatestMessageContent(event, editedEvent)
      ) as Record<string, unknown>;
      const summaryInfo =
        threadId && kind === 'message' ? getMindroomThreadSummaryInfo(content) : undefined;
      const marker = summaryInfo
        ? data.threadSummaryTimeline.markersByEventId.get(eventId)
        : undefined;
      if (summaryInfo && marker) {
        return (
          <MessageAside key={eventId} data-message-id={eventId} spaced>
            <MindroomThreadSummaryMarker summaryInfo={summaryInfo} plan={marker} />
          </MessageAside>
        );
      }

      const historyRecords =
        data.approvalTimeline.historyByResponseId.get(eventId) ??
        data.approvalTimeline.fallbackGroupsByEventId.get(eventId);
      const sendState = getSendStateEvent(event, editedEvent);
      const failedSend = sendState.status === EventStatus.NOT_SENT;
      const pendingSend = PENDING_SEND_STATUSES.has(sendState.status);
      // The footer of an open thread offers the actions for its own failed root.
      const showFailedActions = failedSend && !(threadId && eventId === threadId);
      const editable = kind === 'message';
      const collapseMode = getCollapsibleMessageMode(
        eventId,
        content,
        liveExpansionIds,
        isMindroomAgentUserId(event.getSender() ?? undefined)
      );
      const msgType = typeof content.msgtype === 'string' ? content.msgtype : '';
      const isAgentReply =
        !!content['io.mindroom.ai_run'] || !!content['io.mindroom.stream_status'];
      const replyEventId =
        kind !== 'sticker' && shouldShowReply(row) ? event.replyEventId : undefined;
      const contentProps = {
        mEvent: event,
        eventId,
        // Approval cards send their responses to this room and thread.
        roomId: room.roomId,
        threadId: threadId ?? event.threadRootId,
        displayName: room.getMember?.(event.getSender() ?? '')?.name ?? event.getSender() ?? '',
        msgType,
        eventType: event.getType(),
        ts: event.getTs(),
        edited: !!editedEvent || !!event.replacingEvent(),
        pendingSend,
        failedSend,
        getContent: (() => content) as <T>() => T,
        mediaAutoLoad: !!mediaAutoLoad,
        urlPreview: !!showUrlPreview,
        htmlReactParserOptions,
        linkifyOpts: LINKIFY_OPTS,
      };
      const relations = getEventReactions(row.timelineSet, eventId);
      const canDelete =
        canSendRedaction &&
        !event.isRedacted() &&
        (event.getSender() === userId || canRedactOthers);
      // Room rows show the thread they start under their reactions. An open thread shows none,
      // and neither does the classic view, which shows the replies themselves.
      const threadBadge =
        threadId || showThreadRepliesInRoom
          ? null
          : renderMindroomRoomTimelineThreadBadge({
              eventId,
              event,
              threadRecordMap: data.threadRecordMap,
              room,
              onClick: handleOpenThread,
              includeRecentSummaryData: true,
            });

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
            canDelete={canDelete}
            canSendReaction={kind !== 'sticker'}
            canPinEvent={canPinEvent}
            relations={relations}
            reply={
              replyEventId ? (
                <Reply
                  room={room}
                  replyEventId={replyEventId}
                  threadRootId={event.threadRootId}
                  timelineSet={row.timelineSet}
                  hideThreadIndicator={!!threadId}
                  data-event-id={replyEventId}
                  onClick={data.handleOpenReply}
                />
              ) : undefined
            }
            reactions={
              kind !== 'sticker' ? (
                <>
                  <TimelineReactions
                    room={room}
                    event={event}
                    relations={relations}
                    onReactionToggle={toggleReaction}
                  />
                  {threadBadge}
                </>
              ) : undefined
            }
            resolvedMessageContent={content}
            messageLayout={messageLayout}
            messageSpacing={messageSpacing}
            onReplyClick={handleReplyClick}
            onReactionToggle={(key, shortcode) =>
              toggleReaction(eventId, key, shortcode, relations)
            }
            hideReadReceipts={hideActivity}
            hour24Clock={!!hour24Clock}
            dateFormatString={dateFormatString}
          >
            <CollapsibleMessage
              expansionKey={eventId}
              collapseMode={collapseMode}
              forceOverflowing={shouldForceCollapsibleMessageOverflow(content)}
              measurementKey={getCollapsibleMessageMeasurementKey(event, collapseMode, editedEvent)}
              onInitialExpandConsumed={() => consumeLiveExpansion(eventId)}
            >
              {({ loadFullContent }) =>
                isAgentReply ? (
                  <LiveReplyMessageContent {...contentProps} hydrateLongText={loadFullContent} />
                ) : (
                  <RenderMessageContent {...contentProps} hydrateLongText={loadFullContent} />
                )
              }
            </CollapsibleMessage>
          </Message>
          {historyRecords && historyRecords.length > 0 && (
            <ApprovalHistory records={historyRecords as never} />
          )}
          {showFailedActions && <FailedSendActions room={room} event={sendState} />}
        </React.Fragment>
      );
    },
    [
      canPinEvent,
      canRedactOthers,
      canSendRedaction,
      consumeLiveExpansion,
      dateFormatString,
      editingEventId,
      handleOpenThread,
      handleReplyClick,
      hideActivity,
      hour24Clock,
      htmlReactParserOptions,
      liveExpansionIds,
      mediaAutoLoad,
      messageLayout,
      messageSpacing,
      room,
      showThreadRepliesInRoom,
      showUrlPreview,
      threadId,
      toggleReaction,
      userId,
    ]
  );

  const renderEvent = useCallback(
    (row: TimelineMessageRow, data: TimelineMessageData): ReactNode | null => {
      void decryptions;
      const { event, eventId, highlighted } = row;
      if (event.getStateKey?.() !== undefined) {
        if (!RENDERED_STATE_EVENTS.has(event.getType())) return null;
        return (
          <Event
            key={eventId}
            data-message-id={eventId}
            room={room}
            mEvent={event}
            highlight={highlighted}
            messageSpacing={messageSpacing}
          />
        );
      }
      renderedEventsRef.current?.push(event);
      // An encrypted row renders what it decrypts to; it repaints once decrypted.
      if (event.isEncrypted?.()) {
        return (
          <EncryptedContent key={eventId} mEvent={event}>
            {() => renderMessageRow(row, data)}
          </EncryptedContent>
        );
      }
      return renderMessageRow(row, data);
    },
    [decryptions, messageSpacing, renderMessageRow, room]
  );

  const wrapExpansion = useCallback(
    (node: ReactNode) => (
      <CollapsibleMessageStateProvider
        expandAllInit={expandAll}
        manualExpansionState={manualExpansionState}
        onExpansionLayoutChange={restoreExpansionAnchor}
      >
        {node}
      </CollapsibleMessageStateProvider>
    ),
    [expandAll, manualExpansionState, restoreExpansionAnchor]
  );

  return {
    renderEvent,
    wrapExpansion,
    markLiveExpansionCandidate,
    editingEventId,
    setEditingEventId,
    expandAll,
    toggleExpandAll,
  };
};
