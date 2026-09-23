import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { type MindroomThreadSummaryInfo } from '../messages/threadSummary';
import { loadCachedThreadSummaries } from './cacheStore';
import {
  captureCacheStoreWriteLease,
  isCacheStoreWriteLeaseCurrent,
} from './cacheStore/cacheStoreDb';
import { subscribeCachedThreadSummaryChanges } from './cacheStore/cacheStoreSummaryChanges';
import {
  buildPreferredThreadSummaryMap,
  selectThreadSummaryUpdate,
} from './threadSummarySelection';

type ThreadSummaryListener = () => void;

export type ThreadSummaryWriter = (
  threadRootId: string,
  ...infos: Array<MindroomThreadSummaryInfo | undefined>
) => void;

type RoomThreadSummaryState = {
  summaryMap: Map<string, MindroomThreadSummaryInfo>;
  listeners: Set<ThreadSummaryListener>;
  loadPromise?: Promise<void>;
  hasLoaded?: boolean;
  incomingDuringLoad?: Map<string, Array<MindroomThreadSummaryInfo | undefined>>;
  invalidated: Map<string, MindroomThreadSummaryInfo[]>;
  published: Map<string, MindroomThreadSummaryInfo[]>;
  generation: number;
  unsubscribeCache?: () => void;
};

const EMPTY_SUMMARY_MAP = new Map<string, MindroomThreadSummaryInfo>();
const roomThreadSummaryStates = new Map<string, RoomThreadSummaryState>();

const getStateKey = (sessionId: string, roomId: string): string => `${sessionId}|${roomId}`;

const getOrCreateState = (sessionId: string, roomId: string): RoomThreadSummaryState => {
  const stateKey = getStateKey(sessionId, roomId);
  const existingState = roomThreadSummaryStates.get(stateKey);
  if (existingState) return existingState;

  const nextState: RoomThreadSummaryState = {
    summaryMap: new Map(),
    listeners: new Set(),
    invalidated: new Map(),
    published: new Map(),
    generation: 0,
  };
  roomThreadSummaryStates.set(stateKey, nextState);
  nextState.unsubscribeCache = subscribeCachedThreadSummaryChanges(sessionId, roomId, (change) => {
    if (change.type === 'clear') {
      // Mounted views can still publish pre-clear candidates. Keep their
      // invalidation evidence until accepted history commits them again.
      const invalidate = (info: MindroomThreadSummaryInfo | undefined, rootId: string) => {
        if (!info) return;
        const removed = nextState.invalidated.get(rootId) ?? [];
        if (!removed.some((candidate) => sameRevision(candidate, info))) removed.push(info);
        nextState.invalidated.set(rootId, removed);
      };
      nextState.summaryMap.forEach(invalidate);
      nextState.published.forEach((infos, rootId) =>
        infos.forEach((info) => invalidate(info, rootId))
      );
      nextState.published.clear();
      nextState.incomingDuringLoad?.forEach((infos, rootId) =>
        infos.forEach((info) => invalidate(info, rootId))
      );
      nextState.generation += 1;
      nextState.loadPromise = undefined;
      nextState.hasLoaded = false;
      nextState.incomingDuringLoad = undefined;
      if (nextState.summaryMap.size > 0) {
        nextState.summaryMap = new Map();
        notifyStateListeners(nextState);
      }
      return;
    }
    const { threadRootId, previous, summary } = change;
    const invalidated = nextState.invalidated.get(threadRootId) ?? [];
    if (previous) invalidated.push(previous);
    // A committed fallback can restore a previously superseded notice.
    nextState.invalidated.set(
      threadRootId,
      invalidated.filter((info) => !sameRevision(info, summary))
    );
    const current = validSummary(nextState, threadRootId, nextState.summaryMap.get(threadRootId));
    const selected = selectThreadSummaryUpdate(current, summary) ?? current;
    const updated = new Map(nextState.summaryMap);
    if (selected) updated.set(threadRootId, selected);
    else updated.delete(threadRootId);
    if (!areSummaryMapsEqual(nextState.summaryMap, updated)) {
      nextState.summaryMap = updated;
      notifyStateListeners(nextState);
    }
  });
  return nextState;
};

