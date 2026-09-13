/**
 * CINNY-207 P4.2: prefetch policy.
 *
 * Encodes decision D3 from the cache overhaul plan: which rooms are
 * eligible for background prefetch (tail-fill after startup, gap-fills
 * after limited sync, room-tail deep history, thread inventory), and
 * which rooms the scheduler should leave alone. The design goal is
 * "friendly to remote homeservers": we only speculatively fetch from
 * OUR homeserver's rooms. Federated rooms wait for user attention.
 *
 * "My server" is determined by comparing OUR homeserver's domain
 * (`mx.getDomain()`) to the SENDER DOMAIN of the room's
 * `m.room.create` state event. This is the room v12 / MSC4291 way —
 * `!localpart:server.example` room ids are being phased out in favor
 * of opaque ids, so the room id is NEVER parsed. When the create
 * event is missing (state hasn't caught up, ACL blocked, etc.) we
 * treat the room as federated (conservative — no speculative fetches).
 *
 * Encrypted rooms are always excluded from raw-fetch prefetch jobs:
 * fetching `/messages` for an encrypted room without decryption
 * context gives us unusable ciphertext, and the write-through only
 * ever caches decrypted events anyway.
 *
 * Concurrency + depth constants live here so callers pull them from
 * one place — the scheduler is the single arbiter for how deep any
 * one room's prefetch goes.
 */

import type { MatrixClient, Room } from 'matrix-js-sdk';
import { StateEvent } from '../../../types/matrix/room';
import { getStateEvent } from '../../utils/room';

// ---------- Public constants (D3) ----------

/**
 * The scope of every prefetch job in v1: only rooms whose create event
 * came from our own homeserver. Federated rooms are skipped unless the
 * user explicitly opens them (which enqueues a band-0 job).
 */
export const PREFETCH_SCOPE = 'my-server' as const;

/**
 * User-selectable prefetch scope (settings D4 / Phase 6.1). The literal
 * strings are stored verbatim in the settings blob — anything else
 * (older values, hand-edited JSON) is coerced to the default via
 * `sanitizePrefetchScope`. The default matches PREFETCH_SCOPE — the
 * conservative "friendly to remote homeservers" policy from D2.
 */
export type PrefetchScope = 'my-server' | 'all-rooms' | 'current-room-only';
export const DEFAULT_PREFETCH_SCOPE: PrefetchScope = 'my-server';
const PREFETCH_SCOPE_VALUES: ReadonlyArray<PrefetchScope> = [
  'my-server',
  'all-rooms',
  'current-room-only',
];

/**
 * Depth (in raw events) of the background room-tail prefetch job for
 * my-server rooms other than the currently focused one. Kept modest
 * so a fresh session doesn't hammer the server.
 */
export const ROOM_TAIL_PREFETCH_DEPTH = 200;

/**
 * Depth (in threads) of the thread inventory prewarm job. This is the
 * number of thread-seed jobs we speculatively enqueue for a room the
 * user just entered — enough to make the thread overview responsive
 * without paying for every historical thread.
 */
export const THREAD_INVENTORY_PREFETCH_LIMIT = 50;

/**
 * Target depth (in raw events) of the current-room deep-history sweep
 * — the band-4 job that replaces the removed eager-preload loop
 * (P4.3). Sized generously: this is the room the user is looking at,
 * so we make scrollback and search inside it feel bottomless.
 */
export const CURRENT_ROOM_DEEP_HISTORY_TARGET = 10_000;

// ---------- Room create sender domain ----------

/**
 * The domain segment of a Matrix user id (`@name:domain` or
 * `@name:domain:port` → `domain[:port]`). Returns `undefined` for
 * anything that doesn't look like a user id — the `substring after
 * first ':'` semantics tolerate ports and colons in the domain.
 */
const senderDomainOf = (senderId: string | undefined | null): string | undefined => {
  if (typeof senderId !== 'string' || senderId.length === 0) return undefined;
  const colon = senderId.indexOf(':');
  if (colon < 0 || colon === senderId.length - 1) return undefined;
  return senderId.slice(colon + 1);
};

// ---------- Tier resolution ----------

/**
 * `own`: room was created by a user on our homeserver — eligible for
 * every prefetch band the scheduler offers.
 * `federated`: create event came from another homeserver — the
 * scheduler skips this room for background bands (1-3). The user can
 * still trigger a band-0 job by opening it.
 * `background`: create event is missing entirely. Treated as
 * federated for eligibility purposes, but tagged separately so the
 * ledger `federated=true` flag doesn't get set on a room whose
 * membership we simply haven't confirmed yet.
 */
export type RoomPrefetchTier = 'own' | 'federated' | 'background';

/**
 * Resolve a room's prefetch tier. Never parses the room id — reads the
 * create event's sender domain and compares to our homeserver domain.
 * Room v12 / MSC4291 opaque room ids are handled transparently
 * because we never touch the id.
 */
