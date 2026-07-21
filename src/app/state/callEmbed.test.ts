import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import { callEmbedAtom } from './callEmbed';
import { CALL_END_RESIDUAL_MEMBERSHIP_DELAY_MS } from './callTerminationOwner';
import { CallEmbed } from '../plugins/call';
import { currentCallCleanupGeneration } from '../plugins/call/rtcMembershipCleanup';

const USER_ID = '@alice:mindroom.test';
const DEVICE_ID = 'HOSTDEV';
const MEMBER_STATE_KEY = `_${USER_ID}_${DEVICE_ID}_m.call`;

/**
 * A minimal embed the atom setter can build a cleanup owner for: the owner
 * is created at publish now, so every fake needs the room and client the
 * deps builder captures. The null-identity client makes the detached
 * cleanup a verifiable no-op for tests that only exercise atom semantics.
 */
const makeEmbed = (roomId: string): CallEmbed =>
  ({
    roomId,
    joined: false,
    room: {
      roomId,
      getVersion: () => '12',
      getLiveTimeline: () => ({
        getState: () => ({
          getStateEvents: (_type: string, stateKey?: string) =>
            stateKey === undefined ? [] : null,
        }),
      }),
    },
    client: { getUserId: () => null, getDeviceId: () => null },
    hangup: vi.fn(),
    dispose: vi.fn(),
  } as unknown as CallEmbed);

describe('callEmbedAtom', () => {
  it('claims the room cleanup generation when a new embed is published, not when clearing', () => {
    const store = createStore();
    const roomId = '!atom-claim:mindroom.test';
    const before = currentCallCleanupGeneration(roomId);
    const embed = makeEmbed(roomId);

    store.set(callEmbedAtom, embed);
    expect(currentCallCleanupGeneration(roomId)).toBe(before + 1);

    // Clearing must not claim: it happens while the finalizer's own detached
    // cleanup for this very embed is starting, which must stay current.
    store.set(callEmbedAtom, undefined);
    expect(currentCallCleanupGeneration(roomId)).toBe(before + 1);
    expect(embed.dispose).toHaveBeenCalledTimes(1);
  });

  it('a same-room replacement claims again and disposes only the predecessor', () => {
    const store = createStore();
    const roomId = '!atom-replace:mindroom.test';
    const before = currentCallCleanupGeneration(roomId);
    const first = makeEmbed(roomId);
    const second = makeEmbed(roomId);

    store.set(callEmbedAtom, first);
    store.set(callEmbedAtom, second);

    expect(currentCallCleanupGeneration(roomId)).toBe(before + 2);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
    expect(store.get(callEmbedAtom)).toBe(second);
  });

  it('still clears and replaces when the outgoing embed throws on dispose', () => {
    const store = createStore();
    const roomId = '!atom-throwing-dispose:mindroom.test';
    const broken = makeEmbed(roomId);
    (broken.dispose as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('iframe already detached');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      store.set(callEmbedAtom, broken);

      // Clearing must not latch the broken embed as the current value: End
      // would otherwise be permanently inert.
      store.set(callEmbedAtom, undefined);
      expect(store.get(callEmbedAtom)).toBeUndefined();

      // Replacing over a broken embed must publish the successor too.
      store.set(callEmbedAtom, broken);
      const replacement = makeEmbed(roomId);
      store.set(callEmbedAtom, replacement);
      expect(store.get(callEmbedAtom)).toBe(replacement);
    } finally {
      warn.mockRestore();
    }
  });

  it('re-publishing the identical embed neither claims nor disposes', () => {
    const store = createStore();
    const roomId = '!atom-same:mindroom.test';
    const embed = makeEmbed(roomId);

    store.set(callEmbedAtom, embed);
    const claimed = currentCallCleanupGeneration(roomId);
    store.set(callEmbedAtom, embed);

    expect(currentCallCleanupGeneration(roomId)).toBe(claimed);
    expect(embed.dispose).not.toHaveBeenCalled();
  });

  describe('atom-anchored cleanup ownership', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const flushDetachedCleanup = () =>
      new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

    const advancePastResidualCheck = async () => {
      await vi.advanceTimersByTimeAsync(CALL_END_RESIDUAL_MEMBERSHIP_DELAY_MS);
      await flushDetachedCleanup();
      await flushDetachedCleanup();
    };

    const makeWiredEmbed = (roomId: string) => {
      const calls: string[] = [];
      const memberEvent = {
        getSender: () => USER_ID,
        getStateKey: () => MEMBER_STATE_KEY,
        getContent: () => ({
          application: 'm.call',
          call_id: '',
          scope: 'm.room',
          device_id: DEVICE_ID,
        }),
      };
      const agentCallEvent = {
        getSender: () => USER_ID,
        getContent: () => ({
          version: 1,
          agent_user_id: '@mindroom_helper:mindroom.test',
          creator_user_id: USER_ID,
          ephemeral: true,
        }),
      };
      const client = {
        getUserId: () => USER_ID,
        getSafeUserId: () => USER_ID,
        getDeviceId: () => DEVICE_ID,
        sendStateEvent: vi.fn(
          async (_roomId: string, _type: string, _content: object, key: string) => {
            calls.push(`clear-membership:${key}`);
            return {};
          }
        ),
        kick: vi.fn(async () => {
          calls.push('kick');
        }),
        leave: vi.fn(async () => {
          calls.push('leave');
        }),
        forget: vi.fn(async () => {
          calls.push('forget');
        }),
      };
      const embed = {
        roomId,
        joined: false,
        room: {
          roomId,
          getVersion: () => '12',
          getLiveTimeline: () => ({
            getState: () => ({
              getStateEvents: (type: string, stateKey?: string) => {
                if (type === 'org.matrix.msc3401.call.member') {
                  return stateKey === undefined ? [memberEvent] : null;
                }
                if (type === 'io.mindroom.agent_call') {
                  return stateKey === undefined ? [agentCallEvent] : agentCallEvent;
                }
                return stateKey === undefined ? [] : null;
              },
            }),
          }),
        },
        client,
        hangup: vi.fn(),
        dispose: vi.fn(),
      } as unknown as CallEmbed;
      return { embed, client, calls };
    };

    it('a publish replaced in the same synchronous frame still runs its cleanup (review A1/B1)', async () => {
      // The round-5 boundary: cleanup ownership is anchored to the atom, not
      // to a React render. Two publications inside one commit dispose the
      // intermediate embed before any component ever rendered it — its RTC
      // membership scrub and ephemeral agent-room teardown must run anyway.
      const store = createStore();
      const intermediate = makeWiredEmbed('!batched-intermediate:mindroom.test');
      const final = makeWiredEmbed('!batched-final:mindroom.test');

      store.set(callEmbedAtom, intermediate.embed);
      store.set(callEmbedAtom, final.embed);

      // The intermediate iframe was torn down synchronously...
      expect(intermediate.embed.dispose).toHaveBeenCalledTimes(1);
      expect(store.get(callEmbedAtom)).toBe(final.embed);

      await advancePastResidualCheck();

      // ...and its room's network obligations ran without any render:
      // residual membership scrubbed, agent room kicked/left/forgotten.
      expect(intermediate.calls).toEqual([
        `clear-membership:${MEMBER_STATE_KEY}`,
        'kick',
        'leave',
        'forget',
      ]);
      expect(intermediate.client.leave).toHaveBeenCalledWith('!batched-intermediate:mindroom.test');
      // The live replacement is untouched.
      expect(final.embed.dispose).not.toHaveBeenCalled();
      expect(final.calls).toEqual([]);
    });
  });
});
