import {
  pickLatestThreadSummaryInfo,
  type ThreadSummaryInfo,
} from '../../matrix/protocol/threadSummary';

export const selectThreadSummaryUpdate = (
  cachedInfo: ThreadSummaryInfo | undefined,
  ...loadedInfos: Array<ThreadSummaryInfo | undefined>
): ThreadSummaryInfo | undefined => {
  const preferred = pickLatestThreadSummaryInfo(cachedInfo, ...loadedInfos);
  if (!preferred?.summaryText) return undefined;
  return cachedInfo?.summaryText !== preferred.summaryText ||
    cachedInfo?.generatedTs !== preferred.generatedTs ||
    cachedInfo?.eventTs !== preferred.eventTs ||
    cachedInfo?.messageCount !== preferred.messageCount ||
    cachedInfo?.isManual !== preferred.isManual
    ? preferred
    : undefined;
};

export const buildPreferredThreadSummaryMap = (
  cachedSummaryMap: Map<string, ThreadSummaryInfo>,
  loadedSummaryMap: Map<string, ThreadSummaryInfo>,
  incomingCandidates?: ReadonlyMap<string, Array<ThreadSummaryInfo | undefined>>
): Map<string, ThreadSummaryInfo> => {
  const merged = new Map<string, ThreadSummaryInfo>();
  const threadRootIds = new Set([
    ...cachedSummaryMap.keys(),
    ...loadedSummaryMap.keys(),
    ...(incomingCandidates?.keys() ?? []),
  ]);

  threadRootIds.forEach((threadRootId) => {
    const info = pickLatestThreadSummaryInfo(
      cachedSummaryMap.get(threadRootId),
      loadedSummaryMap.get(threadRootId),
      ...(incomingCandidates?.get(threadRootId) ?? [])
    );
    if (info?.summaryText) merged.set(threadRootId, info);
  });

  return merged;
};
