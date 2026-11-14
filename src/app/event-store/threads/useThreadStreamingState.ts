import { useCallback, useEffect, useState } from 'react';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { Relations, RelationsEvent } from 'matrix-js-sdk/lib/models/relations';
import {
  ACTIVE_STREAM_STATUSES,
  STREAM_STATUS_KEY,
  TERMINAL_STREAM_STATUSES,
  getAiRunInfo,
  getStreamStatusFromContent,
  hasTerminalStreamMetadata,
} from '../../matrix/protocol/aiRun';
import { STOP_REACTION_KEYS } from '../../matrix/protocol/stopReaction';
import { getShallowSerializedReplacementEvent, isSameSenderEditEvent } from '../../matrix/editEvent';
import { getActiveAnnotationsByKey } from '../../matrix/protocol/reactionAnnotations';
import { getEditedEvent, getEventReactions, getLatestMessageContent } from '../../matrix/room';
import { DEFAULT_THREAD_TAIL_EVENT_COUNT, getThreadTailEvents } from '../../matrix/thread';
import { useThreadEventRefresh } from './useThreadEventRefresh';
import { isStreamingReplyCurrent } from '../../matrix/client/streamingReplies';
import { getFinishingEdit, hasStreamEnded } from '../../matrix/client/syncedEdits';

type ThreadStreamingSnapshot = {
  isStreaming: boolean;
  trackedEvents: MatrixEvent[];
  trackedRelations: Relations[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

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

// Some producers wrap the stream status in a `{ status | state }` record instead
// of writing a plain string. Fall back to that shape when the shared string
// helper (which only accepts strings) yields nothing.
const getStatusFromRecordMetadata = (metadata: unknown): string | undefined => {
  if (!isRecord(metadata)) return undefined;
  const statusCandidate = metadata.status ?? metadata.state;
  if (typeof statusCandidate !== 'string' || statusCandidate.length === 0) return undefined;
  return statusCandidate.toLowerCase();
};

const getStreamStatus = (content: Record<string, unknown>): string | undefined => {
  const fromStringForm = getStreamStatusFromContent(content);
  if (fromStringForm) return fromStringForm;

  const newContent = isRecord(content['m.new_content']) ? content['m.new_content'] : undefined;
  return (
    getStatusFromRecordMetadata(newContent?.[STREAM_STATUS_KEY]) ??
    getStatusFromRecordMetadata(content[STREAM_STATUS_KEY])
  );
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

  const streamStatus = getStreamStatus(content);
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

const getThreadStreamingSnapshot = (
  room: Room | undefined,
  threadRootId: string | undefined
): ThreadStreamingSnapshot => {
  const trackedEvents = getThreadStreamingEvents(room, threadRootId);
  if (!room || !threadRootId || trackedEvents.length === 0) {
    return { isStreaming: false, trackedEvents, trackedRelations: [] };
  }

  const thread = room.getThread(threadRootId);
  const timelineSet = thread?.getUnfilteredTimelineSet?.() ?? room.getUnfilteredTimelineSet();
  const trackedRelations: Relations[] = [];
  let isStreaming = false;

  trackedEvents.forEach((mEvent) => {
    const eventId = mEvent.getId();
    const relations = eventId ? getEventReactions(timelineSet, eventId) : undefined;
    if (relations && !trackedRelations.includes(relations)) {
      trackedRelations.push(relations);
    }

    if (
      !isStreaming &&
      isEventStreaming(mEvent, relations, timelineSet) &&
      isStreamingReplyCurrent(room, mEvent)
    ) {
      isStreaming = true;
    }
  });

  return { isStreaming, trackedEvents, trackedRelations };
};

export const getThreadStreamingState = (
  room: Room | undefined,
  threadRootId: string | undefined
): boolean => getThreadStreamingSnapshot(room, threadRootId).isStreaming;

export const useThreadStreamingState = (
  room: Room | undefined,
  threadRootId: string | undefined
): boolean => {
  const thread = room && threadRootId ? room.getThread(threadRootId) ?? undefined : undefined;
  const [snapshot, setSnapshot] = useState(() => getThreadStreamingSnapshot(room, threadRootId));
  const refresh = useCallback(() => {
    setSnapshot(getThreadStreamingSnapshot(room, threadRootId));
  }, [room, threadRootId]);

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

  return snapshot.isStreaming;
};
