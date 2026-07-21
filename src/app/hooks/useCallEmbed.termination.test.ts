import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClient, MatrixError, Room } from 'matrix-js-sdk';
import { CallEmbed, CallTermination } from '../plugins/call';
import {
  CALL_MEMBERSHIP_CLEANUP_WRITE_TIMEOUT_MS,
  CALL_MEMBERSHIP_RESIDUAL_READ_TIMEOUT_MS,
  CALL_MEMBERSHIP_WRITES_SETTLE_TIMEOUT_MS,
  acquireCallCleanupGeneration,
  isCallRoomRetired,
  trackRoomCallMembershipWrite,
} from '../plugins/call/rtcMembershipCleanup';
import {
  CALL_END_RESIDUAL_MEMBERSHIP_DELAY_MS,
  buildCallTerminationDeps,
} from '../state/callTerminationOwner';
import { createCallEmbed } from './useCallEmbed';

vi.mock('./useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

// The real useTheme drags in vanilla-extract styles that cannot load in vitest.
vi.mock('./useTheme', () => ({
  ThemeKind: { Dark: 'dark', Light: 'light' },
  useTheme: () => ({ id: 'dark-theme', kind: 'dark', classNames: [] }),
}));

const USER_ID = '@alice:mindroom.test';
const DEVICE_ID = 'HOSTDEV';
const ROOM_ID = '!call:mindroom.test';
const MEMBER_STATE_KEY = `_${USER_ID}_${DEVICE_ID}_m.call`;

const ownMembershipEvent = () => ({
  getSender: () => USER_ID,
  getStateKey: () => MEMBER_STATE_KEY,
  getContent: () => ({
    application: 'm.call',
    call_id: '',
    scope: 'm.room',
    device_id: DEVICE_ID,
    focus_active: { type: 'livekit', focus_selection: 'oldest_membership' },
  }),
});

const otherDeviceMembershipEvent = () => ({
  getSender: () => USER_ID,
  getStateKey: () => `_${USER_ID}_OTHERDEV_m.call`,
  getContent: () => ({
    application: 'm.call',
    call_id: '',
    scope: 'm.room',
    device_id: 'OTHERDEV',
  }),
});

const agentCallEvent = () => ({
  getSender: () => USER_ID,
  getContent: () => ({
    version: 1,
    agent_user_id: '@mindroom_helper:mindroom.test',
    creator_user_id: USER_ID,
    ephemeral: true,
  }),
});

const makeRoom = (memberEvents: unknown[], roomId = ROOM_ID): Room =>
  ({
    roomId,
    getVersion: () => '12',
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (type: string, stateKey?: string) => {
          if (type === 'org.matrix.msc3401.call.member') {
            return stateKey === undefined ? memberEvents : null;
          }
          if (type === 'io.mindroom.agent_call') {
            return stateKey === undefined ? [agentCallEvent()] : agentCallEvent();
          }
          return stateKey === undefined ? [] : null;
        },
      }),
    }),
  } as unknown as Room);

type Wiring = {
  calls: string[];
  mx: MatrixClient;
  embed: CallEmbed;
  clearEmbed: ReturnType<typeof vi.fn>;
  /** Mutable observed membership state; splice it to simulate a sync update. */
  memberEvents: unknown[];
};

const createWiring = (
  initialMemberEvents: unknown[] = [ownMembershipEvent()],
  roomId = ROOM_ID
): Wiring => {
  const calls: string[] = [];
  const memberEvents = [...initialMemberEvents];
  const mx = {
    getUserId: () => USER_ID,
    getSafeUserId: () => USER_ID,
    getDeviceId: () => DEVICE_ID,
    sendStateEvent: vi.fn(async (roomId: string, type: string, content: object, key: string) => {
      calls.push(`clear-membership:${key}`);
      return {};
    }),
    kick: vi.fn(async () => {
      calls.push('kick');
    }),
    leave: vi.fn(async () => {
      calls.push('leave');
    }),
    forget: vi.fn(async () => {
      calls.push('forget');
    }),
  } as unknown as MatrixClient;

  const embed = {
    joined: true,
    room: makeRoom(memberEvents, roomId),
    hangup: vi.fn(
      () =>
        new Promise(() => {
          // never settles: models a wedged Element Call iframe
        })
    ),
  } as unknown as CallEmbed;

  const clearEmbed = vi.fn(() => {
    calls.push('clear-embed');
  });

  return { calls, mx, embed, clearEmbed, memberEvents };
};

