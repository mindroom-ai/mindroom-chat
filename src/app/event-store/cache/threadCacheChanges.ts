type Listener = (threadId: string) => void;
const listeners = new Map<string, Set<Listener>>();
const scopeKey = (sessionId: string, roomId: string) => JSON.stringify([sessionId, roomId]);

/** A notification follows a committed change, so readers cannot race ahead of its transaction. */
export const notifyThreadCacheChanged = (
  sessionId: string,
  roomId: string,
  threadId: string
): void => {
  listeners.get(scopeKey(sessionId, roomId))?.forEach((listener) => listener(threadId));
};

export const subscribeThreadCacheChanges = (
  sessionId: string,
  roomId: string,
  listener: Listener
): (() => void) => {
  const key = scopeKey(sessionId, roomId);
  let scoped = listeners.get(key);
  if (!scoped) {
    scoped = new Set();
    listeners.set(key, scoped);
  }
  scoped.add(listener);
  return () => {
    scoped.delete(listener);
    if (scoped.size === 0) listeners.delete(key);
  };
};