const sameRevision = (
  left: MindroomThreadSummaryInfo,
  right: MindroomThreadSummaryInfo | undefined
): boolean =>
  !!right &&
  left.summaryText === right.summaryText &&
  left.generatedTs === right.generatedTs &&
  left.messageCount === right.messageCount &&
  left.isManual === right.isManual &&
  (left.eventTs === undefined || right.eventTs === undefined || left.eventTs === right.eventTs);

const validSummary = (
  state: RoomThreadSummaryState,
  rootId: string,
  info: MindroomThreadSummaryInfo | undefined
) =>
  info && !state.invalidated.get(rootId)?.some((removed) => sameRevision(removed, info))
    ? info
    : undefined;

const notifyStateListeners = (state: RoomThreadSummaryState) => {
  state.listeners.forEach((listener) => listener());
};

const areSummaryMapsEqual = (
  left: Map<string, MindroomThreadSummaryInfo>,
  right: Map<string, MindroomThreadSummaryInfo>
): boolean => {
  if (left === right) return true;
  if (left.size !== right.size) return false;

  for (const [threadRootId, leftInfo] of left) {
    const rightInfo = right.get(threadRootId);
    if (!rightInfo) return false;
    if (
      leftInfo.summaryText !== rightInfo.summaryText ||
      leftInfo.generatedTs !== rightInfo.generatedTs ||
      leftInfo.eventTs !== rightInfo.eventTs ||
      leftInfo.messageCount !== rightInfo.messageCount ||
      leftInfo.isManual !== rightInfo.isManual
    ) {
      return false;
    }
  }

  return true;
};

export const clearThreadSummarySharedState = (sessionId?: string) => {
  if (!sessionId) {
    roomThreadSummaryStates.forEach((state) => state.unsubscribeCache?.());
    roomThreadSummaryStates.clear();
    return;
  }

  const prefix = `${sessionId}|`;
  roomThreadSummaryStates.forEach((state, stateKey) => {
    if (stateKey.startsWith(prefix)) {
      state.unsubscribeCache?.();
      roomThreadSummaryStates.delete(stateKey);
    }
  });
};

// Capture before asynchronous manual actions so a clear or session removal
// cannot let their late response begin a fresh write or recreate UI state.
export const captureThreadSummaryStateOwnership = (sessionId: string, roomId: string) => {
  const state = getOrCreateState(sessionId, roomId);
  const generation = state.generation;
  const lease = captureCacheStoreWriteLease(sessionId, roomId);
  return () =>
    roomThreadSummaryStates.get(getStateKey(sessionId, roomId)) === state &&
    state.generation === generation &&
    isCacheStoreWriteLeaseCurrent(lease);
};

export const subscribeToThreadSummaryState = (
  sessionId: string | undefined,
  roomId: string | undefined,
  listener: ThreadSummaryListener
) => {
  if (!sessionId || !roomId) return () => undefined;

  const state = getOrCreateState(sessionId, roomId);
  state.listeners.add(listener);

  return () => {
    state.listeners.delete(listener);
  };
};

export const getThreadSummaryStateSnapshot = (
  sessionId: string | undefined,
  roomId: string | undefined
): Map<string, MindroomThreadSummaryInfo> => {
  if (!sessionId || !roomId) return EMPTY_SUMMARY_MAP;
  return getOrCreateState(sessionId, roomId).summaryMap;
};

