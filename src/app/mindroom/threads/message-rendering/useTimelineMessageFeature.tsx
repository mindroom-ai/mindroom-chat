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
import { useTranslation } from 'react-i18next';
import { Text, color } from 'folds';
import {
  EventStatus,
  MatrixEventEvent,
  RelationType,
  type MatrixClient,
  type MatrixEvent,
  type Relations,
  type Room,
} from 'matrix-js-sdk';
import type { Editor } from 'slate';
import { useAtomValue, useSetAtom } from 'jotai';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useImagePackRooms } from '../../../hooks/useImagePackRooms';
import { useKeyDown } from '../../../hooks/useKeyDown';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { usePowerLevelsContext } from '../../../hooks/usePowerLevels';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { useSpaceOptionally } from '../../../hooks/useSpace';
import { useOpenUserRoomProfile } from '../../../state/hooks/userRoomProfile';
import { isEmptyEditor } from '../../../components/editor';
import { Reply } from '../../../components/message';
import { MessageAside } from '../../../components/message/layout/MessageAside';
import { RenderMessageContent } from '../../../components/RenderMessageContent';
import { Reactions } from '../../../features/room/message/Reactions';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../../plugins/react-custom-html-parser';
import { useMentionClickHandler } from '../../../hooks/useMentionClickHandler';
import { useSettingValue } from '../../../state/hooks/useSettingValue';
import { settingsAtom, type Settings } from '../../../state/settings';
import { roomIdToReplyDraftAtomFamily } from '../../../state/room/roomInputDrafts';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import {
  canEditEvent,
  getEditedEvent,
  getEventReactions,
  getLatestMessageContent,
} from '../../../utils/room';
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
import { toggleReaction as sendReactionToggle } from '../../messages/reactionToggle';
import { ApprovalHistory } from '../../messages/ThreadApprovalControls';
import { MindroomThreadSummaryMarker } from '../../messages/MindroomThreadSummaryMarker';
import { getMindroomThreadSummaryInfo } from '../../messages/threadSummary';
import { shouldShowLinkFavicons } from '../../messages/linkFaviconPolicy';
import {
  getMindroomRoomTimelineApprovalContent,
  renderMindroomRoomTimelineThreadBadge,
} from '../roomTimelineMessageExtensions';
import { buildMindroomRoomTimelineReplyDraft } from '../roomTimelineReplyDraft';
import { isConfirmedMatrixEventId } from '../threadRouteUtils';
import { canPinRoomEvents } from '../threadPinning';
import { getLinkedTimelines } from '../linkedTimelines';
import {
  getTimelineMessageKind,
  NOTICE_STATE_EVENT_TYPES,
  TEXT_MSGTYPES,
} from '../timelineRowTypes';
import { LiveReplyMessageContent } from './LiveReplyMessageContent';
import type { TimelineMessageData, TimelineMessageRow } from './types';

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

/** The user's own confirmed text message, a long text sent as a file included. */
const isEditableOwnMessage = (client: MatrixClient, event: MatrixEvent): boolean =>
  isConfirmedMatrixEventId(event.getId()) && canEditEvent(client, event);

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

/**
 * Pictures and videos sit in a box of at most 400 by 300 pixels (MsgTypeRenderers) and open a
 * viewer on click, so they show whole instead of folding at the text preview height.
 */
const UNFOLDED_MEDIA_MSGTYPES: ReadonlySet<string> = new Set(['m.image', 'm.video']);

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

/** How long the note that a reaction could not be changed stays under its message. */
const REACTION_FAILURE_MS = 6000;

/**
 * The reaction chips under a message, and a note while a change to the user's own reaction has
 * just failed; renders nothing otherwise.
 */
function TimelineReactions({
  room,
  event,
  relations,
  failed,
  onReactionToggle,
}: {
  room: Room;
  event: MatrixEvent;
  relations: Relations | undefined;
  failed: boolean;
  onReactionToggle: ReactionToggle;
}) {
  const { t } = useTranslation();
  const eventId = event.getId();
  if (!eventId) return null;
  return (
    <>
      {relations && (
        <Reactions
          room={room}
          mEventId={eventId}
          targetEvent={event}
          canSendReaction
          relations={relations}
          onReactionToggle={onReactionToggle}
        />
      )}
      {failed && (
        <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
          {t('mindroomUi.messages.messageReactionActions.reactionFailed')}
        </Text>
      )}
    </>
  );
}

