import { useEffect, useMemo, useReducer } from 'react';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { Relations, RelationsEvent } from 'matrix-js-sdk/lib/models/relations';
import {
  ACTIVE_STREAM_STATUSES,
  TERMINAL_STREAM_STATUSES,
  getAiRunInfo,
  hasTerminalStreamMetadata,
  readStreamStatus,
} from '../../matrix/protocol/aiRun';
import { STOP_REACTION_KEYS } from '../../matrix/protocol/stopReaction';
import {
  getShallowSerializedReplacementEvent,
  isSameSenderEditEvent,
} from '../../matrix/editEvent';
import { getActiveAnnotationsByKey } from '../../matrix/protocol/reactionAnnotations';
import { getEditedEvent, getEventReactions, getLatestMessageContent } from '../../matrix/room';
import { DEFAULT_THREAD_TAIL_EVENT_COUNT, getThreadTailEvents } from '../../matrix/thread';
import { useThreadEventRefresh } from './useThreadEventRefresh';
import { isStreamingReplyCurrent } from '../../matrix/client/streamingReplies';
import { getFinishingEdit, hasStreamEnded } from '../../matrix/client/syncedEdits';

type ThreadStreamingSnapshot = {
  isStreaming: boolean;
  /** The tail replies that stream, oldest first: agents can stream at once. */
  replies: MatrixEvent[];
  trackedEvents: MatrixEvent[];
  trackedRelations: Relations[];
};

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
  const aiRunStatus = getAiRunInfo(content)?.status?.toLowerCase();
  if (aiRunStatus === 'streaming') {
    return true;
  }

  const streamStatus = readStreamStatus(content);
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

  if (hasStopReaction(relations) && !terminalMetadata) {
    return true;
  }

  return !!streamStatus && ACTIVE_STREAM_STATUSES.has(streamStatus) && !terminalMetadata;
};

/** Whether a thread's reply streams now, as the thread's Working state reads its tail. */
export const isThreadReplyStreaming = (
  room: Room,
  mEvent: MatrixEvent,
  timelineSet: ReturnType<Room['getUnfilteredTimelineSet']>
): boolean => {
  const eventId = mEvent.getId();
  const relations = eventId ? getEventReactions(timelineSet, eventId) : undefined;
  return isEventStreaming(mEvent, relations, timelineSet) && isStreamingReplyCurrent(room, mEvent);
};

const getThreadStreamingSnapshot = (
  room: Room | undefined,
  threadRootId: string | undefined
): ThreadStreamingSnapshot => {
  const trackedEvents = getThreadStreamingEvents(room, threadRootId);
  if (!room || !threadRootId || trackedEvents.length === 0) {
    return { isStreaming: false, replies: [], trackedEvents, trackedRelations: [] };
  }

  const thread = room.getThread(threadRootId);
  const timelineSet = thread?.getUnfilteredTimelineSet?.() ?? room.getUnfilteredTimelineSet();
  const trackedRelations: Relations[] = [];
  const replies: MatrixEvent[] = [];

  trackedEvents.forEach((mEvent) => {
    const eventId = mEvent.getId();
    const relations = eventId ? getEventReactions(timelineSet, eventId) : undefined;
    if (relations && !trackedRelations.includes(relations)) {
      trackedRelations.push(relations);
    }

    if (isEventStreaming(mEvent, relations, timelineSet) && isStreamingReplyCurrent(room, mEvent)) {
      replies.push(mEvent);
    }
  });

  return { isStreaming: replies.length > 0, replies, trackedEvents, trackedRelations };
};

export const getThreadStreamingState = (
  room: Room | undefined,
  threadRootId: string | undefined
): boolean => getThreadStreamingSnapshot(room, threadRootId).isStreaming;

/** The replies of the thread's tail that stream now, whose tool traces say what they run. */
export const getThreadStreamingReplies = (
  room: Room | undefined,
  threadRootId: string | undefined
): MatrixEvent[] => getThreadStreamingSnapshot(room, threadRootId).replies;

export const useThreadStreamingState = (
  room: Room | undefined,
  threadRootId: string | undefined
): boolean => {
  const thread = room && threadRootId ? room.getThread(threadRootId) ?? undefined : undefined;
  // The check resolves every edit of the tail's replies, and the SDK sends a thread update for
  // each event a page of older history adds: a refresh only marks the state stale, and the next
  // render, which React takes once for a burst of marks, checks again.
  const [checks, refresh] = useReducer((count: number) => count + 1, 0);
  const snapshot = useMemo(() => {
    void checks;
    return getThreadStreamingSnapshot(room, threadRootId);
  }, [checks, room, threadRootId]);

  useThreadEventRefresh(thread, snapshot.trackedEvents, refresh);

  useEffect(() => {
    if (snapshot.trackedRelations.length === 0) return undefined;

    snapshot.trackedRelations.forEach((relations) => {
      relations.on(RelationsEvent.Add, refresh);
      relations.on(RelationsEvent.Redaction, refresh);
      relations.on(RelationsEvent.Remove, refresh);
    });

    return () => {
      snapshot.trackedRelations.forEach((relations) => {
        relations.removeListener(RelationsEvent.Add, refresh);
        relations.removeListener(RelationsEvent.Redaction, refresh);
        relations.removeListener(RelationsEvent.Remove, refresh);
      });
    };
  }, [refresh, snapshot.trackedRelations]);

  // The render that switched threads checked the new one before the effects above listen to it;
  // check once more now that they do.
  useEffect(() => {
    refresh();
  }, [room, threadRootId]);

  return snapshot.isStreaming;
};
