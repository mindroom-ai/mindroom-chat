import { useCallback, useMemo, useState } from 'react';
import { MatrixEvent, Room } from 'matrix-js-sdk';
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

const getThreadActivityTailEvent = (room: Room | undefined, threadRootId: string | undefined) => {
  if (!room || !threadRootId) return undefined;

  const thread = room.getThread(threadRootId);
  return thread?.lastReply() ?? thread?.replyToEvent ?? undefined;
};

type ThreadLastActivitySnapshot = {
  activityTs: number | undefined;
  tailEventId: string | undefined;
};

export const getThreadLastActivityTs = (
  room: Room | undefined,
  threadRootId: string | undefined
): number | undefined => {
  if (!room || !threadRootId) return undefined;

  const thread = room.getThread(threadRootId);
  const rootEvent = thread?.rootEvent ?? room.findEventById(threadRootId);
  if (!rootEvent) return undefined;

  const latestReply = thread?.lastReply() ?? thread?.replyToEvent ?? undefined;
  const activityCandidates = [getEventActivityTs(rootEvent), getEventActivityTs(latestReply)];

  return activityCandidates.reduce<number | undefined>((latestTs, candidateTs) => {
    if (candidateTs === undefined) return latestTs;
    if (latestTs === undefined) return candidateTs;
    return candidateTs > latestTs ? candidateTs : latestTs;
  }, undefined);
};

const getThreadLastActivitySnapshot = (
  room: Room | undefined,
  threadRootId: string | undefined
): ThreadLastActivitySnapshot => ({
  activityTs: getThreadLastActivityTs(room, threadRootId),
  tailEventId: getThreadActivityTailEvent(room, threadRootId)?.getId() ?? undefined,
});

export const useThreadLastActivityTs = (
  room: Room | undefined,
  threadRootId: string | undefined
): number | undefined => {
  const thread = room && threadRootId ? room.getThread(threadRootId) ?? undefined : undefined;
  const rootEvent =
    thread?.rootEvent ?? (room && threadRootId ? room.findEventById(threadRootId) : undefined);
  const tailEvent = getThreadActivityTailEvent(room, threadRootId);
  const trackedEvents = useMemo(() => [rootEvent, tailEvent], [rootEvent, tailEvent]);
  const [snapshot, setSnapshot] = useState(() => getThreadLastActivitySnapshot(room, threadRootId));
  const refresh = useCallback(() => {
    setSnapshot(getThreadLastActivitySnapshot(room, threadRootId));
  }, [room, threadRootId]);

  useThreadEventRefresh(thread, trackedEvents, refresh);

  return snapshot.activityTs;
};
