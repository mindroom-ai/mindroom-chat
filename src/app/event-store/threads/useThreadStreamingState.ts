import { MatrixEvent, Room } from 'matrix-js-sdk';
import type { Relations } from 'matrix-js-sdk/lib/models/relations';
import {
  ACTIVE_STREAM_STATUSES,
  TERMINAL_STREAM_STATUSES,
  getAiRunInfo,
  hasTerminalStreamMetadata,
  readOwnStreamStatus,
  readStreamStatus,
} from '../../matrix/protocol/aiRun';
import { STOP_REACTION_KEYS } from '../../matrix/protocol/stopReaction';
import {
  getShallowSerializedReplacementEvent,
  isSameSenderEditEvent,
} from '../../matrix/editEvent';
import { useRoomActiveRuns } from '../../matrix/hooks/useRoomActiveRuns';
import { roomActiveRuns } from '../../matrix/protocol/activeRunsContract';
import { getActiveAnnotationsByKey } from '../../matrix/protocol/reactionAnnotations';
import { getEditedEvent, getEventReactions, getLatestMessageContent } from '../../matrix/room';
import { DEFAULT_THREAD_TAIL_EVENT_COUNT, getThreadTailEvents } from '../../matrix/thread';
import { getFinishingEdit, hasStreamEnded } from '../../matrix/client/syncedEdits';

const getPreferredEventContent = (
  mEvent: MatrixEvent,
  timelineSet?: ReturnType<Room['getUnfilteredTimelineSet']>
): Record<string, unknown> => {
  const replacingEventCandidate = mEvent.replacingEvent() ?? undefined;
  // Every record rebuild checks the tail of every thread, so copy only what
  // getEditedEvent writes to instead of deep-copying each bundled edit.
  const serializedReplacementCandidate = getShallowSerializedReplacementEvent(mEvent);
  const hasResolvableReplacement =
    isSameSenderEditEvent(mEvent, replacingEventCandidate) ||
    isSameSenderEditEvent(mEvent, serializedReplacementCandidate);

  if (!hasResolvableReplacement || !timelineSet) {
    return mEvent.getContent() ?? {};
  }

  const eventId = mEvent.getId();
  // Reuse the detached bundle from the eligibility check. The shared resolver
  // still owns ordering, sender validation and metadata fallbacks.
  const editedEvent =
    eventId && timelineSet
      ? getEditedEvent(eventId, mEvent, timelineSet, serializedReplacementCandidate)
      : undefined;

  return getLatestMessageContent(mEvent, editedEvent);
};

const hasStopReaction = (relations: Relations | undefined): boolean =>
  getActiveAnnotationsByKey(relations).some(
    ([key, events]) => STOP_REACTION_KEYS.has(key) && events.size > 0
  );

export const getThreadStreamingEvents = (
  room: Room | undefined,
  threadRootId: string | undefined
): MatrixEvent[] => {
  if (!room || !threadRootId) return [];

  const thread = room.getThread(threadRootId);
  return getThreadTailEvents(thread, DEFAULT_THREAD_TAIL_EVENT_COUNT);
};

export const isEventStreaming = (
  mEvent: MatrixEvent,
  relations: Relations | undefined,
  timelineSet: ReturnType<Room['getUnfilteredTimelineSet']>
): boolean => {
  const content = getPreferredEventContent(mEvent, timelineSet);
  const streamStatus = readStreamStatus(content);
  // A status the shown edit carries itself takes precedence over a run status of 'streaming',
  // which a stop or error note borrows; a status it borrowed from an older edit does not, so an
  // older finish or approval pause does not veto a retry that says by its run status that it
  // streams (`readOwnStreamStatus`).
  const ownStreamStatus = readOwnStreamStatus(content);
  if (ownStreamStatus === 'approval_pending') {
    return false;
  }

  const aiRunStatus = getAiRunInfo(content)?.status?.toLowerCase();
  if (
    aiRunStatus === 'streaming' &&
    !(ownStreamStatus && TERMINAL_STREAM_STATUSES.has(ownStreamStatus))
  ) {
    return true;
  }

  // hasTerminalStreamMetadata owns the ai_run terminal set (which
  // includes 'cached' — NOT in TERMINAL_STREAM_STATUSES) plus string-form
  // stream statuses; the local check only adds the record-form fallback.
  // Diverging here wedges a permanent spinner while the stop chip (gated on
  // the shared helper) is hidden.
  // A device without the room's keys reads the finishing edit's status in the clear, and a
  // redacted finishing edit still ended the stream.
  const terminalMetadata =
    hasTerminalStreamMetadata(content) ||
    (streamStatus && TERMINAL_STREAM_STATUSES.has(streamStatus)) ||
    !!getFinishingEdit(mEvent) ||
    hasStreamEnded(mEvent);

  if (streamStatus === 'approval_pending' || terminalMetadata) {
    return false;
  }

  if (hasStopReaction(relations)) {
    return true;
  }

  return !!streamStatus && ACTIVE_STREAM_STATUSES.has(streamStatus);
};

/** Whether any agent reports an active run for `threadRootId` in `io.mindroom.active_runs`. */
export const getThreadStreamingState = (
  room: Room | undefined,
  threadRootId: string | undefined
): boolean => !!room && !!threadRootId && roomActiveRuns(room).threads.has(threadRootId);

/** The replies of the thread's tail that stream now, whose tool traces say what they run. */
export const getThreadStreamingReplies = (
  room: Room | undefined,
  threadRootId: string | undefined
): MatrixEvent[] => {
  const trackedEvents = getThreadStreamingEvents(room, threadRootId);
  if (!room || !threadRootId || trackedEvents.length === 0) return [];
  const thread = room.getThread(threadRootId);
  const timelineSet = thread?.getUnfilteredTimelineSet?.() ?? room.getUnfilteredTimelineSet();
  return trackedEvents.filter((mEvent) => {
    const eventId = mEvent.getId();
    const relations = eventId ? getEventReactions(timelineSet, eventId) : undefined;
    return isEventStreaming(mEvent, relations, timelineSet);
  });
};

/** Live thread-level working state from `io.mindroom.active_runs`. */
export const useThreadStreamingState = (
  room: Room | undefined,
  threadRootId: string | undefined
): boolean => {
  const { threads } = useRoomActiveRuns(room ?? null);
  return !!threadRootId && threads.has(threadRootId);
};
