import { useCallback, useEffect, useMemo, useState } from 'react';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { RelationsEvent, type Relations } from 'matrix-js-sdk/lib/models/relations';
import { getMindroomAiRunInfo } from '../components/message/mindroomAiRun';
import { getEventReactions } from '../utils/room';
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
]);
const STOP_REACTION_KEYS = new Set(['⏹', '⏹️']);

type ThreadStreamingSnapshot = {
  isStreaming: boolean;
  replyEventId: string | undefined;
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

const getThreadStreamingSnapshot = (
  room: Room | undefined,
  threadRootId: string | undefined
): ThreadStreamingSnapshot => {
  if (!room || !threadRootId) {
    return { isStreaming: false, replyEventId: undefined };
  }

  const thread = room.getThread(threadRootId);
  const lastReply = thread?.lastReply();
  const replyEventId = lastReply?.getId() ?? undefined;

  if (!lastReply || !replyEventId) {
    return { isStreaming: false, replyEventId };
  }

  const content = getPreferredEventContent(lastReply);
  const aiRunStatus = getMindroomAiRunInfo(content)?.status?.toLowerCase();
  if (aiRunStatus === 'streaming') {
    return { isStreaming: true, replyEventId };
  }

  const streamStatus = getMindroomStreamStatus(content);
  const terminalMetadata =
    (aiRunStatus && TERMINAL_STREAM_STATES.has(aiRunStatus)) ||
    (streamStatus && TERMINAL_STREAM_STATES.has(streamStatus));

  const timelineSet = thread?.getUnfilteredTimelineSet?.() ?? room.getUnfilteredTimelineSet();
  const reactions = getEventReactions(timelineSet, replyEventId);

  if (hasStopReaction(reactions) && !terminalMetadata) {
    return { isStreaming: true, replyEventId };
  }

  return {
    isStreaming: !!streamStatus && ACTIVE_STREAM_STATES.has(streamStatus) && !terminalMetadata,
    replyEventId,
  };
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
  const lastReply = thread?.lastReply() ?? undefined;
  const trackedEvents = useMemo(() => [lastReply], [lastReply]);
  const [snapshot, setSnapshot] = useState(() => getThreadStreamingSnapshot(room, threadRootId));
  const refresh = useCallback(() => {
    setSnapshot(getThreadStreamingSnapshot(room, threadRootId));
  }, [room, threadRootId]);
  const reactionRelations = useMemo(() => {
    if (!room || !thread || !snapshot.replyEventId) return undefined;

    return getEventReactions(thread.getUnfilteredTimelineSet(), snapshot.replyEventId);
  }, [room, snapshot.replyEventId, thread]);

  useThreadEventRefresh(thread, trackedEvents, refresh);

  useEffect(() => {
    if (!reactionRelations) return undefined;

    reactionRelations.on(RelationsEvent.Add, refresh);
    reactionRelations.on(RelationsEvent.Remove, refresh);

    return () => {
      reactionRelations.removeListener(RelationsEvent.Add, refresh);
      reactionRelations.removeListener(RelationsEvent.Remove, refresh);
    };
  }, [reactionRelations, refresh]);

  return snapshot.isStreaming;
};
