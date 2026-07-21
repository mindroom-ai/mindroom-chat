import { MatrixClient } from 'matrix-js-sdk';
import {
  CallEmbed,
  CallTermination,
  CallTerminationDeps,
  DeviceCallMembershipTarget,
  clearDeviceCallMemberships,
  findDeviceCallMemberships,
  isForcedTermination,
} from '../plugins/call';
import {
  CALL_MEMBERSHIP_WRITES_SETTLE_TIMEOUT_MS,
  currentCallCleanupGeneration,
  fetchDeviceCallMembershipsFromServer,
  isCallCleanupGenerationCurrent,
  roomCallMembershipWritesSettled,
} from '../plugins/call/rtcMembershipCleanup';
import { cleanupMindroomAgentCall } from '../mindroom/calls/agentCall';

/**
 * Cleanup ownership for published call embeds (CINNY-129).
 *
 * Every embed's end-of-call obligations (bounded End teardown, residual RTC
 * membership scrub, ephemeral agent-room cleanup) are owned by exactly one
 * `CallTermination` coordinator, created here **synchronously when the
 * `callEmbedAtom` setter publishes the embed** and disposed by the same
 * setter when the embed is replaced or cleared. Anchoring the owner to the
 * atom — not to a React render — closes the batched-replacement gap: two
 * publications inside one React commit dispose the intermediate iframe
 * before any component ever rendered it, and a render-created owner would
 * simply never have existed for it. The controller hook only *looks up* the
 * owner; it never creates or disposes one.
 */

/**
 * How long every termination waits before the settled second look at
 * observed RTC membership. Element Call's own leave PUT — and the host's
 * immediate forced scrub — only become visible locally via sync, so an
 * immediate re-read would report the stale pre-leave state on nearly every
 * healthy end and trigger a redundant `{}` PUT. One sync round trip is
 * normally well under a second; this bound stays generous without delaying
 * the detached agent-room cleanup noticeably.
 */
export const CALL_END_RESIDUAL_MEMBERSHIP_DELAY_MS = 2500;

const residualCheckDelay = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, CALL_END_RESIDUAL_MEMBERSHIP_DELAY_MS);
  });

/**
 * Builds the coordinator's environment for one CallEmbed identity (CINNY-129).
 *
 * The finalizer verifies the captured embed is still current, captures the
 * forced RTC membership cleanup targets before disposal, clears the embed
 * (which runs `CallEmbed.dispose()`), then starts detached best-effort
 * network cleanup that can never extend the End spinner or reject unhandled.
 *
 * Every network write is fenced by the room's cleanup generation, claimed by
 * this embed when the `callEmbedAtom` setter published it: once a successor
 * call embed claims the same room, this call's pending scrub and agent-room
 * cleanup are skipped wholesale — the successor owns all of the room's
 * end-of-call obligations from its claim on.
 *
 * Every termination takes the same cleanup shape: scrub what was verifiably
 * observed at finalize time (forced outcomes — transport rejection, host
 * deadline — certainly bypassed Element Call's MatrixRTC leave), then take
 * one settled second look and scrub only what verifiably remains. The
 * second look is unconditional because each path can leave residue the
 * first pass cannot see: a healthy widget Close may come from Element
 * Call's error screen without a leave (and this homeserver has no MSC4140
 * delayed-event backstop), matrix-js-sdk state has no local echo so a
 * just-published membership may be invisible at finalize time, and an
 * in-flight Element Call publish (join or expiry renewal) can land *after*
 * the immediate scrub. The `{}` PUT is idempotent against Element Call's
 * own leave, so re-scrubbing is always safe.
 */
