export type CachedPaginationTokenMap = Record<string, string | null>;
export type CachedPaginationAnchor = {
  eventId: string;
  ts: number;
};

export const mergeCachedPaginationTokens = (
  currentTokens: CachedPaginationTokenMap | undefined,
  eventId: string | undefined,
  beforeToken: string | null | undefined
): CachedPaginationTokenMap | undefined => {
  if (!eventId || beforeToken === undefined) return currentTokens;
  return {
    ...(currentTokens ?? {}),
    [eventId]: beforeToken,
  };
};

export const getCachedPaginationToken = (
  currentTokens: CachedPaginationTokenMap | undefined,
  eventId: string | undefined
): string | null | undefined => {
  if (!eventId) return undefined;
  return currentTokens?.[eventId];
};

export const compareCachedPaginationAnchors = (
  left: CachedPaginationAnchor | undefined,
  right: CachedPaginationAnchor | undefined
): number => {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  const tsDiff = left.ts - right.ts;
  if (tsDiff !== 0) return tsDiff;
  return left.eventId.localeCompare(right.eventId);
};
