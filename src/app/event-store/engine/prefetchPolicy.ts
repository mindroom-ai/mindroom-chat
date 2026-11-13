/** Background scope policy. Focus is the default; all rooms is explicit opt-in. */

// ---------- Public constants (D3) ----------

const PREFETCH_SCOPE_VALUES = ['current-room-only', 'all-rooms'] as const;
/** Stored scope values. */
export type PrefetchScope = (typeof PREFETCH_SCOPE_VALUES)[number];
export const DEFAULT_PREFETCH_SCOPE: PrefetchScope = 'current-room-only';

/** Lowest accepted depth (in raw events) of the current-room deep-history sweep. */
export const ROOM_TAIL_PREFETCH_DEPTH = 200;

/**
 * Target depth (in raw events) of the current-room deep-history sweep
 * — the band-4 job that replaces the removed eager-preload loop
 * (P4.3). Sized generously: this is the room the user is looking at,
 * so we make scrollback and search inside it feel bottomless.
 */
export const CURRENT_ROOM_DEEP_HISTORY_TARGET = 10_000;

// ---------- User settings resolvers (Phase 6.1 / D4) ----------

/**
 * Coerce an arbitrary settings value into a valid `PrefetchScope`.
 * Anything not on the whitelist (older enum values such as
 * v1's homeserver scope `my-server`, hand-edited JSON, or genuine
 * `undefined`) becomes the default. Same
 * shape as the sanitizers in `preferences/settings.ts` (silent fallback,
 * not throwing) so a corrupted storage blob never crashes the app.
 */
export const sanitizePrefetchScope = (value: unknown): PrefetchScope => {
  if (typeof value !== 'string') return DEFAULT_PREFETCH_SCOPE;
  return (PREFETCH_SCOPE_VALUES as ReadonlyArray<string>).includes(value)
    ? (value as PrefetchScope)
    : DEFAULT_PREFETCH_SCOPE;
};

/**
 * Depth cap for the current-room deep-history sweep. Matches the shape
 * of the sanitizer P1.6 replaced (silent fallback, integer, clamp to
 * [ROOM_TAIL_PREFETCH_DEPTH, CURRENT_ROOM_DEEP_HISTORY_TARGET]).
 * The lower bound is ROOM_TAIL_PREFETCH_DEPTH (200) rather than the
 * legacy 50 because anything shallower defeats the "bottomless
 * scrollback" goal of the current-room job — the room-tail depth is
 * the smallest number that keeps the design coherent. The upper bound
 * is CURRENT_ROOM_DEEP_HISTORY_TARGET (10_000) — the same generous cap
 * the eager preload used, sized so a user opening a mid-history event
 * can still scroll around without a fresh fetch.
 */
export const sanitizePrefetchDepth = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return CURRENT_ROOM_DEEP_HISTORY_TARGET;
  }
  return Math.min(
    Math.max(Math.trunc(value), ROOM_TAIL_PREFETCH_DEPTH),
    CURRENT_ROOM_DEEP_HISTORY_TARGET
  );
};

/**
 * Runtime background-prefetch policy. Depth is owned by the foreground
 * deep-history job and is not duplicated into this engine config.
 */
export type PrefetchConfig = {
  readonly scope: PrefetchScope;
};

/**
 * Pure resolver: build a `PrefetchConfig` from a settings snapshot's
 * `prefetchScope`, coerced by the sanitizer above. Kept pure so callers
 * need no jotai in non-React modules.
 */
export const resolvePrefetchConfig = (settings: { prefetchScope?: unknown }): PrefetchConfig => ({
  scope: sanitizePrefetchScope(settings.prefetchScope),
});
