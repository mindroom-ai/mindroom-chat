type Listener = (threadId: string) => void;
const listeners = new Map<string, Set<Listener>>();
const keyFor = (sessionId: string, roomId: string) => JSON.stringify([sessionId, roomId]);

/** Observe committed history changes without subscribing a view to every SDK event. */
export const subscribeThreadCacheChanges = (
  sessionId: string,
  roomId: string,
  listener: Listener
) => {
  const key = keyFor(sessionId, roomId);
  const roomListeners = listeners.get(key) ?? new Set<Listener>();
  roomListeners.add(listener);
  listeners.set(key, roomListeners);
  return () => {
    roomListeners.delete(listener);
    if (roomListeners.size === 0) listeners.delete(key);
  };
};

export const notifyThreadCacheChanged = (
  sessionId: string,
  roomId: string,
  threadId: string
): void => {
  listeners.get(keyFor(sessionId, roomId))?.forEach((listener) => listener(threadId));
};
