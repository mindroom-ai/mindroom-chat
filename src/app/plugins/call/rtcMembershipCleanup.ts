import { EventType, MatrixClient, MatrixError, Room } from 'matrix-js-sdk';
import { getStateEvents } from '../../utils/room';
import { StateEvent } from '../../../types/matrix/room';

/**
 * Forced End-call teardown bypasses Element Call's own MatrixRTC
 * leave, and stale `org.matrix.msc3401.call.member` state only expires after
 * four hours. This module clears exactly this user's + this device's active
 * room-call membership slot — nothing else — after a forced disposal.
 *
 * Selection is pinned to the membership shape written by the shipped
 * `@element-hq/element-call-embedded@0.20.3` bundle
 * (`MembershipManager.makeMembershipStateKey` / `makeMyMembership`); revisit
 * the key-shape parity tests in `rtcMembershipCleanup.test.ts` on any Element
 * Call upgrade. The filter fails closed: on shape drift this module scrubs
 * nothing and the four-hour expiry remains the backstop.
 *
 * Cleanup ownership has two mechanisms, one per operation class:
 *
 * - Idempotent membership writes (`{}` PUTs) are fenced by a per-room
 *   *cleanup generation*: creating a new embed claims the room (the
 *   `callEmbedAtom` setter calls `acquireCallCleanupGeneration`) and every
 *   stale pending write is skipped before dispatch. A write already on the
 *   wire cannot be recalled (matrix-js-sdk exposes no abort), so every
 *   in-flight `org.matrix.msc3401.call.member` write — host cleanup PUTs
 *   *and* Element Call's own join/renewal/leave publishes through
 *   `CallWidgetDriver.sendEvent` — is tracked per room, and the two ordering
 *   consumers wait (bounded) for the room's tracked writes to settle: a
 *   successor's membership publish (`CallWidgetDriver.sendEvent`) and the
 *   terminal residual read of the detached cleanup (`useCallEmbed.ts`).
 *   Misordering past the bound is self-healing: the write is idempotent, the
 *   detached cleanup re-reads state after a settle delay, and Element Call's
 *   MembershipManager re-publishes when its own membership disappears.
 *
 * - Destructive room teardown (kick/leave/forget of an ephemeral agent
 *   room) is neither abortable nor idempotent, so it is never fenced —
 *   it is made race-free by construction: the room is *retired*
 *   synchronously before the first destructive request, and a retired room
 *   can never host a new call embed (`createCallEmbed` refuses it). No
 *   successor can exist for an in-flight kick or leave to harm.
 */

export type DeviceCallMembershipTarget = {
  roomId: string;
  stateKey: string;
};

const TRANSIENT_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 5000;
/**
 * A server-provided Retry-After is honored up to this larger bound:
 * clamping it *below* what the server asked for would guarantee the single
 * retry re-hits the same rate limit and the scrub is abandoned to the
 * four-hour expiry.
 */
const MAX_SERVER_RETRY_DELAY_MS = 30_000;

/**
 * Local timeout on each host cleanup `{}` PUT. The application's Matrix
 * client sets no default request timeout, and a blackholed PUT held forever
 * would block the detached cleanup chain (residual read, then agent-room
 * retire/kick/leave/forget) and keep its registry entry taxing every future
 * settle wait for the room.
 */
export const CALL_MEMBERSHIP_CLEANUP_WRITE_TIMEOUT_MS = 10_000;

/** 4xx statuses that are transient by definition and worth one retry. */
const RETRYABLE_HTTP_STATUSES = new Set([408, 429]);

const roomCleanupGenerations = new Map<string, number>();

/**
 * Claim cleanup ownership of a room for a newly created call embed,
 * invalidating every pending membership-cleanup write for that room.
 */
export const acquireCallCleanupGeneration = (roomId: string): number => {
  const generation = (roomCleanupGenerations.get(roomId) ?? 0) + 1;
  roomCleanupGenerations.set(roomId, generation);
  return generation;
};

export const currentCallCleanupGeneration = (roomId: string): number =>
  roomCleanupGenerations.get(roomId) ?? 0;

export const isCallCleanupGenerationCurrent = (roomId: string, generation: number): boolean =>
  currentCallCleanupGeneration(roomId) === generation;

/**
 * Rooms whose destructive teardown (kick/leave/forget) has started. Retained
 * for the session — bounded by the number of ephemeral call rooms ever ended,
 * and a retired room must stay unusable for as long as this client runs.
 */