const flushDetachedCleanup = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

const advancePastResidualCheck = async () => {
  await vi.advanceTimersByTimeAsync(CALL_END_RESIDUAL_MEMBERSHIP_DELAY_MS);
  await flushDetachedCleanup();
  await flushDetachedCleanup();
};

describe('buildCallTerminationDeps', () => {
  beforeEach(() => {
    // Keep setImmediate real so flushDetachedCleanup can drain microtask
    // chains while the residual-check and retry setTimeout delays are faked.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('on forced teardown disposes first, then scrubs this device before agent leave/forget', async () => {
    const { calls, mx, embed, clearEmbed, memberEvents } = createWiring([
      ownMembershipEvent(),
      otherDeviceMembershipEvent(),
    ]);
    const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

    deps.finalize('deadline');

    // Local disposal is synchronous and never gated on network cleanup.
    expect(calls[0]).toBe('clear-embed');
    await flushDetachedCleanup();

    // Only this device's exact observed state key is cleared immediately;
    // the agent-room teardown waits for the settled second look.
    expect(calls).toEqual(['clear-embed', `clear-membership:${MEMBER_STATE_KEY}`]);
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      ROOM_ID,
      'org.matrix.msc3401.call.member',
      {},
      MEMBER_STATE_KEY,
      { localTimeoutMs: CALL_MEMBERSHIP_CLEANUP_WRITE_TIMEOUT_MS }
    );

    // The host's own `{}` PUT echoes back via sync during the settle delay;
    // the second look finds nothing of ours left (the other device's slot
    // must survive) and moves on to the agent-room sequence.
    memberEvents.splice(0, memberEvents.length, otherDeviceMembershipEvent());
    await advancePastResidualCheck();

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'clear-embed',
      `clear-membership:${MEMBER_STATE_KEY}`,
      'kick',
      'leave',
      'forget',
    ]);
  });

  it('rescrubs membership that lands after the immediate forced scrub', async () => {
    // An Element Call publish (join or expiry renewal) already on the wire
    // when the deadline forced disposal can land on the homeserver after
    // the host's `{}` PUT and resurrect the slot; without the second look
    // it would ghost until the ~4-hour expiry.
    const { calls, mx, embed, clearEmbed } = createWiring();
    const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

    deps.finalize('deadline');
    await flushDetachedCleanup();
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);

    // memberEvents still reports the own-device slot after the settle delay
    // — exactly what a late-landing renewal that synced back looks like.
    await advancePastResidualCheck();

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([
      'clear-embed',
      `clear-membership:${MEMBER_STATE_KEY}`,
      `clear-membership:${MEMBER_STATE_KEY}`,
      'kick',
      'leave',
      'forget',
    ]);
  });

  it('on a healthy widget Close whose leave has synced back it never duplicates the PUT', async () => {
    const { calls, mx, embed, clearEmbed, memberEvents } = createWiring();
    const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

    deps.finalize('widget-close');
    expect(calls).toEqual(['clear-embed']);

    // Element Call's own leave PUT arrives via sync during the settle delay.
    memberEvents.splice(0, memberEvents.length);
    await advancePastResidualCheck();

    expect(mx.sendStateEvent).not.toHaveBeenCalled();
    expect(calls).toEqual(['clear-embed', 'kick', 'leave', 'forget']);
  });

  it('on a widget Close that left residual own-device membership it scrubs the exact key', async () => {
    // Element Call's error screen sends the same io.element.close without
    // completing its MatrixRTC leave; the membership never empties.
    const { calls, mx, embed, clearEmbed } = createWiring([
      ownMembershipEvent(),
      otherDeviceMembershipEvent(),
    ]);
    const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

    deps.finalize('widget-close');
    expect(calls).toEqual(['clear-embed']);

    await advancePastResidualCheck();

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      ROOM_ID,
      'org.matrix.msc3401.call.member',
      {},
      MEMBER_STATE_KEY,
      { localTimeoutMs: CALL_MEMBERSHIP_CLEANUP_WRITE_TIMEOUT_MS }
    );
    expect(calls).toEqual([
      'clear-embed',
      `clear-membership:${MEMBER_STATE_KEY}`,
      'kick',
      'leave',
      'forget',
    ]);
  });

  it('ends a never-joined call locally and still cleans the ephemeral agent room', async () => {
    const { calls, mx, embed, clearEmbed } = createWiring([]);
    (embed as { joined: boolean }).joined = false;
    const termination = new CallTermination(
      buildCallTerminationDeps(mx, embed, () => true, clearEmbed)
    );

    termination.endCall();
    await flushDetachedCleanup();

    expect(embed.hangup).not.toHaveBeenCalled();
    // No membership was observable at finalize time, so the forced end falls
    // through to the residual recheck instead of skipping the scrub outright.
    expect(calls).toEqual(['clear-embed']);

    await advancePastResidualCheck();
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
    expect(calls).toEqual(['clear-embed', 'kick', 'leave', 'forget']);
  });

  it('a forced end that captured no membership scrubs late-synced state after the recheck', async () => {
    // matrix-js-sdk state has no local echo: a membership Element Call
    // published just before the forced End may not be locally visible yet.
    // Without the recheck it would ghost until the ~4-hour expiry.
    const { calls, mx, embed, clearEmbed, memberEvents } = createWiring([]);
    const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

    deps.finalize('deadline');
    expect(calls).toEqual(['clear-embed']);

    memberEvents.push(ownMembershipEvent());
    await advancePastResidualCheck();

    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      ROOM_ID,
      'org.matrix.msc3401.call.member',
      {},
      MEMBER_STATE_KEY,
      { localTimeoutMs: CALL_MEMBERSHIP_CLEANUP_WRITE_TIMEOUT_MS }
    );
    expect(calls).toEqual([
      'clear-embed',
      `clear-membership:${MEMBER_STATE_KEY}`,
      'kick',
      'leave',
      'forget',
    ]);
  });

  it('scrubs a settled publish the server reports even when its sync echo never arrived', async () => {
    // Review A2 (round 5): `sendStateEvent` resolving does NOT update the
    // local Room state cache — only /sync does. A join/renewal PUT that
    // succeeded with a sync echo slower than the residual delay is invisible
    // to a cache-only read, and the membership would ghost on a disposed
    // iframe until passive expiry. The residual read must be
    // server-authoritative.
    const slowSyncRoom = '!slow-sync:mindroom.test';
    const { calls, mx, embed, clearEmbed } = createWiring([], slowSyncRoom);
    // The publish settled before disposal; nothing ever appears in the
    // local cache (memberEvents stays empty for the whole test).
    trackRoomCallMembershipWrite(slowSyncRoom, Promise.resolve());
    (mx as unknown as { getStateEvent: unknown }).getStateEvent = vi.fn(async () =>
      ownMembershipEvent().getContent()
    );
    const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

    deps.finalize('deadline');
    await advancePastResidualCheck();

    expect(mx.getStateEvent).toHaveBeenCalledWith(
      slowSyncRoom,
      'org.matrix.msc3401.call.member',
      MEMBER_STATE_KEY
    );
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'clear-embed',
      `clear-membership:${MEMBER_STATE_KEY}`,
      'kick',
      'leave',
      'forget',
    ]);
  });

  it('sends no PUT when the server reports the slot empty, despite a stale local cache', async () => {
    // The inverse direction of server authority: Element Call's leave landed
    // on the server but its sync echo is late, so the local cache still
    // shows the membership. A cache-driven scrub would be redundant noise.
    const staleCacheRoom = '!stale-cache:mindroom.test';
    const { calls, mx, embed, clearEmbed } = createWiring([ownMembershipEvent()], staleCacheRoom);
    (mx as unknown as { getStateEvent: unknown }).getStateEvent = vi.fn(async () => ({}));
    const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

    deps.finalize('widget-close');
    await advancePastResidualCheck();

    expect(mx.sendStateEvent).not.toHaveBeenCalled();
    expect(calls).toEqual(['clear-embed', 'kick', 'leave', 'forget']);
  });

  it('treats a never-existed slot (M_NOT_FOUND) as verifiably empty', async () => {
    const notFoundRoom = '!not-found:mindroom.test';
    const { mx, embed, clearEmbed } = createWiring([ownMembershipEvent()], notFoundRoom);
    (mx as unknown as { getStateEvent: unknown }).getStateEvent = vi.fn(async () => {
      throw new MatrixError({ errcode: 'M_NOT_FOUND', error: 'Event not found.' }, 404);
    });
    const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

    deps.finalize('widget-close');
    await advancePastResidualCheck();

    expect(mx.sendStateEvent).not.toHaveBeenCalled();
  });

  it('falls back to the local cache when the server read never answers', async () => {
    const deadReadRoom = '!dead-read:mindroom.test';
    const { mx, embed, clearEmbed } = createWiring([ownMembershipEvent()], deadReadRoom);
    (mx as unknown as { getStateEvent: unknown }).getStateEvent = vi.fn(
      () =>
        new Promise(() => {
          // blackholed GET: the read must not wedge the cleanup chain
        })
    );
    const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

    deps.finalize('widget-close');
    await advancePastResidualCheck();
    // Held at the bounded server read: no scrub or agent teardown yet.
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
    expect(mx.kick).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(CALL_MEMBERSHIP_RESIDUAL_READ_TIMEOUT_MS);
    await flushDetachedCleanup();
    await flushDetachedCleanup();

    // The local cache still verifiably shows this device's slot: scrubbed.
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(mx.kick).toHaveBeenCalledTimes(1);
    expect(mx.leave).toHaveBeenCalledTimes(1);
  });

  it('proceeds past a never-settling tracked publish at the drain bound (review A6)', async () => {
    // Lower-level tests cover `roomCallMembershipWritesSettled` timing out;
    // this pins that the production dependency wiring actually passes the
    // bound, so a blackholed Element Call publish can stall detached cleanup
    // only for the bounded window, never forever.
    const wedgedRoom = '!wedged-publish:mindroom.test';
    const { calls, mx, embed, clearEmbed } = createWiring([], wedgedRoom);
    trackRoomCallMembershipWrite(
      wedgedRoom,
      new Promise(() => {
        // never settles
      })
    );
    const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

    deps.finalize('deadline');
    await advancePastResidualCheck();
    // Still held at the drain, well past the residual delay.
    expect(calls).toEqual(['clear-embed']);

    await vi.advanceTimersByTimeAsync(CALL_MEMBERSHIP_WRITES_SETTLE_TIMEOUT_MS);
    await advancePastResidualCheck();

    expect(calls).toEqual(['clear-embed', 'kick', 'leave', 'forget']);
  });

  it('drains an in-flight Element Call membership publish before the residual read', async () => {
    // A join/renewal PUT dispatched through the widget driver before
    // disposal cannot be aborted; if the residual read ran before it
    // landed, the resurrected membership would ghost with no iframe left
    // to clear it (review A2, round 4).
    const drainRoom = '!drain-flight:mindroom.test';
    const { calls, mx, embed, clearEmbed, memberEvents } = createWiring([], drainRoom);
    let landPublish!: () => void;
    trackRoomCallMembershipWrite(
      drainRoom,
      new Promise<void>((resolve) => {
        landPublish = resolve;
      })
    );
    const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

    deps.finalize('deadline');
    await flushDetachedCleanup();

    // Well past the residual delay the cleanup is still waiting on the
    // tracked write: no read, no scrub, no agent teardown yet.
    await advancePastResidualCheck();
    expect(calls).toEqual(['clear-embed']);
    expect(mx.kick).not.toHaveBeenCalled();

    // The old publish lands and its state becomes locally visible via sync.
    memberEvents.push(ownMembershipEvent());
    landPublish();
    await flushDetachedCleanup();
    await advancePastResidualCheck();

    // The second look ran after the drain: the landed membership is
    // scrubbed and the agent room still cleaned.
    expect(calls).toEqual([
      'clear-embed',
      `clear-membership:${MEMBER_STATE_KEY}`,
      'kick',
      'leave',
      'forget',
    ]);
  });

  it('a throwing membership read never blocks local teardown or the agent cleanup', async () => {
    const { calls, mx, embed, clearEmbed } = createWiring();
    (embed as { room: Room }).room = {
      roomId: ROOM_ID,
      getVersion: () => '12',
      getLiveTimeline: () => ({
        getState: () => ({
          getStateEvents: (type: string, stateKey?: string) => {
            if (type === 'org.matrix.msc3401.call.member') {
              throw new Error('state cache corrupted');
            }
            if (type === 'io.mindroom.agent_call') {
              return stateKey === undefined ? [agentCallEvent()] : agentCallEvent();
            }
            return stateKey === undefined ? [] : null;
          },
        }),
      }),
    } as unknown as Room;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

      deps.finalize('deadline');
      // Cleanup preparation is best-effort: the local disposal must happen.
      expect(calls).toEqual(['clear-embed']);

      // The recheck read throws too — consumed — and the agent-room cleanup
      // still runs in the finally.
      await advancePastResidualCheck();
      expect(calls).toEqual(['clear-embed', 'kick', 'leave', 'forget']);
    } finally {
      warn.mockRestore();
    }
  });

  it('a throwing clearEmbed still starts the detached cleanup exactly once', async () => {
    const { calls, mx, embed, memberEvents } = createWiring();
    const throwingClear = vi.fn(() => {
      throw new Error('atom write failed');
    });
    const deps = buildCallTerminationDeps(mx, embed, () => true, throwingClear);

    // The failure propagates to the coordinator (which rolls back to a
    // retryable state), but the network obligations are not stranded.
    expect(() => deps.finalize('deadline')).toThrow('atom write failed');
    await flushDetachedCleanup();
    expect(calls).toEqual([`clear-membership:${MEMBER_STATE_KEY}`]);

    // A retried finalize after the failure must not double-run the cleanup.
    expect(() => deps.finalize('deadline')).toThrow('atom write failed');
    await flushDetachedCleanup();
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);

    memberEvents.splice(0, memberEvents.length);
    await advancePastResidualCheck();
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([`clear-membership:${MEMBER_STATE_KEY}`, 'kick', 'leave', 'forget']);
  });

  it('on a stale finalize it skips the atom write but still runs the residual cleanup', async () => {
    // The embed was replaced in the narrow window before the provider could
    // dispose this coordinator; the successor owns the atom, but this call's
    // network obligations must not be dropped.
    const { calls, mx, embed, clearEmbed } = createWiring();
    const deps = buildCallTerminationDeps(mx, embed, () => false, clearEmbed);

    deps.finalize('deadline');
    expect(clearEmbed).not.toHaveBeenCalled();
    expect(calls).toEqual([]);

    await advancePastResidualCheck();

    expect(calls).toEqual([`clear-membership:${MEMBER_STATE_KEY}`, 'kick', 'leave', 'forget']);
  });

  it('on abandon it runs the residual cleanup exactly once without touching the atom', async () => {
    const { calls, mx, embed, clearEmbed } = createWiring();
    const deps = buildCallTerminationDeps(mx, embed, () => false, clearEmbed);

    deps.abandon?.();
    // A late stale finalize after the abandon must not double-run cleanup.
    deps.finalize('deadline');

    await advancePastResidualCheck();

    expect(clearEmbed).not.toHaveBeenCalled();
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([`clear-membership:${MEMBER_STATE_KEY}`, 'kick', 'leave', 'forget']);
  });

  it('a same-room successor fences the abandoned cleanup wholesale', async () => {
    const { calls, mx, embed, clearEmbed } = createWiring();
    const deps = buildCallTerminationDeps(mx, embed, () => false, clearEmbed);

    // The replacement call embed claims the room (the callEmbedAtom setter
    // does this when a new embed is published).
    acquireCallCleanupGeneration(ROOM_ID);
    deps.abandon?.();

    await advancePastResidualCheck();

    // The successor owns every end-of-call obligation for this room now:
    // scrubbing or agent-room cleanup here would hit the live successor call.
    expect(mx.sendStateEvent).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('retires the room before destructive teardown, so no successor can exist mid-kick', async () => {
    // Kick/leave/forget cannot be aborted or undone once on the wire, so
    // they are never fenced mid-flight. Instead the room is retired
    // synchronously before the first request: `createCallEmbed` refuses a
    // retired room, which makes a same-room successor impossible while the
    // sequence runs to completion.
    const retireRoomId = '!retire-flow:mindroom.test';
    const { mx, embed, clearEmbed } = createWiring([], retireRoomId);
    let settleKick!: () => void;
    (mx.kick as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          settleKick = resolve;
        })
    );
    const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

    deps.finalize('deadline');
    expect(isCallRoomRetired(retireRoomId)).toBe(false);
    await advancePastResidualCheck();
    expect(mx.kick).toHaveBeenCalledTimes(1);

    // While the kick is still on the wire, the room is already retired and
    // the single call-embed chokepoint refuses to start a call there.
    expect(isCallRoomRetired(retireRoomId)).toBe(true);
    expect(() => createCallEmbed(mx, embed.room, false, 'dark', {} as HTMLElement)).toThrow(
      'shutting down'
    );

    settleKick();
    await flushDetachedCleanup();
    await flushDetachedCleanup();

    // With no successor possible, the sequence completes unguarded.
    expect(mx.leave).toHaveBeenCalledTimes(1);
    expect(mx.forget).toHaveBeenCalledTimes(1);
  });

  it('a successor claim during the retry delay stops the scrub and the agent cleanup', async () => {
    const { mx, embed, clearEmbed } = createWiring();
    (mx.sendStateEvent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('fetch failed')
    );
    const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

    deps.finalize('deadline');
    await flushDetachedCleanup();
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);

    // The user rejoins the same room while the transient-failure retry is
    // pending; the stale retry must not clear the new call's membership and
    // the stale agent cleanup must not leave the new call's room.
    acquireCallCleanupGeneration(ROOM_ID);
    await vi.advanceTimersByTimeAsync(10_000);
    await flushDetachedCleanup();

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(mx.kick).not.toHaveBeenCalled();
    expect(mx.leave).not.toHaveBeenCalled();
    expect(mx.forget).not.toHaveBeenCalled();
  });

  it('consumes detached cleanup failures without unhandled rejections', async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const { mx, embed, clearEmbed } = createWiring([]);
      // Every kick/leave/forget rejection is already caught inside the agent
      // helper, so fail the cleanup at its one uncaught boundary — the agent
      // state read — to prove the detached task's rejection is consumed.
      (embed as { room: Room }).room = {
        roomId: ROOM_ID,
        getVersion: () => '12',
        getLiveTimeline: () => ({
          getState: () => ({
            getStateEvents: (type: string, stateKey?: string) => {
              if (type === 'io.mindroom.agent_call') {
                throw new Error('state unavailable');
              }
              return stateKey === undefined ? [] : null;
            },
          }),
        }),
      } as unknown as Room;
      const deps = buildCallTerminationDeps(mx, embed, () => true, clearEmbed);

      deps.finalize('transport-rejected');
      // Zero captured targets take the recheck path before the agent-state
      // read gets its chance to fail.
      await advancePastResidualCheck();
      await flushDetachedCleanup();

      expect(clearEmbed).toHaveBeenCalledTimes(1);
      expect(mx.kick).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
    expect(unhandled).toEqual([]);
  });
});
