import { useCallback, useEffect, useState } from 'react';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { RelationsEvent, type Relations } from 'matrix-js-sdk/lib/models/relations';
import { getMindroomAiRunInfo } from '../components/message/mindroomAiRun';
import { getEventReactions } from '../utils/room';
import { DEFAULT_THREAD_TAIL_EVENT_COUNT, getThreadTailEvents } from '../utils/thread';
import { useThreadEventRefresh } from './useThreadEventRefresh';

const STREAM_STATUS_KEY = 'io.mindroom.stream_status';
const ACTIVE_STREAM_STATES = new Set(['active', 'running', 'streaming']);
const TERMINAL_STREAM_STATES = new Set([
  'complete',
  'completed',
  'done',
  'error',
  'failed',
  'stopped',
  'cancelled',
]);
const STOP_REACTION_KEYS = new Set(['⏹', '⏹️']);

type ThreadStreamingSnapshot = {
  isStreaming: boolean;
  trackedEvents: MatrixEvent[];
  trackedRelations: Relations[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getPreferredEventContent = (mEvent: MatrixEvent): Record<string, unknown> => {
  const replacingEvent = mEvent.replacingEvent();
  const eventForContent =
    replacingEvent && replacingEvent.getSender() === mEvent.getSender() ? replacingEvent : mEvent;

  return eventForContent.getContent() as Record<string, unknown>;
};

const getStatusFromMetadata = (metadata: unknown): string | undefined => {
  if (typeof metadata === 'string' && metadata.length > 0) {
    return metadata.toLowerCase();
  }

  if (!isRecord(metadata)) return undefined;

  const statusCandidate = metadata.status ?? metadata.state;
  if (typeof statusCandidate !== 'string' || statusCandidate.length === 0) return undefined;

  return statusCandidate.toLowerCase();
};

const getMindroomStreamStatus = (content: Record<string, unknown>): string | undefined => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;

  const newContentStatus = getStatusFromMetadata(newContent?.[STREAM_STATUS_KEY]);
  if (newContentStatus) return newContentStatus;

  return getStatusFromMetadata(content[STREAM_STATUS_KEY]);
};

const hasStopReaction = (relations: Relations | undefined): boolean =>
  !!relations
    ?.getSortedAnnotationsByKey()
    ?.some(([key, events]) => STOP_REACTION_KEYS.has(key) && events.size > 0);

const getThreadStreamingEvents = (
  room: Room | undefined,
  threadRootId: string | undefined
): MatrixEvent[] => {
  if (!room || !threadRootId) return [];

  const thread = room.getThread(threadRootId);
  return getThreadTailEvents(thread, DEFAULT_THREAD_TAIL_EVENT_COUNT);
};

const isEventStreaming = (mEvent: MatrixEvent, relations: Relations | undefined): boolean => {
  const content = getPreferredEventContent(mEvent);
  const aiRunStatus = getMindroomAiRunInfo(content)?.status?.toLowerCase();
  if (aiRunStatus === 'streaming') {
    return true;
  }

  const streamStatus = getMindroomStreamStatus(content);
  const terminalMetadata =
    (aiRunStatus && TERMINAL_STREAM_STATES.has(aiRunStatus)) ||
    (streamStatus && TERMINAL_STREAM_STATES.has(streamStatus));

  if (hasStopReaction(relations) && !terminalMetadata) {
    return true;
  }

  return !!streamStatus && ACTIVE_STREAM_STATES.has(streamStatus) && !terminalMetadata;
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

    if (!isStreaming && isEventStreaming(mEvent, relations)) {
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
      relations.on(RelationsEvent.Remove, refresh);
    });

    return () => {
      snapshot.trackedRelations.forEach((relations) => {
        relations.removeListener(RelationsEvent.Add, refresh);
        relations.removeListener(RelationsEvent.Remove, refresh);
      });
    };
  }, [refresh, snapshot.trackedRelations]);

  return snapshot.isStreaming;
};
