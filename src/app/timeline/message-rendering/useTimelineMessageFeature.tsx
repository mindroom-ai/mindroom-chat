import React, {
  useCallback,
  useContext,
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
  type MatrixClient,
  type MatrixEvent,
  type Relations,
  type Room,
} from 'matrix-js-sdk';
import type { Editor } from 'slate';
import { ReactEditor } from 'slate-react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useImagePackRooms } from '../../emoji/useImagePackRooms';
import { useKeyDown } from '../../lib/hooks/useKeyDown';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { usePowerLevelsContext } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { useSpaceOptionally } from '../../matrix/hooks/useSpace';
import { useOpenUserRoomProfile } from '../../navigation/useUserRoomProfileState';
import { isEmptyEditor } from '../../editor/utils';
import { Reply } from '../../messages/reply/Reply';
import { MessageAside } from '../../messages/layout/MessageAside';
import { RenderMessageContent } from '../../messages/content/RenderMessageContent';
import { Reactions } from '../../messages/reactions/Reactions';
import { useDecryptionRepaint } from './useDecryptionRepaint';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../messages/html/react-custom-html-parser';
import { useMentionClickHandler } from '../../messages/useMentionClickHandler';
import { useSettingValue } from '../../preferences/useSettingValue';
import { useHour24Clock } from '../../preferences/useHour24Clock';
import { MessageLayout, settingsAtom, type Settings } from '../../preferences/settings';
import { composerReplyDraftAtom } from '../../composer/roomInputDrafts';
import { ConversationViewContext } from '../../navigation/conversationView';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import {
  canEditEvent,
  getEditedEvent,
  getEventReactions,
  getLatestMessageContent,
  getPendingEdits,
  hasUndecryptedNewerEdit,
} from '../../matrix/room';
import { MessageEvent } from '../../matrix/types/room';
import { MessageEditNotDecryptedContent } from '../../messages/content/FallbackContent';
import { Event, Message } from '../../messages/Message';
import { CollapsibleMessage, CollapsibleMessageStateProvider } from '../CollapsibleMessage';
import {
  getCollapsibleMessageMeasurementKey,
  getCollapsibleMessageMode,
  shouldForceCollapsibleMessageOverflow,
} from '../threadCollapsibleMessages';
import { useTimelineBulkExpansionAnchor } from '../useTimelineBulkExpansionAnchor';
import { isMindroomAgentUserId } from '../../matrix/protocol/agentIdentity';
import { FailedSendActions } from '../../messages/FailedSendActions';
import { toggleReaction as sendReactionToggle } from '../../messages/reactions/reactionToggle';
import { ApprovalHistory } from '../../approvals/ThreadApprovalControls';
import { ThreadSummaryMarker } from '../../messages/thread-summary/ThreadSummaryMarker';
import { getThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import { getToolApprovalRenderContent } from '../../matrix/protocol/toolApproval';
import { shouldShowLinkFavicons } from '../../rich-text/linkFaviconPolicy';
import { renderThreadBadge } from '../ThreadBadge';
import { buildRoomTimelineReplyDraft } from '../roomTimelineReplyDraft';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import { canPinRoomEvents } from '../../event-store/threads/threadPinning';
import { getLinkedTimelines } from '../../event-store/timeline/linkedTimelines';
import { genuineReplyEventId } from '../timelineRowFold';
import {
  getTimelineMessageKind,
  NOTICE_STATE_EVENT_TYPES,
  TEXT_MSGTYPES,
} from '../../event-store/timeline/timelineRowTypes';
import { LiveReplyMessageContent } from './LiveReplyMessageContent';
import type { ThreadRecord } from '../../event-store/threads/types';
import type { TimelineMessageData, TimelineMessageRow } from './types';

/**
 * The settings below come from the user's preferences; `hideActivity` keeps read receipts
 * private, so the rows show none either.
 */
type TimelineSettings = Pick<Settings, 'messageLayout' | 'messageSpacing' | 'hideActivity'>;

type UseTimelineMessageFeatureOptions = TimelineSettings & {
  room: Room;
  editor: Editor;
  threadId?: string;
  scrollRef: RefObject<HTMLDivElement>;
  showThreadRepliesInRoom: boolean;
};

/**
 * The user's latest text message among `events` (newest last), a long text sent as a file
 * included, when the server has confirmed it. While the latest is still sending there is none:
 * the message before it is not the one the user means, and an edit would overwrite it.
 */
const latestConfirmedOwnMessage = (
  client: MatrixClient,
  events: MatrixEvent[]
): MatrixEvent | undefined => {
  const latest = [...events].reverse().find((event) => canEditEvent(client, event));
  return latest && isConfirmedMatrixEventId(latest.getId()) ? latest : undefined;
};

/**
 * Whether the row quotes what it replies to: a genuine reply (not a thread fallback) to a message
 * that does not show right above it (`previousEventId`, from `foldTimelineRowContexts`).
 */
const shouldShowReply = (row: TimelineMessageRow): boolean => {
  const replyEventId = genuineReplyEventId(row.event);
  return replyEventId !== undefined && replyEventId !== row.previousEventId;
};

/**
 * Pictures and videos sit in a box of at most 400 by 300 pixels (MsgTypeRenderers) and open a
 * viewer on click, so they show whole instead of folding at the text preview height.
 */
const UNFOLDED_MEDIA_MSGTYPES: ReadonlySet<string> = new Set(['m.image', 'm.video']);

/**
 * Whether a room row starts a thread with at least one reply, which earns it the thread chip.
 * The record's count is the loaded replies once all of them are, and before that the larger of
 * the loaded replies and the server's `m.thread` count.
 */
export const hasThreadReplies = (record: ThreadRecord | undefined): boolean =>
  (record?.status.replyCount ?? 0) > 0;

/** The settings each message row reads; the row list re-renders when one changes. */
const useMessageDisplaySettings = () => ({
  dateFormatString: useSettingValue(settingsAtom, 'dateFormatString'),
  hour24Clock: useHour24Clock()[0],
  mediaAutoLoad: useSettingValue(settingsAtom, 'mediaAutoLoad'),
  urlPreview: useSettingValue(settingsAtom, 'urlPreview'),
  encUrlPreview: useSettingValue(settingsAtom, 'encUrlPreview'),
});

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
      sendReactionToggle(client, {
        room,
        threadId,
        targetEventId,
        key,
        shortcode,
        relations,
      }).catch(() => setFailure({ eventId: targetEventId }));
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

/** Lines a failed send's Not sent row and reason up with the end of an own bubble. */
const endAligned = { alignItems: 'flex-end' } as const;

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
      // The thread's own live timeline chain, after its root, which may be stored apart from it.
      const events = thread?.liveTimeline
        ? getLinkedTimelines(thread.liveTimeline).flatMap((timeline) => timeline.getEvents())
        : [];
      const root = thread?.rootEvent;
      return latestConfirmedOwnMessage(client, root ? [root, ...events] : events);
    }
    return latestConfirmedOwnMessage(client, room.getLiveTimeline().getEvents());
  }, [client, room]);

  // Up in an empty composer edits the user's latest message, as in most chat clients. The
  // composer is this timeline's own (they share the editor): another view of the room has its own.
  const editLatestOnArrowUp = useCallback(
    (evt: KeyboardEvent) => {
      if (evt.key !== 'ArrowUp') return;
      if (!ReactEditor.isFocused(editor)) return;
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
  // Links show their site's icon with previews and media loading on, never in encrypted rooms.
  const showLinkFavicons = shouldShowLinkFavicons(
    { mediaAutoLoad, urlPreview },
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

  const view = useContext(ConversationViewContext);
  const setReplyDraft = useSetAtom(composerReplyDraftAtom(room.roomId, view));
  const { navigateRoomThread } = useRoomNavigate();
  const handleReplyClick = useCallback(
    (replyEventId: string, startThread = false) => {
      const reply = buildRoomTimelineReplyDraft(room, replyEventId, startThread);
      if (!reply) return;
      setReplyDraft(reply.draft);
      if (startThread && threadIdRef.current !== reply.threadRootId) {
        navigateRoomThread(room.roomId, reply.threadRootId);
      }
      // The composer of this timeline, which shares its editor.
      ReactEditor.focus(editor);
    },
    [editor, navigateRoomThread, room, setReplyDraft]
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
      // A newer edit that could not be decrypted leaves this version shown, with a note; a row
      // that shows no readable version says so itself (P2-e2ee-F004).
      const editNotDecrypted =
        kind === 'message' &&
        (!!editedEvent || !event.isDecryptionFailure?.()) &&
        hasUndecryptedNewerEdit(eventId, event, row.timelineSet, editedEvent);
      renderedEventsRef.current?.push(...getPendingEdits(eventId, event, row.timelineSet));
      const content = (
        kind === 'approval'
          ? getToolApprovalRenderContent(event.getOriginalContent(), editedEvent?.getContent())
          : getLatestMessageContent(event, editedEvent)
      ) as Record<string, unknown>;
      const summaryInfo =
        threadId && kind === 'message' ? getThreadSummaryInfo(content) : undefined;
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
            <ThreadSummaryMarker summaryInfo={summaryInfo} plan={marker} />
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
      // In Bubble layout the reader's own messages, the only ones that fail to send, sit at the end.
      const bubbles = messageLayout === MessageLayout.Bubble;
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
      // The classic view shows thread replies in the room; each quotes its thread's root, and the
      // quote opens the thread.
      const threadQuoteRootId =
        !threadId && showThreadRepliesInRoom && !replyEventId && event.threadRootId !== eventId
          ? event.threadRootId
          : undefined;
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
      // Room rows show the thread they start under their reactions once it has a reply; a message
      // without one, resolved or not, shows none (Reply in Thread on its toolbar starts one). An
      // open thread shows none, and neither does the classic view, which shows the replies.
      const threadBadge =
        threadId || showThreadRepliesInRoom || !hasThreadReplies(data.threadRecordMap.get(eventId))
          ? null
          : renderThreadBadge({
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
              ) : threadQuoteRootId ? (
                <Reply
                  room={room}
                  replyEventId={threadQuoteRootId}
                  timelineSet={row.timelineSet}
                  onClick={() => navigateRoomThread(room.roomId, threadQuoteRootId)}
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
            hour24Clock={hour24Clock}
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
              {editNotDecrypted && (
                <div>
                  <MessageEditNotDecryptedContent />
                </div>
              )}
            </div>
          </Message>
          {historyRecords && historyRecords.length > 0 && (
            <MessageAside>
              <ApprovalHistory records={historyRecords as never} />
            </MessageAside>
          )}
          {showFailedActions && (
            // Lined up with the message body it belongs to, past the avatar column; under an own
            // bubble, which sits on the end side, with the bubble's end.
            <MessageAside end={bubbles}>
              <FailedSendActions
                room={room}
                event={sendState}
                style={bubbles ? endAligned : undefined}
              />
            </MessageAside>
          )}
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
      navigateRoomThread,
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
      return renderMessageRow(row, data);
    },
    [decryptions, messageSpacing, renderMessageRow, room]
  );

  // A thread has no expand-all toggle, so its long messages fold as usual whatever the room's is.
  const expansionBaseline = threadId ? false : expandAll;
  const wrapExpansion = useCallback(
    (node: ReactNode) => (
      <CollapsibleMessageStateProvider
        expandAllInit={expansionBaseline}
        manualExpansionState={manualExpansionState}
        onExpansionLayoutChange={restoreExpansionAnchor}
      >
        {node}
      </CollapsibleMessageStateProvider>
    ),
    [expansionBaseline, manualExpansionState, restoreExpansionAnchor]
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