const retiredCallRooms = new Set<string>();
const callRoomRetirementListeners = new Map<string, Set<() => void>>();

/**
 * Permanently retire an ephemeral call room. Must be called synchronously in
 * the same task step that verified cleanup ownership, *before* the first
 * destructive request is dispatched: kick/leave/forget cannot be aborted or
 * undone, so the only sound ownership rule is that a retired room is never
 * reused. `createCallEmbed` refuses retired rooms, which makes a same-room
 * successor impossible instead of fenced-against.
 */
export const retireCallRoom = (roomId: string): void => {
  if (retiredCallRooms.has(roomId)) return;
  retiredCallRooms.add(roomId);
  callRoomRetirementListeners.get(roomId)?.forEach((listener) => {
    try {
      listener();
    } catch {
      // A broken view subscriber must not block destructive room teardown.
    }
  });
};

export const isCallRoomRetired = (roomId: string): boolean => retiredCallRooms.has(roomId);

/** Subscribe one mounted call surface to retirement of its exact room. */
export const subscribeCallRoomRetirement = (roomId: string, listener: () => void): (() => void) => {
  let listeners = callRoomRetirementListeners.get(roomId);
  if (!listeners) {
    listeners = new Set();
    callRoomRetirementListeners.set(roomId, listeners);
  }
  const roomListeners = listeners;
  roomListeners.add(listener);
  return () => {
    roomListeners.delete(listener);
    if (roomListeners.size === 0 && callRoomRetirementListeners.get(roomId) === roomListeners) {
      callRoomRetirementListeners.delete(roomId);
    }
  };
};

/**
 * Thrown by the call-start chokepoint (`createCallEmbed`) for a retired
 * room. Distinguishable so UI surfaces can give the user retirement-specific
 * feedback instead of a generic failure — or silence.
 */
export class CallRoomRetiredError extends Error {
  constructor() {
    super('Failed to start call, this call room is already shutting down.');
    this.name = 'CallRoomRetiredError';
  }
}

const pendingRoomMembershipWrites = new Map<string, Set<Promise<void>>>();

/**
 * Track one in-flight `org.matrix.msc3401.call.member` write for a room
 * until it settles — the host's detached cleanup `{}` PUTs and Element
 * Call's own publishes through the widget driver alike. The generation
 * fence stops cleanup writes *before* dispatch; a write already on the wire
 * cannot be recalled, so ordering consumers (a successor's membership
 * publish, the terminal residual read) await settlement instead (see
 * `roomCallMembershipWritesSettled`). Returns the original promise with its
 * outcome untouched.
 */
export const trackRoomCallMembershipWrite = <T>(roomId: string, write: Promise<T>): Promise<T> => {
  let writes = pendingRoomMembershipWrites.get(roomId);
  if (!writes) {
    writes = new Set();
    pendingRoomMembershipWrites.set(roomId, writes);
  }
  const pending = writes;
  const settled: Promise<void> = write.then(
    () => undefined,
    () => undefined
  );
  pending.add(settled);
  settled.then(() => {
    pending.delete(settled);
    if (pending.size === 0 && pendingRoomMembershipWrites.get(roomId) === pending) {
      pendingRoomMembershipWrites.delete(roomId);
    }
  });
  return write;
};

/**
 * How long anyone may wait for a room's in-flight membership writes to
 * settle — a successor's membership publish gate and the terminal residual
 * read alike. A blackholed request must not wedge a new call's join or a
 * detached cleanup forever; past the bound the waiter proceeds, and any
 * stale write that later lands over fresh state is repaired by the residual
 * recheck and by Element Call's own missing-membership recovery.
 */
export const CALL_MEMBERSHIP_WRITES_SETTLE_TIMEOUT_MS = 10_000;

/**
 * Resolves `'settled'` once no membership write for the room remains in
 * flight, including writes dispatched while waiting (the loop terminates
 * because every cleanup dispatch is generation-checked and driver publishes
 * stop at disposal). With `timeoutMs`, resolves `'timed-out'` instead of
 * waiting past the bound — and then *evicts* the writes that were already
 * pending when the wait began: they outlived a full safety window, so
 * keeping them registered would tax every future wait for the room with the
 * full bound again (review A3, round 4). An evicted write that lands later
 * anyway is repaired the same way as any post-bound misordering. Writes
 * tracked after the wait began keep their own full window.
 */
