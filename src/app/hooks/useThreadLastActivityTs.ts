import { useCallback, useState } from 'react';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { DEFAULT_THREAD_TAIL_EVENT_COUNT, getThreadTailEvents } from '../utils/thread';
import { useThreadEventRefresh } from './useThreadEventRefresh';

const getEventActivityTs = (mEvent: MatrixEvent | null | undefined): number | undefined => {
  if (!mEvent) return undefined;

  const replacingEvent = mEvent.replacingEvent();
  const replacingTs =
    replacingEvent && replacingEvent.getSender() === mEvent.getSender()
      ? replacingEvent.getTs()
      : undefined;

  return Math.max(mEvent.getTs(), replacingTs ?? 0);
};

const getThreadActivityEvents = (
  room: Room | undefined,
  threadRootId: string | undefined
): MatrixEvent[] => {
  if (!room || !threadRootId) return [];

  const thread = room.getThread(threadRootId);
  const tailEvents = getThreadTailEvents(thread, DEFAULT_THREAD_TAIL_EVENT_COUNT);
  if (tailEvents.length > 0) return tailEvents;

  const rootEvent = thread?.rootEvent ?? room.findEventById(threadRootId);
  return rootEvent ? [rootEvent] : [];
};

type ThreadLastActivitySnapshot = {
  activityTs: number | undefined;
  trackedEvents: MatrixEvent[];
};

const getThreadLastActivitySnapshot = (
  room: Room | undefined,
  threadRootId: string | undefined
): ThreadLastActivitySnapshot => {
  const trackedEvents = getThreadActivityEvents(room, threadRootId);
  const activityTs = trackedEvents
    .map((mEvent) => getEventActivityTs(mEvent))
    .reduce<number | undefined>((latestTs, candidateTs) => {
      if (candidateTs === undefined) return latestTs;
      if (latestTs === undefined) return candidateTs;
      return candidateTs > latestTs ? candidateTs : latestTs;
    }, undefined);

  return {
    activityTs,
    trackedEvents,
  };
};

export const getThreadLastActivityTs = (
  room: Room | undefined,
  threadRootId: string | undefined
): number | undefined =>
  getThreadLastActivitySnapshot(room, threadRootId).activityTs;

export const useThreadLastActivityTs = (
  room: Room | undefined,
  threadRootId: string | undefined
): number | undefined => {
  const thread = room && threadRootId ? room.getThread(threadRootId) ?? undefined : undefined;
  const [snapshot, setSnapshot] = useState(() => getThreadLastActivitySnapshot(room, threadRootId));
  const refresh = useCallback(() => {
    setSnapshot(getThreadLastActivitySnapshot(room, threadRootId));
  }, [room, threadRootId]);

  useThreadEventRefresh(thread, snapshot.trackedEvents, refresh);

  return snapshot.activityTs;
};
