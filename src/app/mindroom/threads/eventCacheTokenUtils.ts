// CINNY-207 P2.2 commit 2 (F3): the beforeTokens map is now
// timestamped so the meta write path can prune the oldest entries
// while keeping the anchor being written. Entries are stored as
// `{ token, savedAt }`; the `getCachedPaginationToken` accessor still
// returns the raw `string | null | undefined` so callers don't change.

export type CachedPaginationTokenEntry = {
  token: string | null;
  savedAt: number;
};

export type CachedPaginationTokenMap = Record<string, CachedPaginationTokenEntry>;

export type CachedPaginationAnchor = {
  eventId: string;
  ts: number;
};

// CINNY-207 P2.2 commit 2 / F3: cap on beforeTokens map size per meta
// record. The cursor only ever needs the token for the current earliest
// event id, plus a few historical anchors for prepend scenarios; 50
// entries is far above the working set and keeps meta rows bounded.
export const MAX_CACHE_BEFORE_TOKENS = 50;

/**
 * Merge a `{eventId → token}` update into an existing beforeTokens map
 * with pruning. On every write, if the resulting map would exceed
 * MAX_CACHE_BEFORE_TOKENS, evict the oldest entries by `savedAt`.
 *
 * The entry whose `eventId` matches the current earliest anchor being
 * written is NEVER pruned — it's the token the next paginate-before
 * call will look up.
 */
export const mergeCachedPaginationTokens = (
  currentTokens: CachedPaginationTokenMap | undefined,
  eventId: string | undefined,
  beforeToken: string | null | undefined
): CachedPaginationTokenMap | undefined => {
  if (!eventId || beforeToken === undefined) return currentTokens;
  const now = Date.now();
  const merged: CachedPaginationTokenMap = {
    ...(currentTokens ?? {}),
    [eventId]: { token: beforeToken, savedAt: now },
  };
  return pruneCachedPaginationTokens(merged, eventId);
};

/**
 * Cap the map to `MAX_CACHE_BEFORE_TOKENS` entries, evicting the oldest
 * by `savedAt`. `protectedEventId` (the earliest anchor being written
 * on this save) is retained even if it happens to be the oldest.
 */
export const pruneCachedPaginationTokens = (
  tokens: CachedPaginationTokenMap,
  protectedEventId: string
): CachedPaginationTokenMap => {
  const entries = Object.entries(tokens);
  if (entries.length <= MAX_CACHE_BEFORE_TOKENS) return tokens;

  // Sort oldest → newest by savedAt. Ties (equal savedAt from batched
  // writes) fall back to lexicographic event_id for deterministic
  // eviction across load orders.
  entries.sort(([leftId, leftEntry], [rightId, rightEntry]) => {
    const diff = leftEntry.savedAt - rightEntry.savedAt;
    if (diff !== 0) return diff;
    return leftId.localeCompare(rightId);
  });

  // Peel off oldest until we're at the cap. Skip evicting the
  // protected id so we don't lose the anchor the current write needs.
  let toEvict = entries.length - MAX_CACHE_BEFORE_TOKENS;
  const kept: CachedPaginationTokenMap = {};
  for (const [id, entry] of entries) {
    if (toEvict > 0 && id !== protectedEventId) {
      toEvict -= 1;
      continue;
    }
    kept[id] = entry;
  }
  return kept;
};

export const getCachedPaginationToken = (
  currentTokens: CachedPaginationTokenMap | undefined,
  eventId: string | undefined
): string | null | undefined => {
  if (!eventId) return undefined;
  const entry = currentTokens?.[eventId];
  return entry ? entry.token : undefined;
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