export const roomCallMembershipWritesSettled = async (
  roomId: string,
  timeoutMs?: number
): Promise<'settled' | 'timed-out'> => {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout =
    timeoutMs === undefined
      ? undefined
      : new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve();
          }, timeoutMs);
        });
  const expiredOnTimeout = Array.from(pendingRoomMembershipWrites.get(roomId) ?? []);
  try {
    for (;;) {
      const pending = pendingRoomMembershipWrites.get(roomId);
      if (!pending || pending.size === 0) return 'settled';
      const allSettled = Promise.all(Array.from(pending));
      // eslint-disable-next-line no-await-in-loop
      await (timeout ? Promise.race([allSettled, timeout]) : allSettled);
      if (timedOut) {
        const current = pendingRoomMembershipWrites.get(roomId);
        if (current) {
          expiredOnTimeout.forEach((write) => current.delete(write));
          if (current.size === 0) pendingRoomMembershipWrites.delete(roomId);
        }
        return 'timed-out';
      }
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/**
 * The room-version-sensitive state key Element Call's bundled matrix-js-sdk
 * generates for the active `m.call` room slot
 * (`MembershipManager.makeMembershipStateKey`).
 */
export const expectedDeviceCallMembershipStateKey = (
  room: Room,
  userId: string,
  deviceId: string
): string => {
  const stateKey = `${userId}_${deviceId}_m.call`;
  return /^org\.matrix\.msc(3757|3779)\b/.exec(room.getVersion()) ? stateKey : `_${stateKey}`;
};

/**
 * Whether membership content verifiably describes an active `m.call`
 * room-call slot for this device. Shared by the local-cache and
 * server-authoritative reads so both fail closed on shape drift.
 */
const isActiveDeviceCallMembershipContent = (content: unknown, deviceId: string): boolean => {
  if (!content || typeof content !== 'object') return false;
  const record = content as Record<string, unknown>;
  if (Object.keys(record).length === 0) return false;
  if (record.device_id !== deviceId) return false;
  if (record.application !== 'm.call') return false;
  if (record.call_id !== '') return false;
  if (record.scope !== 'm.room') return false;
  return true;
};

/**
 * Discover only observed membership events that verifiably belong to the
 * current user, current device, and the active `m.call` room-call slot.
 * Guessed legacy key shapes, other devices, other call slots, other scopes,
 * bare-user aggregate events and already-empty events are never selected.
 */
export const findDeviceCallMemberships = (
  mx: MatrixClient,
  room: Room
): DeviceCallMembershipTarget[] => {
  const userId = mx.getUserId();
  const deviceId = mx.getDeviceId();
  if (!userId || !deviceId) return [];

  const expectedKey = expectedDeviceCallMembershipStateKey(room, userId, deviceId);

  return getStateEvents(room, StateEvent.GroupCallMemberPrefix)
    .filter((event) => {
      if (event.getSender() !== userId) return false;
      if (event.getStateKey() !== expectedKey) return false;
      return isActiveDeviceCallMembershipContent(event.getContent(), deviceId);
    })
    .map((event) => ({
      roomId: room.roomId,
      // The exact key already present on the verified event (equals
      // expectedKey by the filter above).
      stateKey: event.getStateKey() as string,
    }));
};

/**
 * Bound on the server-authoritative residual membership read. The GET has no
 * per-request timeout option, so the wait is raced against a timer; a read
 * that outlives the bound is treated as failed (the response is read-only
 * and harmless if it lands later).
 */
export const CALL_MEMBERSHIP_RESIDUAL_READ_TIMEOUT_MS = 10_000;

/**
 * Server-authoritative read of exactly this user's + this device's `m.call`
 * membership slot. A settled membership PUT does *not* update the local
 * `Room` state cache — only its /sync echo does — so the terminal residual
 * check must ask the server, or a successfully published join/renewal whose
 * sync echo is slower than the residual delay becomes a ghost membership on
 * a disposed iframe. Returns the targets to scrub, `[]` when the slot is
 * verifiably empty or absent, or `null` when the read failed/timed out (the
 * caller falls back to the local cache).
 */
export const fetchDeviceCallMembershipsFromServer = async (
  mx: MatrixClient,
  room: Room,
  timeoutMs = CALL_MEMBERSHIP_RESIDUAL_READ_TIMEOUT_MS
): Promise<DeviceCallMembershipTarget[] | null> => {
  const userId = mx.getUserId();
  const deviceId = mx.getDeviceId();
  if (!userId || !deviceId) return [];
  const stateKey = expectedDeviceCallMembershipStateKey(room, userId, deviceId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const content = await Promise.race([
      mx.getStateEvent(room.roomId, EventType.GroupCallMemberPrefix, stateKey),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('residual membership read timed out'));
        }, timeoutMs);
      }),
    ]);
    return isActiveDeviceCallMembershipContent(content, deviceId)
      ? [{ roomId: room.roomId, stateKey }]
      : [];
  } catch (error) {
    // The slot never existed: verifiably nothing to scrub.
    if (error instanceof MatrixError && error.errcode === 'M_NOT_FOUND') return [];
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const isPermanentMatrixError = (error: unknown): boolean =>
  error instanceof MatrixError &&
  typeof error.httpStatus === 'number' &&
  error.httpStatus > 0 &&
  error.httpStatus < 500 &&
  !RETRYABLE_HTTP_STATUSES.has(error.httpStatus);

/**
 * Delay before the single retry: honors a server-provided Retry-After when
 * available, never below the base delay and never unbounded. A server ask
 * is clamped *up* to `MAX_SERVER_RETRY_DELAY_MS` — retrying sooner than the
 * server asked would guarantee another rate limit — while the no-hint bound
 * stays short to keep the detached task short-lived.
 */
export const membershipCleanupRetryDelayMs = (error: unknown, baseDelayMs: number): number => {
  let retryAfterMs: number | null = null;
  if (error instanceof MatrixError) {
    try {
      retryAfterMs = error.getRetryAfterMs();
    } catch {
      retryAfterMs = null; // malformed retry_after_ms from the server
    }
  }
  const boundMs = retryAfterMs === null ? MAX_RETRY_DELAY_MS : MAX_SERVER_RETRY_DELAY_MS;
  return Math.min(Math.max(retryAfterMs ?? baseDelayMs, baseDelayMs), boundMs);
};

const describeMembershipError = (error: unknown): string => {
  if (error instanceof MatrixError) {
    return `${error.errcode ?? 'M_UNKNOWN'} (HTTP ${error.httpStatus ?? '?'})`;
  }
  // Name the class only (never exception text): a TypeError from a refactor
  // must not be mislabeled as a network problem.
  if (error instanceof Error) return error.constructor.name;
  return 'unknown error';
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Clear each verified current-device membership by sending `{}` to its exact
 * observed state key. Best-effort and detached from UI teardown: every
 * rejection is consumed, one transient (network/5xx/408/429) failure is
 * retried once after a bounded delay, permanent Matrix errors are never
 * retried, and only an exhausted retry emits a single redacted diagnostic.
 *
 * `generation` is the owning embed's cleanup generation: each write is
 * skipped once a newer call embed has claimed the room, so a delayed retry
 * can never clobber a successor call's membership.
 */
export const clearDeviceCallMemberships = async (
  mx: MatrixClient,
  targets: DeviceCallMembershipTarget[],
  generation: number,
  retryDelayMs = TRANSIENT_RETRY_DELAY_MS
): Promise<void> => {
  await Promise.all(
    targets.map(async ({ roomId, stateKey }) => {
      if (!isCallCleanupGenerationCurrent(roomId, generation)) return;
      const sendClear = () =>
        mx.sendStateEvent(roomId, EventType.GroupCallMemberPrefix, {}, stateKey, {
          // Finite by construction: a blackholed PUT must neither block the
          // detached cleanup chain nor squat in the write registry forever.
          localTimeoutMs: CALL_MEMBERSHIP_CLEANUP_WRITE_TIMEOUT_MS,
        });
      let firstError: unknown;
      try {
        await trackRoomCallMembershipWrite(roomId, sendClear());
        return;
      } catch (error) {
        if (isPermanentMatrixError(error)) return;
        firstError = error;
      }
      await delay(membershipCleanupRetryDelayMs(firstError, retryDelayMs));
      if (!isCallCleanupGenerationCurrent(roomId, generation)) return;
      try {
        await trackRoomCallMembershipWrite(roomId, sendClear());
      } catch (retryError) {
        console.warn(
          `[call-termination] failed to clear stale call membership state key "${stateKey}": ` +
            describeMembershipError(retryError)
        );
      }
    })
  );
};
