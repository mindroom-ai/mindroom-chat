import { useSyncExternalStore } from 'react';
import type { TagMetadata, ThreadTagsContent } from '../../event-store/threads/threadTags';

const PENDING_TIMEOUT_MS = 15000;

/**
 * This client's tag writes that room state does not show yet, per thread: each tag's new
 * metadata, or `null` for a removal. They sit on top of the live tags, so a tag someone else
 * sets meanwhile shows at once, and each one leaves when room state shows it.
 */
const pendingTags = new Map<string, Map<string, TagMetadata | null>>();
const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const pendingListeners = new Set<() => void>();
let pendingVersion = 0;

const pendingKey = (roomId: string, threadRootId: string): string =>
  `${roomId}\0${threadRootId}`;

const emitPendingChange = () => {
  pendingVersion += 1;
  pendingListeners.forEach((listener) => listener());
};

const clearPendingTimeout = (key: string) => {
  const timeout = pendingTimeouts.get(key);
  if (timeout !== undefined) {
    clearTimeout(timeout);
    pendingTimeouts.delete(key);
  }
};

const subscribePending = (listener: () => void) => {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
};

const getPendingVersion = () => pendingVersion;

export const usePendingThreadTagsVersion = () =>
  useSyncExternalStore(subscribePending, getPendingVersion, getPendingVersion);

const clearPendingThreadTags = (roomId: string, threadRootId: string) => {
  const key = pendingKey(roomId, threadRootId);
  const had = pendingTags.delete(key);
  clearPendingTimeout(key);
  if (had) emitPendingChange();
};

/** Records a tag write this client is sending: the tag's metadata, or `null` to remove it. */
export const setPendingThreadTag = (
  roomId: string,
  threadRootId: string,
  tagName: string,
  metadata: TagMetadata | null
) => {
  const key = pendingKey(roomId, threadRootId);
  const writes = pendingTags.get(key) ?? new Map<string, TagMetadata | null>();
  writes.set(tagName, metadata);
  pendingTags.set(key, writes);
  clearPendingTimeout(key);
  pendingTimeouts.set(
    key,
    setTimeout(() => {
      clearPendingThreadTags(roomId, threadRootId);
    }, PENDING_TIMEOUT_MS)
  );
  emitPendingChange();
};

/** Forgets one tag write, for example when sending it failed. */
export const clearPendingThreadTag = (roomId: string, threadRootId: string, tagName: string) => {
  const key = pendingKey(roomId, threadRootId);
  const writes = pendingTags.get(key);
  if (!writes?.delete(tagName)) return;
  if (writes.size === 0) {
    pendingTags.delete(key);
    clearPendingTimeout(key);
  }
  emitPendingChange();
};

const isWriteInState = (live: ThreadTagsContent, tagName: string, write: TagMetadata | null) => {
  const tag = live.tags[tagName];
  if (!write) return !tag;
  return !!tag && tag.set_by === write.set_by && tag.set_at === write.set_at;
};

/** The thread's live tags with this client's pending writes on top; `live` itself without any. */
export const withPendingThreadTags = (
  roomId: string,
  threadRootId: string,
  live: ThreadTagsContent
): ThreadTagsContent => {
  const writes = pendingTags.get(pendingKey(roomId, threadRootId));
  if (!writes) return live;
  const tags = { ...live.tags };
  writes.forEach((write, tagName) => {
    if (write) tags[tagName] = write;
    else delete tags[tagName];
  });
  return {
    tags: Object.fromEntries(
      Object.entries(tags).sort(([left], [right]) => left.localeCompare(right))
    ),
  };
};

/** Drops the pending writes that the thread's live tags now show. */
export const settlePendingThreadTags = (
  roomId: string,
  threadRootId: string,
  live: ThreadTagsContent
) => {
  const key = pendingKey(roomId, threadRootId);
  const writes = pendingTags.get(key);
  if (!writes) return;
  const before = writes.size;
  writes.forEach((write, tagName) => {
    if (isWriteInState(live, tagName, write)) writes.delete(tagName);
  });
  if (writes.size === before) return;
  if (writes.size === 0) {
    pendingTags.delete(key);
    clearPendingTimeout(key);
  }
  emitPendingChange();
};

/** The threads of the room with pending tag writes. */
export const getPendingThreadTagRootIds = (roomId: string): string[] => {
  const prefix = `${roomId}\0`;
  return [...pendingTags.keys()]
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
};

export const resetPendingThreadTagsForTests = () => {
  pendingTimeouts.forEach((timeout) => clearTimeout(timeout));
  pendingTimeouts.clear();
  pendingTags.clear();
  pendingVersion = 0;
  emitPendingChange();
};