/**
 * Toggles the user's reaction `key` on `targetEventId`, and which message's reaction failed to
 * change last, for a few seconds. A failed change is undone locally by `sendReactionToggle`.
 */
const useReactionToggle = (room: Room, threadId: string | undefined) => {
  const client = useMatrixClient();
  const [failure, setFailure] = useState<{ eventId: string }>();
  useEffect(() => {
    if (!failure) return undefined;
    const timer = setTimeout(() => setFailure(undefined), REACTION_FAILURE_MS);
    return () => clearTimeout(timer);
  }, [failure]);
  const toggle = useCallback<ReactionToggle>(
    (targetEventId, key, shortcode, relations) => {
      sendReactionToggle(client, { room, threadId, targetEventId, key, shortcode, relations }).catch(
        () => setFailure({ eventId: targetEventId })
      );
    },
    [client, room, threadId]
  );
  return { toggle, failedEventId: failure?.eventId };
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
  // Reaction pickers offer the emoji of the room, its spaces and the homeserver's emoji room.
  const imagePackRooms = useImagePackRooms(room.roomId, useAtomValue(roomToParentsAtom));
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
    const activeThreadId = threadIdRef.current;
    if (activeThreadId) {
      const thread = room.getThread(activeThreadId);
      // The thread's own live timeline chain; the root may be stored apart from it.
      const events = thread?.liveTimeline
        ? getLinkedTimelines(thread.liveTimeline).flatMap((timeline) => timeline.getEvents())
        : [];
      const reply = [...events].reverse().find((event) => isEditableOwnMessage(client, event));
      if (reply) return reply;
      const root = thread?.rootEvent;
      return root && isEditableOwnMessage(client, root) ? root : undefined;
    }
    return [...room.getLiveTimeline().getEvents()]
      .reverse()
      .find((event) => isEditableOwnMessage(client, event));
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

  const { toggle: toggleReaction, failedEventId: reactionFailedEventId } = useReactionToggle(
    room,
    threadId
  );
  const useAuthentication = useMediaAuthentication();
  const { dateFormatString, hour24Clock, mediaAutoLoad, urlPreview, encUrlPreview } =
    useMessageDisplaySettings();
  // Encrypted rooms preview links only when the user allows it: the preview request reveals the
  // link to the homeserver.
  const showUrlPreview = room.hasEncryptionStateEvent?.() ? encUrlPreview : urlPreview;
  // Links show their site's icon under the same settings as previews, and only with media loading.
  const showLinkFavicons = shouldShowLinkFavicons(
    { mediaAutoLoad, urlPreview, encUrlPreview },
    !!room.hasEncryptionStateEvent?.()
  );
  // Matrix permalinks in a message open in the app: a person's profile card, or the room and
  // event (its thread, where the room shows threads) instead of matrix.to in a new tab.
  const handleMentionClick = useMentionClickHandler(room.roomId);
  const linkifyOpts = useMemo(
    () => ({
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention(
        (href) =>
          renderMatrixMention(
            client,
            room.roomId,
            href,
            makeMentionCustomProps(handleMentionClick)
          ),
        showLinkFavicons
      ),
    }),
    [client, handleMentionClick, room.roomId, showLinkFavicons]
  );
  const htmlReactParserOptions = useMemo(
    () =>
      getReactCustomHtmlParser(client, room.roomId, {
        linkifyOpts,
        handleMentionClick,
        useAuthentication,
        showLinkFavicons,
      }),
    [client, handleMentionClick, linkifyOpts, room.roomId, showLinkFavicons, useAuthentication]
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
  // The avatar or the name of a message opens the sender's profile card beside it.
  const openUserProfile = useOpenUserRoomProfile();
  const spaceRoomId = useSpaceOptionally()?.roomId;
  const handleSenderClick = useCallback(
    (evt: React.MouseEvent<HTMLElement>) => {
      const senderId = evt.currentTarget.getAttribute('data-user-id');
      if (!senderId) return;
      evt.stopPropagation();
      const cardAnchor = evt.currentTarget.getBoundingClientRect();
      openUserProfile(room.roomId, spaceRoomId, senderId, cardAnchor);
    },
    [openUserProfile, room.roomId, spaceRoomId]
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
      const kind = getTimelineMessageKind(event.getType());
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
          <MessageAside
            key={eventId}
            data-message-id={eventId}
            data-message-item={row.index}
            spaced
          >
            <MindroomThreadSummaryMarker summaryInfo={summaryInfo} plan={marker} />
          </MessageAside>
        );
      }

      const historyRecords =
        data.approvalTimeline.historyByResponseId.get(eventId) ??
        data.approvalTimeline.fallbackGroupsByEventId.get(eventId);
      // Approvals of a reply that is not loaded, such as a background job's, gather at the first
      // of them: its row shows that history, which lists its own receipt, instead of the card too.
      if (kind === 'approval' && historyRecords && historyRecords.length > 0) {
        return (
          <MessageAside key={eventId} data-message-id={eventId} data-message-item={row.index}>
            <ApprovalHistory records={historyRecords as never} />
          </MessageAside>
        );
      }
      const sendState = getSendStateEvent(event, editedEvent);
      const failedSend = sendState.status === EventStatus.NOT_SENT;
      const pendingSend = PENDING_SEND_STATUSES.has(sendState.status);
      // The footer of an open thread offers the actions for its own failed root.
      const showFailedActions = failedSend && !(threadId && eventId === threadId);
      const editable = kind === 'message';
      const msgType = typeof content.msgtype === 'string' ? content.msgtype : '';
      const collapseMode =
        UNFOLDED_MEDIA_MSGTYPES.has(msgType) || kind === 'sticker'
          ? 'always-expanded'
          : getCollapsibleMessageMode(
              eventId,
              content,
              liveExpansionIds,
              isMindroomAgentUserId(event.getSender() ?? undefined)
            );
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
        // The collapsible tool and output sections MindRoom attaches to a message.
        showMessageExtras: true,
        htmlReactParserOptions,
        linkifyOpts,
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
            data-message-item={row.index}
            room={room}
            mEvent={event}
            collapse={collapse}
            highlight={highlighted}
            edit={editable && editingEventId === eventId ? true : undefined}
            onEditId={editable ? setEditingEventId : undefined}
            canDelete={canDelete}
            canSendReaction={kind !== 'sticker'}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
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
                    failed={reactionFailedEventId === eventId}
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
            onUserClick={handleSenderClick}
            onUsernameClick={handleSenderClick}
            onReactionToggle={(key, shortcode) =>
              toggleReaction(eventId, key, shortcode, relations)
            }
            hideReadReceipts={hideActivity}
            hour24Clock={!!hour24Clock}
            dateFormatString={dateFormatString}
          >
            <div
              // Text bodies are only as wide as their text (`data-message-fold`, layout.css.ts).
              data-message-fold={
                collapseMode !== 'always-expanded' && TEXT_MSGTYPES.has(msgType) ? 'text' : 'block'
              }
            >
              <CollapsibleMessage
                expansionKey={eventId}
                collapseMode={collapseMode}
                forceOverflowing={shouldForceCollapsibleMessageOverflow(content)}
                measurementKey={getCollapsibleMessageMeasurementKey(
                  event,
                  collapseMode,
                  editedEvent
                )}
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
            </div>
          </Message>
          {historyRecords && historyRecords.length > 0 && (
            <MessageAside>
              <ApprovalHistory records={historyRecords as never} />
            </MessageAside>
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
      handleSenderClick,
      hideActivity,
      hour24Clock,
      htmlReactParserOptions,
      imagePackRooms,
      linkifyOpts,
      liveExpansionIds,
      mediaAutoLoad,
      messageLayout,
      messageSpacing,
      reactionFailedEventId,
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
        if (!NOTICE_STATE_EVENT_TYPES.has(event.getType())) return null;
        return (
          <Event
            key={eventId}
            data-message-id={eventId}
            data-message-item={row.index}
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