export const ensureThreadSummaryStateLoaded = async (sessionId: string, roomId: string) => {
  const state = getOrCreateState(sessionId, roomId);
  if (state.loadPromise) return state.loadPromise;
  // Preserve the full evidence while a disk read is pending. Reducing live
  // batches before this merge could resurrect a legacy record with a skewed
  // metadata clock after its newer replacement has already been published.
  const incomingDuringLoad =
    state.incomingDuringLoad ?? new Map<string, Array<MindroomThreadSummaryInfo | undefined>>();
  state.incomingDuringLoad = incomingDuringLoad;
  state.hasLoaded = false;
  const generation = state.generation;

  state.loadPromise = loadCachedThreadSummaries(sessionId, roomId)
    .then((cachedSummaryMap) => {
      if (
        roomThreadSummaryStates.get(getStateKey(sessionId, roomId)) !== state ||
        generation !== state.generation
      )
        return;
      cachedSummaryMap.forEach((info, id) => {
        if (!validSummary(state, id, info)) cachedSummaryMap.delete(id);
      });
      incomingDuringLoad.forEach((infos, id) => {
        incomingDuringLoad.set(
          id,
          infos.map((info) => validSummary(state, id, info))
        );
      });
      const nextSummaryMap = buildPreferredThreadSummaryMap(
        cachedSummaryMap,
        state.summaryMap,
        incomingDuringLoad
      );
      if (!areSummaryMapsEqual(state.summaryMap, nextSummaryMap)) {
        state.summaryMap = nextSummaryMap;
        notifyStateListeners(state);
      }
      state.hasLoaded = true;
    })
    // A failed read must retain the evidence and leave disk untouched until retry.
    .catch(() => {})
    .finally(() => {
      if (generation !== state.generation) return;
      state.loadPromise = undefined;
      if (!state.hasLoaded) return;
      state.incomingDuringLoad = undefined;
    });

  return state.loadPromise;
};

export const storeThreadSummaryInState = (
  sessionId: string,
  roomId: string,
  threadRootId: string,
  ...infos: Array<MindroomThreadSummaryInfo | undefined>
): boolean => {
  if (!threadRootId) return false;

  const state = getOrCreateState(sessionId, roomId);
  // UI publications are display-only. Storage derives durable titles from
  // accepted events, independently of which views happen to be mounted.
  // Remember losing candidates too: SDK publishers replay the complete set,
  // and clearing only its winner would expose an older pre-clear title.
  const published = state.published.get(threadRootId) ?? [];
  infos.forEach((candidate) => {
    if (candidate && !published.some((info) => sameRevision(info, candidate)))
      published.push(candidate);
  });
  state.published.set(threadRootId, published);
  if (!state.hasLoaded && !state.loadPromise)
    void ensureThreadSummaryStateLoaded(sessionId, roomId);
  if (state.incomingDuringLoad) {
    const candidates = state.incomingDuringLoad.get(threadRootId) ?? [];
    candidates.push(...infos.map((info) => validSummary(state, threadRootId, info)));
    state.incomingDuringLoad.set(threadRootId, candidates);
  }
  const currentInfo = state.summaryMap.get(threadRootId);
  const info = selectThreadSummaryUpdate(
    currentInfo,
    ...infos.map((candidate) => validSummary(state, threadRootId, candidate))
  );
  if (!info) return false;

  const nextSummaryMap = new Map(state.summaryMap);
  nextSummaryMap.set(threadRootId, info);
  state.summaryMap = nextSummaryMap;
  notifyStateListeners(state);

  return true;
};

type UseThreadSummaryStateOptions = {
  roomId: string;
  sessionId?: string;
};

export const useThreadSummaryStateMap = ({
  roomId,
  sessionId,
}: UseThreadSummaryStateOptions): Map<string, MindroomThreadSummaryInfo> => {
  const subscribe = useCallback(
    (listener: ThreadSummaryListener) => subscribeToThreadSummaryState(sessionId, roomId, listener),
    [roomId, sessionId]
  );
  const getSnapshot = useCallback(
    () => getThreadSummaryStateSnapshot(sessionId, roomId),
    [roomId, sessionId]
  );

  const summaryMap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!sessionId) return;
    ensureThreadSummaryStateLoaded(sessionId, roomId).catch(() => {});
  }, [roomId, sessionId]);

  return summaryMap;
};
