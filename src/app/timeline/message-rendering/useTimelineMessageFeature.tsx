import React, {
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Text, color, config, toRem } from 'folds';
import {
  EventStatus,
  type EventTimelineSet,
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
import { usePowerLevelsContext } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { useRoomThreadMode } from '../../matrix/hooks/useRoomThreadMode';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { RoomSettingsPage } from '../../navigation/roomSettingsState';
import { useOpenRoomSettings } from '../../navigation/useRoomSettingsState';
import { isEmptyEditor } from '../../editor/utils';
import { Reply } from '../../messages/reply/Reply';
import { MessageAside } from '../../messages/layout/MessageAside';
import { RenderMessageContent } from '../../messages/content/RenderMessageContent';
import { hasTextFilePreview } from '../../messages/content/MsgTypeRenderers';
import { VoiceTranscript, VoiceTranscriptPending } from '../../messages/content/VoiceTranscript';
import { ReplyCards } from '../../messages/content/ReplyCards';
import { ModelChangeMarker } from '../../messages/ModelChangeMarker';
import { RenderBody } from '../../messages/content/RenderBody';
import { Reactions } from '../../messages/reactions/Reactions';
import { useDecryptionRepaint } from './useDecryptionRepaint';
import { useRoomMessageRenderers } from './useRoomMessageRenderers';
import { getRoomEventThreadOpenTarget } from '../../routes/roomDeepLink';
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
import { getLongTextMxcUri } from '../../matrix/protocol/longText';
import { MessageEditNotDecryptedContent } from '../../messages/content/FallbackContent';
import { Event, Message } from '../../messages/Message';
import { getReplyTiming } from '../../messages/replyTiming';
import { CollapsibleMessage, CollapsibleMessageStateProvider } from '../CollapsibleMessage';
import {
  getCollapsibleMessageMeasurementKey,
  getCollapsibleMessageMode,
  shouldForceCollapsibleMessageOverflow,
} from '../threadCollapsibleMessages';
import { useTimelineBulkExpansionAnchor } from '../useTimelineBulkExpansionAnchor';
import {
  isMindroomAgentUserId,
  isMindroomAgentUserIdForViewer,
} from '../../matrix/protocol/agentIdentity';
import { FailedSendActions } from '../../messages/FailedSendActions';
import { toggleReaction as sendReactionToggle } from '../../messages/reactions/reactionToggle';
import { ApprovalHistory } from '../../approvals/ThreadApprovalControls';
import { ThreadSummaryMarker } from '../../messages/thread-summary/ThreadSummaryMarker';
import { getThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import { readAgentNoticeMarker } from '../../messages/agentNoticeMarker';
import { SnoozeEndedMarker } from '../../messages/SnoozeEndedMarker';
import { TriggerWakeMarker } from '../../messages/TriggerWakeMarker';
import { TodoPokeMarker } from '../../messages/TodoPokeMarker';
import { CompactionNoticeSeam } from '../../messages/agent-run/CompactionSeam';
import { getToolApprovalRenderContent } from '../../matrix/protocol/toolApproval';
import { renderThreadBadge } from '../ThreadBadge';
import { buildRoomTimelineReplyDraft } from '../roomTimelineReplyDraft';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import { forkTargetFor, type ThreadForkRef } from '../../event-store/threads/threadFork';
import { forkPrefixThreadId, rowEditTimelineSet, rowEventRoom } from '../forkPrefixTimelineSet';
import { useStartThreadFork } from '../../threads/fork/useStartThreadFork';
import { ForkToRoomDialog } from '../../threads/fork/ForkToRoomDialog';
import { ThreadForksChip } from '../../threads/fork/ThreadForksChip';
import { useThreadForks } from '../../threads/fork/useThreadForks';
import { canPinRoomEvents } from '../../event-store/threads/threadPinning';
import { getLinkedTimelines } from '../../event-store/timeline/linkedTimelines';
import { genuineReplyEventId } from '../timelineRowFold';
import {
  getTimelineMessageKind,
  NOTICE_STATE_EVENT_TYPES,
  TEXT_MSGTYPES,
} from '../../event-store/timeline/timelineRowTypes';
import { clearBulkExpansionOverrides } from '../../messages/manualExpansionState';
import { LiveReplyMessageContent } from './LiveReplyMessageContent';
import type { ThreadRecord } from '../../event-store/threads/types';
import type { QuietMarkerData, TimelineMessageData, TimelineMessageRow } from './types';

/**
 * The settings below come from the user's preferences; `hideActivity` keeps read receipts
 * private, so the rows show none either.
 */
type TimelineSettings = Pick<Settings, 'messageLayout' | 'messageSpacing' | 'hideActivity'>;

type UseTimelineMessageFeatureOptions = TimelineSettings & {
  room: Room;
  /** In a cross-room fork draft, the destination room that "Fork from here" targets. */
  forkTargetRoom?: Room;
  editor: Editor;
  threadId?: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  showThreadRepliesInRoom: boolean;
  /** Persistent expansion choices shared across room surface switches (`useTimelineExpansionState`). */
  expansionState?: TimelineExpansionState;
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
  relations?: Relations,
  resend?: boolean
) => Promise<boolean>;

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
  canSendReaction,
  onReactionToggle,
}: {
  room: Room;
  event: MatrixEvent;
  relations: Relations | undefined;
  failed: boolean;
  /** Off for a row read-only here, whose chips (an agent question's answers too) do not react. */
  canSendReaction: boolean;
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
          canSendReaction={canSendReaction}
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
    (targetEventId, key, shortcode, relations, resend) => {
      return sendReactionToggle(client, {
        room,
        threadId,
        targetEventId,
        key,
        shortcode,
        relations,
        resend,
      }).then(
        () => true,
        () => {
          setFailure({ eventId: targetEventId });
          return false;
        }
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

/** Persistent message expansion choices and live-arrival auto-expand state. */
export const useTimelineExpansionState = () => {
  const liveExpansion = useLiveExpansion();
  const manualExpansionState = useRef(new Map<string, boolean>()).current;
  const [expandAll, setExpandAll] = useState(false);
  const toggleExpandAll = useCallback(() => {
    // The new baseline replaces every outer fold choice while preserving inner reply disclosures.
    clearBulkExpansionOverrides(manualExpansionState);
    setExpandAll((current) => !current);
  }, [manualExpansionState]);
  return { liveExpansion, manualExpansionState, expandAll, setExpandAll, toggleExpandAll };
};

export type TimelineExpansionState = ReturnType<typeof useTimelineExpansionState>;

/** Lines a failed send's Not sent row and reason up with the end of an own bubble. */
const endAligned = { alignItems: 'flex-end' } as const;

/**
 * A run of quiet markers side by side. A skill review shrinks to its basis, its name ending in an
 * ellipsis (its card shows it in full), before the run wraps: two markers share a phone's line,
 * a third goes to the next one.
 */
const quietRunStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  columnGap: config.space.S400,
  rowGap: config.space.S100,
} as const;
/** The title marker's words are fixed and short: it keeps them whole. */
const fixedQuietRunItemStyle = { flex: 'none' } as const;
/** Room for a skill review's icon and fixed words, with the start of its name. */
const shrinkingQuietRunItemStyle = {
  flex: `1 1 ${toRem(128)}`,
  minWidth: 0,
  maxWidth: 'max-content',
} as const;
/**
 * Quiet markers that never show beside others. A snooze ending's note, cut short, has no card to
 * read; a compaction notice is a seam, a full-width rule across the thread; a model change or
 * trigger wake opens its details under its line.
 */
const OWN_ROW_MARKERS: ReadonlySet<unknown> = new Set([
  SnoozeEndedMarker,
  CompactionNoticeSeam,
  ModelChangeMarker,
  TriggerWakeMarker,
  TodoPokeMarker,
]);
const quietRunItemStyle = (node: ReactNode) =>
  isValidElement(node) && node.type === ThreadSummaryMarker
    ? fixedQuietRunItemStyle
    : shrinkingQuietRunItemStyle;

/**
 * Inside a thread, the thread's title, its applied model changes and the backend's snooze-ended,
 * skill review and compaction notices render as one quiet line, not as an agent's reply: no
 * avatar, name or toolbar. A title shows only where the thread's summary plan marks it and a
 * model change only where its plan pairs the acknowledgement with its command (`planModelChanges`);
 * the others only from a MindRoom agent. A compaction notice started when its event was sent.
 */
const readQuietMarker = (
  eventId: string,
  event: MatrixEvent,
  content: Record<string, unknown>,
  data: QuietMarkerData,
  room: Room,
  viewerId: string | undefined,
  onOpenTitleSettings?: () => void
): ReactNode | null => {
  const modelChange = data.modelChanges.byAckId.get(eventId);
  if (modelChange) {
    return <ModelChangeMarker change={modelChange} room={room} ts={event.getTs()} />;
  }
  const summaryInfo = getThreadSummaryInfo(content);
  const plan = summaryInfo && data.threadSummaryTimeline.markersByEventId.get(eventId);
  if (summaryInfo && plan) {
    return (
      <ThreadSummaryMarker
        summaryInfo={summaryInfo}
        plan={plan}
        onOpenSettings={onOpenTitleSettings}
      />
    );
  }
  const sender = event.getSender() ?? undefined;
  if (!isMindroomAgentUserIdForViewer(sender, viewerId)) return null;
  const senderDisplayName = sender ? room.getMember?.(sender)?.name : undefined;
  return readAgentNoticeMarker(content, event.getTs(), room.roomId, senderDisplayName);
};

/**
 * How the room and thread timelines render one message row: edit state, reply quotes, collapse,
 * approvals, summary markers and failed sends; plus Up-arrow editing of the user's last message.
 */
export const useTimelineMessageFeature = ({
  room,
  forkTargetRoom,
  editor,
  threadId,
  scrollRef,
  showThreadRepliesInRoom,
  hideActivity,
  messageLayout,
  messageSpacing,
  expansionState,
}: UseTimelineMessageFeatureOptions) => {
  const client = useMatrixClient();
  // Reaction pickers offer the emoji of the room, its spaces and the homeserver's emoji room.
  const imagePackRooms = useImagePackRooms(room.roomId, useAtomValue(roomToParentsAtom));
  const [editingEventId, setEditingEventId] = useState<string>();
  const internalExpansionState = useTimelineExpansionState();
  const { liveExpansion, manualExpansionState, expandAll, toggleExpandAll } =
    expansionState ?? internalExpansionState;
  const { mark: markLiveExpansionCandidate, consume: consumeLiveExpansion } = liveExpansion;
  const liveExpansionIds = liveExpansion.ids;
  const restoreExpansionAnchor = useTimelineBulkExpansionAnchor(expandAll, scrollRef);
  const renderedEventsRef = useRef<MatrixEvent[]>([]);
  renderedEventsRef.current = [];
  const openRoomSettings = useOpenRoomSettings();
  const openTitleSettings = useCallback(
    () => openRoomSettings(room.roomId, RoomSettingsPage.MindroomPage),
    [openRoomSettings, room.roomId]
  );

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
  const { dateFormatString, hour24Clock, mediaAutoLoad, urlPreview, encUrlPreview } =
    useMessageDisplaySettings();
  const getRoomRenderers = useRoomMessageRenderers({
    client,
    roomId: room.roomId,
    mediaAutoLoad,
    urlPreview,
    encUrlPreview,
  });

  const view = useContext(ConversationViewContext);
  const setReplyDraft = useSetAtom(composerReplyDraftAtom(room.roomId, view));
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const startFork = useStartThreadFork(room);
  const forkDestRoom = forkTargetRoom ?? room;
  const [forkToRoomTarget, setForkToRoomTarget] = useState<{
    sourceRoom: Room;
    ref: ThreadForkRef;
  }>();
  // Where agents answer in the room, they answer a fork there too, and it stays empty.
  const forksAnswered = useRoomThreadMode(forkDestRoom.roomId, !!threadId) !== 'room';
  const forksByPoint = useThreadForks(room, threadId);
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
  // A thread badge under a room row opens its thread.
  const handleOpenThread = useCallback(
    (evt: React.MouseEvent) => {
      const rootId = (evt.currentTarget as HTMLElement).getAttribute('data-thread-root-id');
      if (rootId) navigateRoomThread(room.roomId, rootId);
    },
    [navigateRoomThread, room.roomId]
  );

  /**
   * The quiet marker line a row renders as (`readQuietMarker`), or null. Reads the content the row
   * shows, edits included, as `renderMessageRow` does.
   */
  const readRowQuietMarker = useCallback(
    (
      event: MatrixEvent,
      data: QuietMarkerData,
      rowTimelineSet: EventTimelineSet,
      onOpenTitleSettings?: () => void
    ): ReactNode | null => {
      if (!threadId || getTimelineMessageKind(event.getType()) !== 'message') return null;
      const eventId = event.getId() ?? '';
      const prefixThreadId = forkPrefixThreadId(event, eventId, data.forkPrefixEventIds);
      const eventRoom = rowEventRoom(client, room, event, prefixThreadId);
      const timelineSet = rowEditTimelineSet(eventRoom, prefixThreadId, rowTimelineSet);
      const editedEvent = getEditedEvent(eventId, event, timelineSet);
      const content = getLatestMessageContent(event, editedEvent) as Record<string, unknown>;
      return readQuietMarker(
        eventId,
        event,
        content,
        data,
        eventRoom,
        userId ?? undefined,
        prefixThreadId !== undefined ? undefined : onOpenTitleSettings
      );
    },
    [client, room, threadId, userId]
  );

  /** The row of a message, approval, sticker or undecryptable event. */
  const renderMessageRow = useCallback(
    (row: TimelineMessageRow, data: TimelineMessageData): ReactNode | null => {
      const { event, eventId, collapse, highlighted } = row;
      const kind = getTimelineMessageKind(event.getType());
      if (!kind) return null;

      // A fork shows its parent's messages before its own. They stay the parent's: read-only
      // here, their cards answer in the parent's thread and their reactions are read there.
      const prefixThreadId = forkPrefixThreadId(event, eventId, data.forkPrefixEventIds);
      const readOnly = prefixThreadId !== undefined;
      const eventRoom = rowEventRoom(client, room, event, prefixThreadId);
      const isCrossRoomRow = eventRoom.roomId !== room.roomId;
      const timelineSet = rowEditTimelineSet(eventRoom, prefixThreadId, row.timelineSet);
      const editedEvent = getEditedEvent(eventId, event, timelineSet);
      // A newer edit that could not be decrypted leaves this version shown, with a note; a row
      // that shows no readable version says so itself (P2-e2ee-F004).
      const editNotDecrypted =
        kind === 'message' &&
        (!!editedEvent || !event.isDecryptionFailure?.()) &&
        hasUndecryptedNewerEdit(eventId, event, timelineSet, editedEvent);
      renderedEventsRef.current?.push(...getPendingEdits(eventId, event, timelineSet));
      const content = (
        kind === 'approval'
          ? getToolApprovalRenderContent(event.getOriginalContent(), editedEvent?.getContent())
          : getLatestMessageContent(event, editedEvent)
      ) as Record<string, unknown>;
      const quietMarker =
        threadId && kind === 'message'
          ? readQuietMarker(
              eventId,
              event,
              content,
              data,
              eventRoom,
              userId ?? undefined,
              readOnly ? undefined : openTitleSettings
            )
          : null;
      if (quietMarker) {
        // A model change's line stands for its hidden command too, so it repaints when the
        // command, or an edit of it into another message, decrypts.
        const command = data.modelChanges.byAckId.get(eventId)?.command;
        if (command) {
          renderedEventsRef.current?.push(
            command,
            ...getPendingEdits(command.getId() ?? '', command, timelineSet)
          );
        }
        // The run's later markers fold into this row, beside it, each keeping its own ID. A lone
        // marker keeps the same elements, so one that a new marker joins stays mounted.
        const later = (row.quietRun ?? []).flatMap((marker) => {
          const markerPrefixThreadId = forkPrefixThreadId(
            marker.event,
            marker.eventId,
            data.forkPrefixEventIds
          );
          const markerRoom = rowEventRoom(client, room, marker.event, markerPrefixThreadId);
          renderedEventsRef.current?.push(
            marker.event,
            ...getPendingEdits(
              marker.eventId,
              marker.event,
              rowEditTimelineSet(markerRoom, markerPrefixThreadId, marker.timelineSet)
            )
          );
          const node = readRowQuietMarker(
            marker.event,
            data,
            marker.timelineSet,
            markerPrefixThreadId !== undefined ? undefined : openTitleSettings
          );
          return node ? [{ eventId: marker.eventId, node }] : [];
        });
        const markers = [{ eventId, node: quietMarker }, ...later];
        const inRun = markers.length > 1;
        return (
          <MessageAside key={eventId} data-message-item={row.index} spaced>
            <div
              style={inRun ? quietRunStyle : undefined}
              data-quiet-marker-run={inRun ? 'true' : undefined}
            >
              {markers.map((marker) => (
                <div
                  key={marker.eventId}
                  data-message-id={marker.eventId}
                  style={inRun ? quietRunItemStyle(marker.node) : undefined}
                >
                  {marker.node}
                </div>
              ))}
            </div>
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
            <ApprovalHistory records={historyRecords} />
          </MessageAside>
        );
      }
      const sendState = getSendStateEvent(event, editedEvent);
      const failedSend = sendState.status === EventStatus.NOT_SENT;
      const pendingSend = PENDING_SEND_STATUSES.has(sendState.status);
      // The footer of an open thread offers the actions for its own failed root. A read-only row
      // offers none: its failed send is the parent thread's.
      const showFailedActions = failedSend && !readOnly && !(threadId && eventId === threadId);
      // In Bubble layout the reader's own messages, the only ones that fail to send, sit at the end.
      const bubbles = messageLayout === MessageLayout.Bubble;
      const editable = kind === 'message' && !readOnly;
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
      // A text drawer owns its fold; keep the message fold on its caption, not the whole file.
      const foldCaptionOnly =
        collapseMode !== 'always-expanded' &&
        msgType === 'm.file' &&
        !getLongTextMxcUri(content) &&
        hasTextFilePreview(content);
      const wrapInFold = (children: ComponentProps<typeof CollapsibleMessage>['children']) => (
        <CollapsibleMessage
          expansionKey={eventId}
          collapseMode={collapseMode}
          forceOverflowing={shouldForceCollapsibleMessageOverflow(content)}
          measurementKey={getCollapsibleMessageMeasurementKey(event, collapseMode, editedEvent)}
          onInitialExpandConsumed={() => consumeLiveExpansion(eventId)}
        >
          {children}
        </CollapsibleMessage>
      );
      const isAgentReply = isMindroomAgentUserIdForViewer(
        event.getSender() ?? undefined,
        userId ?? undefined
      );
      const replyEventId =
        kind !== 'sticker' && shouldShowReply(row) ? event.replyEventId : undefined;
      // The classic view shows thread replies in the room; each quotes its thread's root, and the
      // quote opens the thread.
      const threadQuoteRootId =
        !threadId && showThreadRepliesInRoom && !replyEventId && event.threadRootId !== eventId
          ? event.threadRootId
          : undefined;
      const {
        encrypted: eventEncrypted,
        showUrlPreview: eventShowUrlPreview,
        linkifyOpts: rowLinkifyOpts,
        htmlReactParserOptions: rowHtmlReactParserOptions,
        openSenderProfile,
      } = getRoomRenderers(eventRoom);
      const contentProps = {
        mEvent: event,
        eventId,
        // Approval cards send their responses to this room and thread.
        roomId: eventRoom.roomId,
        threadId: prefixThreadId ?? threadId ?? event.threadRootId,
        readOnly,
        displayName:
          eventRoom.getMember?.(event.getSender() ?? '')?.name ?? event.getSender() ?? '',
        msgType,
        eventType: event.getType(),
        ts: event.getTs(),
        edited: !!editedEvent || !!event.replacingEvent(),
        pendingSend,
        failedSend,
        getContent: (() => content) as <T>() => T,
        mediaAutoLoad: !!mediaAutoLoad,
        autoPreview: Boolean(mediaAutoLoad),
        wrapFileCaption: foldCaptionOnly ? wrapInFold : undefined,
        urlPreview: !!eventShowUrlPreview,
        htmlReactParserOptions: rowHtmlReactParserOptions,
        linkifyOpts: rowLinkifyOpts,
      };
      const Content = isAgentReply ? LiveReplyMessageContent : RenderMessageContent;
      const renderContent = (hydrateLongText: boolean) => (
        <Content {...contentProps} hydrateLongText={hydrateLongText} />
      );
      // A voice message's echo shows under it, as its latest version says.
      const voiceEcho = data.voiceTranscripts.byVoiceId.get(eventId);
      const voiceEchoId = voiceEcho?.getId() ?? '';
      if (voiceEcho) {
        renderedEventsRef.current?.push(
          voiceEcho,
          ...getPendingEdits(voiceEchoId, voiceEcho, timelineSet)
        );
      }
      const voiceTranscript = voiceEcho ? (
        <VoiceTranscript
          content={getLatestMessageContent(
            voiceEcho,
            getEditedEvent(voiceEchoId, voiceEcho, timelineSet)
          )}
          senderName={
            eventRoom.getMember?.(voiceEcho.getSender() ?? '')?.name ?? voiceEcho.getSender() ?? ''
          }
          renderBody={({ body, customBody }) => (
            <RenderBody
              body={body}
              customBody={customBody}
              linkifyOpts={rowLinkifyOpts}
              htmlReactParserOptions={rowHtmlReactParserOptions}
            />
          )}
        />
      ) : data.voiceTranscripts.pendingVoiceIds.has(eventId) ? (
        <VoiceTranscriptPending />
      ) : null;
      const cards = data.replyCards?.byReply.get(eventId);
      cards?.forEach(
        (card) => 'canvas' in card && renderedEventsRef.current?.push(card.canvas.event)
      );
      const relations = getEventReactions(timelineSet, eventId);
      const canDelete =
        !readOnly &&
        canSendRedaction &&
        !event.isRedacted() &&
        (event.getSender() === userId || canRedactOthers);
      const canSendReaction = !readOnly && kind !== 'sticker';
      // Inside a thread a message can start a fork, also one from a parent shown in a fork: that
      // forks its own thread. Never downgrade an encrypted source into an unencrypted destination.
      const canForkIntoDestRoom =
        eventRoom.roomId === forkDestRoom.roomId ||
        !eventEncrypted ||
        !!forkDestRoom.hasEncryptionStateEvent?.();
      const messageForkTarget = threadId ? forkTargetFor(event, room.roomId) : undefined;
      const forkTarget =
        messageForkTarget && forksAnswered && canForkIntoDestRoom ? messageForkTarget : undefined;
      // The forks made at this message, under it in the thread they were forked from: not on the
      // parent's rows shown in a fork, where they would repeat the chip the parent's own view shows.
      const forks = readOnly ? undefined : forksByPoint.get(eventId);
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
            room={eventRoom}
            mEvent={event}
            collapse={collapse}
            highlight={highlighted}
            edit={editable && editingEventId === eventId ? true : undefined}
            onEditId={editable ? setEditingEventId : undefined}
            canDelete={canDelete}
            canSendReaction={canSendReaction}
            canPinEvent={!readOnly && canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={relations}
            reply={
              replyEventId ? (
                <Reply
                  room={eventRoom}
                  replyEventId={replyEventId}
                  threadRootId={event.threadRootId}
                  timelineSet={timelineSet}
                  hideThreadIndicator={!!threadId}
                  data-event-id={replyEventId}
                  onClick={
                    isCrossRoomRow && !data.forkPrefixEventIds?.has(replyEventId)
                      ? () => {
                          const target = getRoomEventThreadOpenTarget({
                            eventId: replyEventId,
                            room: eventRoom,
                            linkedTimelines: timelineSet.getTimelines?.(),
                          });
                          if (target) {
                            navigateRoomThread(eventRoom.roomId, target.threadId, target.eventId);
                            return;
                          }
                          navigateRoom(eventRoom.roomId, replyEventId);
                        }
                      : data.handleOpenReply
                  }
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
                    room={eventRoom}
                    event={event}
                    relations={relations}
                    failed={reactionFailedEventId === eventId}
                    canSendReaction={canSendReaction}
                    onReactionToggle={toggleReaction}
                  />
                  {forks && <ThreadForksChip room={room} forks={forks} />}
                  {threadBadge}
                </>
              ) : undefined
            }
            resolvedMessageContent={content}
            replyTiming={
              kind === 'message' && isMindroomAgentUserId(event.getSender() ?? undefined)
                ? getReplyTiming(event.getTs(), content, editedEvent)
                : undefined
            }
            messageLayout={messageLayout}
            messageSpacing={messageSpacing}
            onReplyClick={readOnly ? undefined : handleReplyClick}
            canReplyInThread={!threadId}
            onOpenInOriginalThread={
              prefixThreadId
                ? () => navigateRoomThread(eventRoom.roomId, prefixThreadId, eventId)
                : undefined
            }
            onForkClick={
              forkTarget
                ? () =>
                    forkTargetRoom
                      ? startFork(forkTarget, forkTargetRoom.roomId)
                      : startFork(forkTarget)
                : undefined
            }
            onForkToRoomClick={
              messageForkTarget
                ? () => setForkToRoomTarget({ sourceRoom: eventRoom, ref: messageForkTarget })
                : undefined
            }
            onUserClick={openSenderProfile}
            onUsernameClick={openSenderProfile}
            onReactionToggle={
              readOnly
                ? undefined
                : (key, shortcode) => void toggleReaction(eventId, key, shortcode, relations)
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
              {foldCaptionOnly
                ? renderContent(true)
                : wrapInFold(({ loadFullContent }) => renderContent(loadFullContent))}
              {voiceTranscript}
              {cards && <ReplyCards cards={cards} />}
              {editNotDecrypted && (
                <div>
                  <MessageEditNotDecryptedContent />
                </div>
              )}
            </div>
          </Message>
          {historyRecords && historyRecords.length > 0 && (
            <MessageAside>
              <ApprovalHistory records={historyRecords} />
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
      forkDestRoom,
      forkTargetRoom,
      forksAnswered,
      forksByPoint,
      getRoomRenderers,
      handleOpenThread,
      handleReplyClick,
      hideActivity,
      hour24Clock,
      imagePackRooms,
      liveExpansionIds,
      mediaAutoLoad,
      messageLayout,
      messageSpacing,
      navigateRoom,
      navigateRoomThread,
      openTitleSettings,
      reactionFailedEventId,
      readRowQuietMarker,
      room,
      client,
      showThreadRepliesInRoom,
      startFork,
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

  /**
   * Whether a row renders as a quiet marker line (`readQuietMarker`), for the reply quotes of the
   * rows below it (timelineRowFold). Reads the content the row shows, edits included, as
   * `renderMessageRow` does.
   */
  const isQuietMarkerRow = useCallback(
    (event: MatrixEvent, data: QuietMarkerData, rowTimelineSet: EventTimelineSet): boolean =>
      readRowQuietMarker(event, data, rowTimelineSet) !== null,
    [readRowQuietMarker]
  );

  /**
   * Of the quiet marker rows, those that show beside the markers around them (timelineRowFold).
   * A snooze ending and a compaction notice keep their own row (`OWN_ROW_MARKERS`).
   */
  const joinsQuietMarkerRun = useCallback(
    (event: MatrixEvent, data: QuietMarkerData, rowTimelineSet: EventTimelineSet): boolean => {
      const node = readRowQuietMarker(event, data, rowTimelineSet);
      return node !== null && !(isValidElement(node) && OWN_ROW_MARKERS.has(node.type));
    },
    [readRowQuietMarker]
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

  const forkToRoomDialog = forkToRoomTarget ? (
    <ForkToRoomDialog
      sourceRoom={forkToRoomTarget.sourceRoom}
      onSelect={(targetRoomId) => {
        const { ref } = forkToRoomTarget;
        setForkToRoomTarget(undefined);
        startFork(ref, targetRoomId);
      }}
      onClose={() => setForkToRoomTarget(undefined)}
    />
  ) : null;

  return {
    renderEvent,
    rowRepaintRevision: decryptions,
    isQuietMarkerRow,
    joinsQuietMarkerRun,
    forksByPoint,
    forkToRoomDialog,
    wrapExpansion,
    markLiveExpansionCandidate,
    editingEventId,
    expandAll,
    toggleExpandAll,
  };
};
