import type { MindroomThreadSummaryInfo } from '../../messages/threadSummary';

export type CachedThreadSummaryChange =
  | {
      type: 'summary';
      threadRootId: string;
      previous: MindroomThreadSummaryInfo | undefined;
      summary: MindroomThreadSummaryInfo | undefined;
    }
  | { type: 'clear' };
type Listener = (change: CachedThreadSummaryChange) => void;
const listeners = new Map<string, Map<string, Set<Listener>>>();

/** Only committed projection changes are observable by mounted summary consumers. */
export const subscribeCachedThreadSummaryChanges = (
  sessionId: string,
  roomId: string,
  listener: Listener
): (() => void) => {
  const rooms = listeners.get(sessionId) ?? new Map<string, Set<Listener>>();
  const room = rooms.get(roomId) ?? new Set<Listener>();
  room.add(listener);
  rooms.set(roomId, room);
  listeners.set(sessionId, rooms);
  return () => {
    room.delete(listener);
    if (!room.size) rooms.delete(roomId);
    if (!rooms.size) listeners.delete(sessionId);
  };
};
export const notifyCachedThreadSummaryChange = (
  sessionId: string,
  roomId: string,
  change: CachedThreadSummaryChange
): void => {
  listeners
    .get(sessionId)
    ?.get(roomId)
    ?.forEach((listener) => listener(change));
};
export const notifyCachedThreadSummariesCleared = (sessionId: string, roomId?: string): void => {
  if (roomId !== undefined) notifyCachedThreadSummaryChange(sessionId, roomId, { type: 'clear' });
  else
    listeners
      .get(sessionId)
      ?.forEach((room) => room.forEach((listener) => listener({ type: 'clear' })));
};
