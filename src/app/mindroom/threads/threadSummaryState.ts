import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { type MindroomThreadSummaryInfo } from '../messages/threadSummary';
import { loadCachedThreadSummaries, saveCachedThreadSummary } from './cacheStore';
import {
  buildPreferredThreadSummaryMap,
  shouldWriteThreadSummaryToCache,
} from './threadSummarySelection';

type ThreadSummaryListener = () => void;

type RoomThreadSummaryState = {
  summaryMap: Map<string, MindroomThreadSummaryInfo>;
  listeners: Set<ThreadSummaryListener>;
  loadPromise?: Promise<void>;
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
  };
  roomThreadSummaryStates.set(stateKey, nextState);
  return nextState;
};

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
      leftInfo.messageCount !== rightInfo.messageCount
    ) {
      return false;
    }
  }

  return true;
};

export const clearThreadSummarySharedState = () => {
  roomThreadSummaryStates.clear();
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

  state.loadPromise = loadCachedThreadSummaries(sessionId, roomId)
    .then((cachedSummaryMap) => {
      if (cachedSummaryMap.size === 0) return;

      const nextSummaryMap = buildPreferredThreadSummaryMap(cachedSummaryMap, state.summaryMap);
      if (areSummaryMapsEqual(state.summaryMap, nextSummaryMap)) return;

      state.summaryMap = nextSummaryMap;
      notifyStateListeners(state);
    })
    .catch(() => {})
    .finally(() => {
      state.loadPromise = undefined;
    });

  return state.loadPromise;
};

export const storeThreadSummaryInState = (
  sessionId: string,
  roomId: string,
  threadRootId: string,
  info: MindroomThreadSummaryInfo | undefined
): boolean => {
  if (!threadRootId) return false;

  const state = getOrCreateState(sessionId, roomId);
  const currentInfo = state.summaryMap.get(threadRootId);
  if (!shouldWriteThreadSummaryToCache(currentInfo, info)) return false;

  const nextSummaryMap = new Map(state.summaryMap);
  nextSummaryMap.set(threadRootId, info);
  state.summaryMap = nextSummaryMap;
  notifyStateListeners(state);

  saveCachedThreadSummary(sessionId, roomId, threadRootId, info).catch(() => {});
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
