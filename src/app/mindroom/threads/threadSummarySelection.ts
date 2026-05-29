import {
  pickLatestThreadSummaryInfo,
  type MindroomThreadSummaryInfo,
} from '../messages/threadSummary';

export const shouldWriteThreadSummaryToCache = (
  cachedInfo: MindroomThreadSummaryInfo | undefined,
  loadedInfo: MindroomThreadSummaryInfo | undefined
): loadedInfo is MindroomThreadSummaryInfo & { summaryText: string } => {
  if (!loadedInfo?.summaryText) return false;

  const preferred = pickLatestThreadSummaryInfo(cachedInfo, loadedInfo);
  if (preferred !== loadedInfo) return false;

  return (
    cachedInfo?.summaryText !== loadedInfo.summaryText ||
    cachedInfo?.generatedTs !== loadedInfo.generatedTs ||
    cachedInfo?.messageCount !== loadedInfo.messageCount
  );
};

export const buildPreferredThreadSummaryMap = (
  cachedSummaryMap: Map<string, MindroomThreadSummaryInfo>,
  loadedSummaryMap: Map<string, MindroomThreadSummaryInfo>
): Map<string, MindroomThreadSummaryInfo> => {
  const merged = new Map<string, MindroomThreadSummaryInfo>();
  const threadRootIds = new Set([...cachedSummaryMap.keys(), ...loadedSummaryMap.keys()]);

  threadRootIds.forEach((threadRootId) => {
    const info = pickLatestThreadSummaryInfo(
      cachedSummaryMap.get(threadRootId),
      loadedSummaryMap.get(threadRootId)
    );
    if (info?.summaryText) merged.set(threadRootId, info);
  });

  return merged;
};