export const buildCallTerminationDeps = (
  mx: MatrixClient,
  embed: CallEmbed,
  isCurrentEmbed: () => boolean,
  clearEmbed: () => void
): CallTerminationDeps => {
  const { roomId } = embed.room;
  // Captured while this embed is current, i.e. while it is the latest
  // claimant of its room; a same-room successor's claim invalidates it.
  const cleanupGeneration = currentCallCleanupGeneration(roomId);
  const ownsCleanup = () => isCallCleanupGenerationCurrent(roomId, cleanupGeneration);
  let cleanupStarted = false;

  const startDetachedCleanup = (targets: DeviceCallMembershipTarget[]): void => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    const cleanup = async () => {
      try {
        if (targets.length > 0) {
          await clearDeviceCallMemberships(mx, targets, cleanupGeneration);
        }
        // Element Call membership publishes (join, expiry renewal) that were
        // dispatched through the widget driver before disposal cannot be
        // aborted; drain them — bounded — so the second look below reads
        // state that includes anything that was still on the wire. A write
        // blackholed past the bound that lands even later has no iframe left
        // to recover it and falls to the four-hour expiry.
        await roomCallMembershipWritesSettled(roomId, CALL_MEMBERSHIP_WRITES_SETTLE_TIMEOUT_MS);
        // The settled second look: scrub only what verifiably remains after
        // one sync round trip (see the contract above for why every path,
        // including a forced scrub that already ran, needs it). The read is
        // server-authoritative: a settled membership PUT does not update the
        // local Room state cache — only its /sync echo does — so a slow sync
        // would make a cache-only read miss a successfully published
        // membership and ghost it until passive expiry. The local cache is
        // only a fallback when the server read fails.
        await residualCheckDelay();
        let observed: DeviceCallMembershipTarget[] = [];
        if (ownsCleanup()) {
          const serverObserved = await fetchDeviceCallMembershipsFromServer(mx, embed.room);
          observed = serverObserved ?? findDeviceCallMemberships(mx, embed.room);
        }
        if (observed.length > 0) {
          await clearDeviceCallMemberships(mx, observed, cleanupGeneration);
        }
      } finally {
        // Agent-room teardown (kick/leave/forget) cannot be aborted or
        // undone, so it is never fenced mid-flight. It only *starts* while
        // this call still owns the room's cleanup, and the helper retires
        // the room synchronously before its first request — the ownership
        // check and the retirement run in the same task step, so a
        // same-room successor is impossible from here on rather than
        // fenced-against.
        if (ownsCleanup()) {
          await cleanupMindroomAgentCall(mx, embed.room);
        }
      }
    };
    cleanup().catch(() => undefined);
  };

  return {
    isJoined: () => embed.joined,
    sendHangup: () => embed.hangup(),
    finalize: (reason) => {
      if (!isCurrentEmbed()) {
        // Replaced in the narrow window before the atom setter disposed this
        // coordinator: the atom write would hit the successor, but the
        // network obligations still belong to this call.
        startDetachedCleanup([]);
        return;
      }
      let targets: DeviceCallMembershipTarget[] = [];
      if (isForcedTermination(reason)) {
        try {
          targets = findDeviceCallMemberships(mx, embed.room);
        } catch (error) {
          // Cleanup preparation is best-effort and must never block local
          // teardown; the settled second look reads again once the room
          // state is readable.
          console.warn('[call-termination] failed to read RTC membership before disposal', error);
        }
      }
      try {
        clearEmbed();
      } finally {
        // Local teardown failing must not also strand the network cleanup.
        startDetachedCleanup(targets);
      }
    },
    abandon: () => startDetachedCleanup([]),
  };
};

/**
 * One live coordinator per CallEmbed identity. Entries die with their embed
 * (WeakMap); a disposed coordinator stays registered so a stale consumer can
 * only ever rebind it inert, never resurrect a replaced embed's termination.
 */
const callTerminationRegistry = new WeakMap<CallEmbed, CallTermination>();

/**
 * Create and register the cleanup owner for a freshly published embed. Must
 * be called by the `callEmbedAtom` setter *after* it claimed the room's
 * cleanup generation (the deps capture the just-claimed generation) and
 * before the publish becomes observable to consumers.
 */
export const createCallTerminationOwner = (
  embed: CallEmbed,
  isCurrentEmbed: () => boolean,
  clearEmbed: () => void
): CallTermination => {
  const created = new CallTermination(
    buildCallTerminationDeps(embed.client, embed, isCurrentEmbed, clearEmbed)
  );
  callTerminationRegistry.set(embed, created);
  return created;
};

/**
 * Detach a replaced or cleared embed's owner. Disposing hands every
 * non-finalized coordinator's network obligations to its abandon path, so a
 * predecessor that never rendered (batched same-commit replacement) is
 * cleaned up exactly like one that did.
 */
export const disposeCallTerminationOwner = (embed: CallEmbed): void => {
  callTerminationRegistry.get(embed)?.dispose();
};

export const getCallTermination = (embed: CallEmbed): CallTermination | undefined =>
  callTerminationRegistry.get(embed);
