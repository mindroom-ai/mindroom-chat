import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncState, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { CallMembership, MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc';
import { NativeScreenShareSession, companionMembershipStateKey } from './NativeScreenShareSession';
import type {
  NativeScreenSharePlugin,
  NativeScreenShareSheetStrings,
  NativeScreenShareStateEvent,
} from './nativeScreenShare';
import { SCREEN_ONLY_MEMBER_KEY, SCREEN_PARENT_DEVICE_KEY } from './callMemberships';

vi.mock('./rtcFocus', () => ({ requestSfuGrant: vi.fn() }));
vi.mock('./callKeyProvider', () => ({ sendCallKey: vi.fn() }));

import { requestSfuGrant } from './rtcFocus';
import { sendCallKey } from './callKeyProvider';

const ALICE = '@alice:example.com';
const BOB = '@bob:example.com';
const CAROL = '@carol:example.com';
const ROOM_ID = '!call:example.com';
const SERVICE_URL = 'https://sfu.example.com';
const CALL_MEMBER = 'org.matrix.msc3401.call.member';
const STATE_KEY = `_${ALICE}_IPHONE-screen_m.call`;

const makeMembership = (
  userId: string,
  deviceId: string,
  createdTs = 1_000,
  extra: Record<string, unknown> = {}
): CallMembership =>
  ({
    userId,
    deviceId,
    createdTs: () => createdTs,
    isExpired: () => false,
    applicationData: { type: 'm.call', ...extra },
  } as unknown as CallMembership);

const alice = (createdTs = 100) => makeMembership(ALICE, 'IPHONE', createdTs);
const bob = (createdTs = 200) => makeMembership(BOB, 'BOBDEV', createdTs);
const carol = (createdTs = 300) => makeMembership(CAROL, 'CAROLDEV', createdTs);
const screenCompanion = (userId: string, parentDeviceId: string, createdTs: number) =>
  makeMembership(userId, `${parentDeviceId}-screen`, createdTs, {
    [SCREEN_ONLY_MEMBER_KEY]: true,
    [SCREEN_PARENT_DEVICE_KEY]: parentDeviceId,
  });
const keyUpdate = (keyIndex: number) => expect.objectContaining({ generation: 1, keyIndex });

const deferred = <T = void>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const makeFixture = ({
  encrypted = true,
  roomVersion = '11',
  memberships = [alice(), bob()],
  strings,
}: {
  encrypted?: boolean;
  roomVersion?: string;
  memberships?: CallMembership[];
  strings?: NativeScreenShareSheetStrings;
} = {}) => {
  let syncState: SyncState = SyncState.Syncing;
  const sendStateEvent = vi.fn().mockResolvedValue({ event_id: '$state' });
  const getOpenIdToken = vi.fn().mockResolvedValue({
    access_token: 'oid-tok',
    token_type: 'Bearer',
    matrix_server_name: 'example.com',
    expires_in: 3600,
  });
  const mx = {
    getSafeUserId: () => ALICE,
    getDeviceId: () => 'IPHONE',
    getSyncState: () => syncState,
    getOpenIdToken,
    sendStateEvent,
  } as unknown as MatrixClient;
  const room = { roomId: ROOM_ID, getVersion: () => roomVersion } as unknown as Room;
  const session = { memberships } as unknown as Pick<MatrixRTCSession, 'memberships'>;

  let listener: ((event: NativeScreenShareStateEvent) => void) | undefined;
  const removeListener = vi.fn();
  const plugin: NativeScreenSharePlugin = {
    start: vi.fn().mockResolvedValue({ generation: 1 }),
    setKey: vi.fn().mockResolvedValue(undefined),
    updateAllowedParticipants: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockImplementation((_event, cb) => {
      listener = cb;
      return Promise.resolve({ remove: removeListener });
    }),
  };

  const onScreenKey = vi.fn();
  const onStateChange = vi.fn();
  const share = new NativeScreenShareSession({
    mx,
    room,
    session,
    serviceUrl: SERVICE_URL,
    primaryDeviceId: 'IPHONE',
    encrypted,
    strings,
    onScreenKey,
    onStateChange,
    plugin,
  });

  return {
    share,
    mx,
    room,
    session,
    plugin,
    sendStateEvent,
    removeListener,
    onScreenKey,
    onStateChange,
    setSyncState: (next: SyncState) => {
      syncState = next;
    },
    emitNative: (event: NativeScreenShareStateEvent) => listener?.(event),
  };
};

const startBroadcasting = async (fx: ReturnType<typeof makeFixture>) => {
  await fx.share.start();
  fx.emitNative({ generation: 1, state: 'broadcasting' });
  await vi.advanceTimersByTimeAsync(0);
};

describe('NativeScreenShareSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
    vi.mocked(requestSfuGrant).mockReset().mockResolvedValue({
      url: 'wss://lk.example.com',
      jwt: 'screen-jwt',
    });
    vi.mocked(sendCallKey).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('matches MembershipManager state-key formatting across room versions', () => {
    expect(
      companionMembershipStateKey({ getVersion: () => '11' }, ALICE, 'IPHONE-screen')
    ).toBe(`_${ALICE}_IPHONE-screen_m.call`);
    expect(
      companionMembershipStateKey(
        { getVersion: () => 'org.matrix.msc3757.11' },
        ALICE,
        'IPHONE-screen'
      )
    ).toBe(`${ALICE}_IPHONE-screen_m.call`);
  });

  it('publishes companion membership, distributes initial key to real peers only, and filters heartbeats by sync health', async () => {
    const bobCompanion = screenCompanion(BOB, 'BOBDEV', 250);
    const sheetStrings: NativeScreenShareSheetStrings = {
      title: 'Share entire screen',
      body: 'Body',
      caption: 'Caption',
      cancel: 'Cancel',
    };
    const fx = makeFixture({
      memberships: [alice(), bob(), bobCompanion],
      strings: sheetStrings,
    });

    await fx.share.start();

    expect(requestSfuGrant).toHaveBeenCalledWith(
      SERVICE_URL,
      expect.objectContaining({ roomId: ROOM_ID, deviceId: 'IPHONE-screen' })
    );
    expect(fx.plugin.start).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'wss://lk.example.com',
        token: 'screen-jwt',
        identity: `${ALICE}:IPHONE-screen`,
        encrypted: true,
        keyIndex: 0,
        allowedIdentities: [`${ALICE}:IPHONE`, `${BOB}:BOBDEV`],
        leaseMs: 90_000,
        strings: sheetStrings,
      })
    );
    expect(fx.sendStateEvent).not.toHaveBeenCalled();

    // User taps Start Broadcast in ReplayKit picker.
    fx.emitNative({ generation: 1, state: 'broadcasting' });
    await Promise.resolve();

    expect(fx.share.isBroadcasting).toBe(true);
    expect(fx.onStateChange).toHaveBeenCalledWith('broadcasting');
    expect(fx.onScreenKey).toHaveBeenCalledWith(expect.any(Uint8Array), 0, `${ALICE}:IPHONE-screen`);
    expect(fx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(fx.sendStateEvent).toHaveBeenCalledWith(
      ROOM_ID,
      CALL_MEMBER,
      expect.objectContaining({
        application: 'm.call',
        call_id: '',
        scope: 'm.room',
        device_id: 'IPHONE-screen',
        membershipID: `${ALICE}:IPHONE-screen`,
        expires: 120_000,
        'm.call.intent': 'video',
        focus_active: { type: 'livekit', focus_selection: 'multi_sfu' },
        foci_preferred: [
          { type: 'livekit', livekit_service_url: SERVICE_URL, livekit_alias: ROOM_ID },
        ],
        [SCREEN_ONLY_MEMBER_KEY]: true,
        [SCREEN_PARENT_DEVICE_KEY]: 'IPHONE',
      }),
      STATE_KEY
    );

    // Key delivered only to Bob's real device (not self, not Bob's screen companion).
    expect(sendCallKey).toHaveBeenCalledTimes(1);
    expect(sendCallKey).toHaveBeenCalledWith(
      fx.mx,
      expect.objectContaining({
        roomId: ROOM_ID,
        keyIndex: 0,
        memberId: `${ALICE}:IPHONE-screen`,
        claimedDeviceId: 'IPHONE-screen',
        to: expect.objectContaining({ userId: BOB, deviceId: 'BOBDEV' }),
      })
    );
    expect((vi.mocked(sendCallKey).mock.calls[0]?.[1].key as Uint8Array).byteLength).toBe(32);

    // Heartbeat fires while syncing or catching up, on foreground wake, and skips when unhealthy.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fx.plugin.heartbeat).toHaveBeenCalledTimes(1);
    fx.setSyncState(SyncState.Catchup);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fx.plugin.heartbeat).toHaveBeenCalledTimes(2);
    fx.share.onForeground();
    expect(fx.plugin.heartbeat).toHaveBeenCalledTimes(3);
    fx.setSyncState(SyncState.Reconnecting);
    await vi.advanceTimersByTimeAsync(10_000);
    fx.share.onForeground();
    expect(fx.plugin.heartbeat).toHaveBeenCalledTimes(3);

    await fx.share.stop();
  });

  it('sends current key to within-grace joiners, rotates on post-grace joiners and leavers with 1s rollout delay', async () => {
    const memberships = [alice(), bob()];
    const fx = makeFixture({ memberships });
    await startBroadcasting(fx);
    vi.mocked(sendCallKey).mockClear();

    // Within 10s grace period: Carol joins and gets existing keyIndex 0, no native setKey rotation.
    await vi.advanceTimersByTimeAsync(5_000);
    memberships.push(carol());
    fx.share.onMembershipsChanged();
    await vi.advanceTimersByTimeAsync(0);

    expect(fx.plugin.updateAllowedParticipants).toHaveBeenCalledWith({
      generation: 1,
      identities: [`${ALICE}:IPHONE`, `${BOB}:BOBDEV`, `${CAROL}:CAROLDEV`],
    });
    expect(sendCallKey).toHaveBeenCalledTimes(1);
    expect(sendCallKey).toHaveBeenCalledWith(
      fx.mx,
      expect.objectContaining({
        keyIndex: 0,
        to: expect.objectContaining({ userId: CAROL, deviceId: 'CAROLDEV' }),
      })
    );
    expect(fx.plugin.setKey).not.toHaveBeenCalled();

    // Departing peer: Bob leaves -> Carol gets rotated keyIndex 1; Bob gets nothing; native switches after 1s.
    vi.mocked(sendCallKey).mockClear();
    memberships.splice(1, 1); // remove Bob
    fx.share.onMembershipsChanged();
    await vi.advanceTimersByTimeAsync(0);

    expect(fx.plugin.updateAllowedParticipants).toHaveBeenLastCalledWith({
      generation: 1,
      identities: [`${ALICE}:IPHONE`, `${CAROL}:CAROLDEV`],
    });
    expect(sendCallKey).toHaveBeenCalledTimes(1);
    expect(sendCallKey).toHaveBeenCalledWith(
      fx.mx,
      expect.objectContaining({
        keyIndex: 1,
        to: expect.objectContaining({ userId: CAROL, deviceId: 'CAROLDEV' }),
      })
    );
    expect(fx.plugin.setKey).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fx.plugin.setKey).toHaveBeenCalledTimes(1);
    expect(fx.plugin.setKey).toHaveBeenCalledWith(keyUpdate(1));

    // Post-grace (>10s) joiner: Bob rejoins after 15s -> rotates to keyIndex 2.
    vi.mocked(sendCallKey).mockClear();
    vi.mocked(fx.plugin.setKey).mockClear();
    await vi.advanceTimersByTimeAsync(15_000);
    memberships.push(bob(400));
    fx.share.onMembershipsChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendCallKey).toHaveBeenCalledTimes(2);
    expect(sendCallKey).toHaveBeenCalledWith(fx.mx, expect.objectContaining({ keyIndex: 2 }));
    expect(fx.plugin.setKey).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fx.plugin.setKey).toHaveBeenCalledWith(keyUpdate(2));

    await fx.share.stop();
  });

  it('recovers failed rotation key delivery on the next healthy heartbeat and withdraws on system stop', async () => {
    const memberships = [alice(), bob(), carol()];
    const fx = makeFixture({ memberships });
    await startBroadcasting(fx);
    vi.mocked(sendCallKey).mockClear();

    // Carol leaves -> rotation to keyIndex 1; Bob's delivery fails once while Bob stays connected.
    vi.mocked(sendCallKey)
      .mockRejectedValueOnce(new Error('olm-temp'))
      .mockResolvedValueOnce(undefined);
    memberships.splice(2, 1);
    fx.share.onMembershipsChanged();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sendCallKey).toHaveBeenCalledTimes(1);
    expect(fx.plugin.setKey).toHaveBeenCalledWith(keyUpdate(1));

    // Unhealthy heartbeat skips retry; next healthy heartbeat delivers keyIndex 1 without reconnect.
    fx.setSyncState(SyncState.Reconnecting);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendCallKey).toHaveBeenCalledTimes(1);
    fx.setSyncState(SyncState.Syncing);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendCallKey).toHaveBeenCalledTimes(2);
    expect(sendCallKey).toHaveBeenLastCalledWith(
      fx.mx,
      expect.objectContaining({
        keyIndex: 1,
        to: expect.objectContaining({ userId: BOB, deviceId: 'BOBDEV' }),
      })
    );

    // Already sent for Bob's (createdTs=200, keyIndex=1): onPeerConnected does not duplicate.
    fx.share.onPeerConnected(`${BOB}:BOBDEV`);
    await vi.advanceTimersByTimeAsync(0);
    expect(sendCallKey).toHaveBeenCalledTimes(2);

    // System stop withdraws companion membership without calling plugin.stop().
    fx.emitNative({ generation: 1, state: 'stopped', reason: 'system' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fx.share.isBroadcasting).toBe(false);
    expect(fx.onStateChange).toHaveBeenCalledWith('stopped', 'system');
    expect(fx.plugin.stop).not.toHaveBeenCalled();
    expect(fx.removeListener).toHaveBeenCalledTimes(1);
    expect(fx.sendStateEvent).toHaveBeenLastCalledWith(ROOM_ID, CALL_MEMBER, {}, STATE_KEY);
  });

  it('forwards native stop detail, start error detail, and pre-broadcast cancellation cleanly', async () => {
    const fxDetail = makeFixture();
    await fxDetail.share.start();
    const detail = 'Track publish timeout';
    fxDetail.emitNative({ generation: 1, state: 'stopped', reason: 'publish_failed', detail });
    await vi.advanceTimersByTimeAsync(0);
    expect(fxDetail.onStateChange).toHaveBeenCalledWith('stopped', 'publish_failed', detail);

    const fxCancel = makeFixture();
    await fxCancel.share.start();
    fxCancel.emitNative({ generation: 1, state: 'stopped', reason: 'cancelled' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fxCancel.onStateChange).toHaveBeenCalledWith('stopped', 'cancelled');
    expect(fxCancel.removeListener).toHaveBeenCalledTimes(1);
    expect(fxCancel.sendStateEvent).not.toHaveBeenCalled();

    const fxStartErr = makeFixture();
    const msg = 'Failed to connect screen share room: HTTP 401';
    vi.mocked(fxStartErr.plugin.start).mockRejectedValueOnce(new Error(msg));
    await expect(fxStartErr.share.start()).rejects.toThrow(msg);
    expect(fxStartErr.onStateChange).toHaveBeenCalledWith('stopped', 'start_failed', msg);
  });

  it('always keeps the primary identity allowed and refreshes heartbeat on membership changes', async () => {
    const memberships = [bob()];
    const fx = makeFixture({ memberships });
    await fx.share.start();
    expect(fx.plugin.start).toHaveBeenCalledWith(
      expect.objectContaining({ allowedIdentities: [`${ALICE}:IPHONE`, `${BOB}:BOBDEV`] })
    );

    // onForeground before broadcasting does not send heartbeats.
    fx.share.onForeground();
    expect(fx.plugin.heartbeat).not.toHaveBeenCalled();

    fx.emitNative({ generation: 1, state: 'broadcasting' });
    await vi.advanceTimersByTimeAsync(0);

    // Primary membership temporarily absent from room memberships: still allowed, plus heartbeat.
    memberships.splice(0, 1);
    fx.share.onMembershipsChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(fx.plugin.updateAllowedParticipants).toHaveBeenLastCalledWith({
      generation: 1,
      identities: [`${ALICE}:IPHONE`],
    });
    expect(fx.plugin.heartbeat).toHaveBeenCalledTimes(1);

    // When primary membership returns, it is deduplicated.
    memberships.push(alice(), bob());
    fx.share.onMembershipsChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(fx.plugin.updateAllowedParticipants).toHaveBeenLastCalledWith({
      generation: 1,
      identities: [`${ALICE}:IPHONE`, `${BOB}:BOBDEV`],
    });
    expect(fx.plugin.heartbeat).toHaveBeenCalledTimes(2);

    await fx.share.stop();
  });

  it('stops native broadcast and emits publish_failed when initial companion publish rejects', async () => {
    const fx = makeFixture();
    fx.sendStateEvent.mockRejectedValueOnce(new Error('M_FORBIDDEN: cannot write call state'));
    await startBroadcasting(fx);

    expect(fx.share.isBroadcasting).toBe(false);
    expect(fx.plugin.stop).toHaveBeenCalledTimes(1);
    expect(fx.onStateChange).toHaveBeenCalledWith(
      'stopped',
      'publish_failed',
      'M_FORBIDDEN: cannot write call state'
    );
    expect(fx.removeListener).toHaveBeenCalledTimes(1);
  });

  it('renews every 60s with 120s expiry, preserves existing companion createdTs, and tolerates transient renewal failure', async () => {
    const t0 = Date.now();
    const serverCreatedTs = t0 - 2_000;
    const memberships = [alice(), bob()];
    const fx = makeFixture({ memberships });
    await startBroadcasting(fx);

    expect(fx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(fx.sendStateEvent.mock.calls[0]?.[2]).toMatchObject({ expires: 120_000 });
    expect(fx.sendStateEvent.mock.calls[0]?.[2]).not.toHaveProperty('created_ts');

    // Simulate server echoing companion membership with its own origin_server_ts.
    memberships.push(screenCompanion(ALICE, 'IPHONE', serverCreatedTs));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fx.sendStateEvent).toHaveBeenCalledTimes(2);
    expect(fx.sendStateEvent.mock.calls[1]?.[2]).toMatchObject({
      created_ts: serverCreatedTs,
      expires: 120_000 + 62_000,
      device_id: 'IPHONE-screen',
    });

    // Transient renewal error stays tolerant and lets the next 60s renewal succeed.
    fx.sendStateEvent.mockRejectedValueOnce(new Error('temporary 502'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fx.share.isBroadcasting).toBe(true);
    expect(fx.plugin.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fx.sendStateEvent).toHaveBeenCalledTimes(4);
    expect(fx.sendStateEvent.mock.calls[3]?.[2]).toMatchObject({
      created_ts: serverCreatedTs,
      expires: 120_000 + 182_000,
    });
    await fx.share.stop();
  });

  it('renews overdue companion membership on foreground wake even with server-ahead clock skew', async () => {
    const t0 = Date.now();
    const serverCreatedTs = t0 + 120_000;
    const memberships = [alice(), bob()];
    const fx = makeFixture({ memberships });
    await startBroadcasting(fx);
    memberships.push(screenCompanion(ALICE, 'IPHONE', serverCreatedTs));

    // Wall clock jumps 70s without timers firing (background throttling): foreground wake renews.
    vi.setSystemTime(t0 + 70_000);
    fx.share.onForeground();
    await vi.advanceTimersByTimeAsync(0);
    expect(fx.sendStateEvent).toHaveBeenCalledTimes(2);
    expect(fx.sendStateEvent.mock.calls[1]?.[2]).toMatchObject({
      created_ts: serverCreatedTs,
      expires: 120_000 + 70_000,
    });
    fx.share.onForeground();
    expect(fx.sendStateEvent).toHaveBeenCalledTimes(2);
    await fx.share.stop();
  });

  it('removes a late addListener handle when stop() runs mid-start', async () => {
    const fx = makeFixture();
    const listenerGate = deferred<{ remove: () => void | Promise<void> }>();
    vi.mocked(fx.plugin.addListener).mockReturnValueOnce(listenerGate.promise);
    const startPromise = fx.share.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fx.plugin.addListener).toHaveBeenCalledTimes(1);
    const stopPromise = fx.share.stop();
    listenerGate.resolve({ remove: fx.removeListener });
    await Promise.all([startPromise, stopPromise]);
    expect(fx.removeListener).toHaveBeenCalledTimes(1);
    expect(fx.plugin.start).not.toHaveBeenCalled();
  });

  it('ignores stale stopped/replaced events before plugin.start() resolves', async () => {
    const fx = makeFixture();
    const startGate = deferred<{ generation: number }>();
    vi.mocked(fx.plugin.start).mockReturnValueOnce(startGate.promise);
    const startPromise = fx.share.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fx.plugin.start).toHaveBeenCalledTimes(1);
    fx.emitNative({ generation: 1, state: 'stopped', reason: 'replaced' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fx.onStateChange).not.toHaveBeenCalled();
    expect(fx.removeListener).not.toHaveBeenCalled();
    startGate.resolve({ generation: 2 });
    await startPromise;
    fx.emitNative({ generation: 2, state: 'broadcasting' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fx.share.isBroadcasting).toBe(true);
    await fx.share.stop();
  });

  it('bounds stalled companion withdrawal to 5s while still awaiting plugin.stop()', async () => {
    const trackStop = (fx: ReturnType<typeof makeFixture>) => {
      let done = false;
      const promise = fx.share.stop().then(() => {
        done = true;
      });
      return { promise, isDone: () => done };
    };
    const fxFast = makeFixture();
    await startBroadcasting(fxFast);
    fxFast.sendStateEvent.mockReturnValueOnce(new Promise(() => undefined));
    const fast = trackStop(fxFast);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fast.isDone()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await fast.promise;
    expect(fast.isDone()).toBe(true);
    expect(fxFast.plugin.stop).toHaveBeenCalledTimes(1);

    const fxSlow = makeFixture();
    await startBroadcasting(fxSlow);
    fxSlow.sendStateEvent.mockReturnValueOnce(new Promise(() => undefined));
    const stopGate = deferred();
    vi.mocked(fxSlow.plugin.stop).mockReturnValueOnce(stopGate.promise);
    const slow = trackStop(fxSlow);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(slow.isDone()).toBe(false);
    stopGate.resolve();
    await slow.promise;
    expect(slow.isDone()).toBe(true);
    expect(fxSlow.plugin.stop).toHaveBeenCalledTimes(1);
  });

  it('clears sent-key markers on rotation so key-index wrap at 256 still delivers to long-lived peers', async () => {
    const memberships = [alice(), bob(), carol()];
    const fx = makeFixture({ memberships });
    await startBroadcasting(fx);
    for (let i = 1; i <= 256; i += 1) {
      vi.mocked(sendCallKey).mockClear();
      memberships[2] = carol(300 + i);
      fx.share.onMembershipsChanged();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(fx.plugin.setKey).toHaveBeenLastCalledWith(keyUpdate(0));
    expect(sendCallKey).toHaveBeenCalledWith(
      fx.mx,
      expect.objectContaining({
        keyIndex: 0,
        to: expect.objectContaining({ userId: BOB, deviceId: 'BOBDEV', createdTs: 200 }),
      })
    );

    await fx.share.stop();
  });
});