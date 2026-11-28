type Listener = (threadId: string) => void;
type ScopeChanges = {
  seq: number;
  threads: Map<string, number>;
};

const listeners = new Map<string, Set<Listener>>();
const changesByScope = new Map<string, ScopeChanges>();
const scopeKey = (sessionId: string, roomId: string) => JSON.stringify([sessionId, roomId]);

/** Current monotonic change sequence for thread cache writes in `(sessionId, roomId)`. */
export const getThreadCacheChangeSeq = (sessionId: string, roomId: string): number =>
  changesByScope.get(scopeKey(sessionId, roomId))?.seq ?? 0;

/** Thread IDs whose cached events changed after `sinceSeq` in `(sessionId, roomId)`. */
export const getChangedThreadIdsSince = (
  sessionId: string,
  roomId: string,
  sinceSeq: number
): string[] => {
  const scope = changesByScope.get(scopeKey(sessionId, roomId));
  if (!scope || scope.seq <= sinceSeq) return [];
  const changed: string[] = [];
  scope.threads.forEach((seq, threadId) => {
    if (seq > sinceSeq) changed.push(threadId);
  });
  return changed;
};

/** A notification follows a committed change, so readers cannot race ahead of its transaction. */
export const notifyThreadCacheChanged = (
  sessionId: string,
  roomId: string,
  threadId: string
): void => {
  const key = scopeKey(sessionId, roomId);
  let scope = changesByScope.get(key);
  if (!scope) {
    scope = { seq: 0, threads: new Map() };
    changesByScope.set(key, scope);
  }
  scope.seq += 1;
  scope.threads.set(threadId, scope.seq);
  listeners.get(key)?.forEach((listener) => listener(threadId));
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