export const resolveRoomPrefetchTier = (mx: MatrixClient, room: Room): RoomPrefetchTier => {
  const ourDomain = mx.getDomain?.();
  const createEvent = getStateEvent(room, StateEvent.RoomCreate);
  const senderDomain = senderDomainOf(createEvent?.getSender?.());
  if (!senderDomain) return 'background';
  if (!ourDomain) return 'federated';
  return senderDomain === ourDomain ? 'own' : 'federated';
};

/**
 * True when a raw-fetch prefetch job is safe to run against this room.
 * Currently excludes encrypted rooms (unusable ciphertext without
 * decryption context) and — as the second guard — anything not tier
 * `own`. Callers use this to skip enqueue rather than to skip execute:
 * the scheduler doesn't inspect rooms, the caller does.
 */
export const isRoomEligibleForRawFetch = (
  mx: MatrixClient,
  room: Room,
  tier: RoomPrefetchTier = resolveRoomPrefetchTier(mx, room)
): boolean => {
  if (tier !== 'own') return false;
  if (room.hasEncryptionStateEvent?.()) return false;
  return true;
};

// ---------- User settings resolvers (Phase 6.1 / D4) ----------

/**
 * Coerce an arbitrary settings value into a valid `PrefetchScope`.
 * Anything not on the whitelist — including older enum values, hand-
 * edited JSON, or genuine `undefined` — becomes the default. Same
 * shape as the sanitizers in `state/settings.ts` (silent fallback,
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
 * The runtime prefetch config the scheduler / executors consume.
 * Two of the four fields are user-facing (scope, currentRoomDepth);
 * the other two are non-user-visible constants surfaced here so
 * callers have a single place to reach for policy numbers.
 */
export type PrefetchConfig = {
  readonly scope: PrefetchScope;
  readonly currentRoomDepth: number;
  readonly roomTailDepth: number;
  readonly threadInventoryLimit: number;
};

/**
 * Pure resolver: build a `PrefetchConfig` from a settings snapshot.
 * Anything shape-adjacent works — the caller passes in whatever holds
 * `prefetchScope` and `prefetchDepth`, and the function coerces via
 * the sanitizers above. Kept pure so the engine's `noteRoomFocused` /
 * scheduler / tests can compute the same config off any snapshot
 * without pulling jotai into non-React modules.
 */
export const resolvePrefetchConfig = (settings: {
  prefetchScope?: unknown;
  prefetchDepth?: unknown;
}): PrefetchConfig => ({
  scope: sanitizePrefetchScope(settings.prefetchScope),
  currentRoomDepth: sanitizePrefetchDepth(settings.prefetchDepth),
  roomTailDepth: ROOM_TAIL_PREFETCH_DEPTH,
  threadInventoryLimit: THREAD_INVENTORY_PREFETCH_LIMIT,
});

/**
 * CINNY-207 P7.2 audit finding #5: scope-aware eligibility gate for
 * BACKGROUND prefetch bands (bands 1-3 in the scheduler). Consulted by
 * the gap-fill executor and any other consumer that decides whether a
 * given (room, currently-focused-room) pair is allowed to run a
 * background raw fetch.
 *
 * Semantics match the UI selector strings in `MindroomPrefetchSettings.tsx`:
 *   - `my-server` (default): only rooms whose `create.sender` domain
 *     matches ours. Encrypted rooms still blocked. This is the
 *     historical `isRoomEligibleForRawFetch` behavior.
 *   - `all-rooms`: any joined room, own or federated (background tier
 *     still counts as federated for policy purposes). Encrypted rooms
 *     still blocked — ciphertext is unusable without decryption
 *     context.
 *   - `current-room-only`: only the currently-focused room is
 *     eligible. Every other room is suppressed for background bands
 *     regardless of tier. A user opening a specific room can still
 *     trigger a band-0 fetch via `noteRoomFocused`.
 *
 * `focusedRoomId` is the room id the user is currently looking at (as
 * tracked by the engine's most recent `noteRoomFocused` call). It is
 * consulted by the `current-room-only` branch only.
 *
 * The band-0 (foreground) path is NOT gated by this function: opening
 * a room the user actively navigates to is always eligible, otherwise
 * the client couldn't fill from history in the very room being read.
 */
export const isRoomEligibleForBackgroundPrefetch = ({
  mx,
  room,
  scope,
  focusedRoomId,
}: {
  mx: MatrixClient;
  room: Room;
  scope: PrefetchScope;
  focusedRoomId: string | undefined;
}): boolean => {
  if (room.hasEncryptionStateEvent?.()) return false;
  if (scope === 'current-room-only') {
    return focusedRoomId === room.roomId;
  }
  if (scope === 'all-rooms') {
    return true;
  }
  // Default 'my-server': historical behavior — only own-tier rooms.
  return resolveRoomPrefetchTier(mx, room) === 'own';
};
