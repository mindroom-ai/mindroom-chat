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
