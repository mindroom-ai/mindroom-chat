import { EventEmitter } from 'node:events';
import { ClientEvent, MatrixClient, Room, RoomMemberEvent, SyncState } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signedModelDevices } from '../matrix/runtimeDeviceTrust';
import contractFixture from './__fixtures__/providerUsageContract.json';
import {
  disposeProviderUsageController,
  getProviderUsageController,
  snapshotForRuntime,
} from './providerUsageController';
import { USAGE_REQUEST, USAGE_RESPONSE, USAGE_TIMEOUT } from './providerUsageProtocol';

type TestDevice = { id: string; userId: string; deviceId: string; curveKey: string };
type SentRequest = {
  eventType: string;
  devices: TestDevice[];
  content: Record<string, unknown>;
  answered: (runtimeId: string) => boolean;
};

const trustMocks = vi.hoisted(() => ({
  signedDevices: new Map<string, TestDevice[]>(),
  sentRequests: [] as SentRequest[],
}));

vi.mock('../matrix/runtimeDeviceTrust', () => ({
  joinedModelCandidates: (_mx: MatrixClient, room: Room) =>
    room
      .getJoinedMembers()
      .map((member) => member.userId)
      .filter((id) => id.startsWith('@mindroom_')),
  signedModelDevices: vi.fn(async (_mx: MatrixClient, users: string[]) =>
    users.flatMap((user) => trustMocks.signedDevices.get(user) ?? [])
  ),
  isCurrentModelRuntime: vi.fn(async (_mx: MatrixClient, runtime: { userId: string; id: string }) =>
    (trustMocks.signedDevices.get(runtime.userId) ?? []).some((device) => device.id === runtime.id)
  ),
}));

vi.mock('../matrix/runtimeToDeviceTransport', () => ({
  sendEncryptedToDeviceRequest: vi.fn(
    async (
      _mx: MatrixClient,
      eventType: string,
      devices: TestDevice[],
      content: Record<string, unknown>,
      _signal: AbortSignal,
      answered: (runtimeId: string) => boolean
    ) => {
      trustMocks.sentRequests.push({ eventType, devices, content, answered });
    }
  ),
}));

const VIEWER = '@viewer:example.org';

const agent = (name: string, deviceId: string): TestDevice => {
  const userId = `@mindroom_${name}:example.org`;
  const curveKey = `curve-${name}`;
  const dev: TestDevice = {
    id: JSON.stringify([userId, deviceId, curveKey]),
    userId,
    deviceId,
    curveKey,
  };
  trustMocks.signedDevices.set(userId, [...(trustMocks.signedDevices.get(userId) ?? []), dev]);
  return dev;
};

const makeRoom = (roomId: string, members: string[] = [], lazyMembers?: string[]) => {
  let loaded = !lazyMembers;
  let current = [VIEWER, ...members];
  const loadMembersIfNeeded = vi.fn(async () => {
    if (!loaded && lazyMembers) {
      current = [...new Set([...current, ...lazyMembers])];
      loaded = true;
    }
    return true;
  });
  return {
    roomId,
    getMyMembership: () => 'join',
    membersLoaded: () => loaded,
    loadMembersIfNeeded,
    getMember: (id: string) => (current.includes(id) ? { userId: id, membership: 'join' } : null),
    getJoinedMembers: () => current.map((userId) => ({ userId, membership: 'join' })),
  } as unknown as Room & { loadMembersIfNeeded: ReturnType<typeof vi.fn> };
};

const flushMicrotasks = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};
const sentRoomIds = () => trustMocks.sentRequests.map((req) => req.content.room_id);

describe('ProviderUsageController', () => {
  const cleanups: Array<() => void> = [];

  const mountController = (rooms: Room[], syncState: SyncState | null = null) => {
    const mx = Object.assign(new EventEmitter(), {
      getUserId: () => VIEWER,
      getSyncState: () => syncState,
      getRooms: () => rooms,
      getRoom: (roomId: string) => rooms.find((room) => room.roomId === roomId) ?? null,
    }) as unknown as MatrixClient & EventEmitter;
    const controller = getProviderUsageController(mx);
    const release = controller.retain();
    cleanups.push(release);
    const snap = () => controller.getSnapshot();
    const runtimeIds = () => snap().runtimes.map((r) => r.id);
    const accountsFor = (dev?: TestDevice) =>
      snapshotForRuntime(snap(), dev)?.accounts.map((a) => a.id);
    const load = async (roomId?: string) => {
      controller.ensureLoaded(roomId);
      await flushMicrotasks();
    };
    const reply = async (
      dev: TestDevice,
      req: number | string = -1,
      opts?: { accountIndex?: number; healthy?: boolean; curveKey?: string | null }
    ) => {
      const requestId =
        typeof req === 'number'
          ? (trustMocks.sentRequests.at(req)!.content.request_id as string)
          : req;
      const content = { ...JSON.parse(JSON.stringify(contractFixture)), request_id: requestId };
      if (opts?.accountIndex !== undefined)
        content.accounts = [content.accounts[opts.accountIndex]!];
      if (opts?.healthy) {
        for (const acc of content.accounts) {
          for (const w of acc.windows)
            Object.assign(w, { remaining_percent: 80, used_percent: 20 });
        }
      }
      mx.emit(ClientEvent.ReceivedToDeviceMessage, {
        message: { type: USAGE_RESPONSE, sender: dev.userId, content },
        ...(opts?.curveKey === null
          ? {}
          : {
              encryptionInfo: {
                sender: dev.userId,
                senderCurve25519KeyBase64: opts?.curveKey ?? dev.curveKey,
              },
            }),
      });
      await flushMicrotasks();
    };
    return { mx, controller, release, snap, runtimeIds, accountsFor, load, reply };
  };

  const mountTwoRuntimes = (
    opts: { lazyA?: boolean; lazyB?: boolean; syncState?: SyncState | null } = {}
  ) => {
    const [devA, devB] = [agent('alpha', 'DA'), agent('beta', 'DB')];
    const mk = (id: string, dev: TestDevice, lazy?: boolean) =>
      makeRoom(id, lazy ? [] : [dev.userId], lazy ? [dev.userId] : undefined);
    const [roomA, roomB] = [
      mk('!roomA:example.org', devA, opts.lazyA),
      mk('!roomB:example.org', devB, opts.lazyB),
    ];
    return { devA, devB, roomA, roomB, ...mountController([roomA, roomB], opts.syncState) };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    trustMocks.signedDevices.clear();
    trustMocks.sentRequests.length = 0;
  });

  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('discovers a non-router mindroom agent on cold /usage/ and authenticates responses', async () => {
    const dev = agent('dev', 'DEV1');
    const { mx, release, snap, load, reply } = mountController([
      makeRoom('!cold:example.org', [dev.userId]),
    ]);

    expect(snap().available).toBe(false);
    await load();

    expect(trustMocks.sentRequests).toHaveLength(1);
    expect(trustMocks.sentRequests[0]!.eventType).toBe(USAGE_REQUEST);
    expect(trustMocks.sentRequests[0]!.content).toMatchObject({
      version: 1,
      room_id: '!cold:example.org',
      force_refresh: false,
    });

    // Plaintext and mismatched sender keys are rejected.
    await reply(dev, 0, { curveKey: null });
    await reply(dev, 0, { curveKey: 'wrong-curve' });
    expect(snap().available).toBe(false);

    // Verified encrypted response unlocks usage state and low-quota flag.
    await reply(dev, 0);
    expect(snap()).toMatchObject({
      available: true,
      loading: false,
      hasLowQuota: true,
      selectedRuntimeId: '@mindroom_dev:example.org:DEV1',
    });
    expect(snap().snapshot?.accounts).toHaveLength(4);

    release();
    disposeProviderUsageController(mx);
  });

  it('keeps multiple runtimes isolated by runtimeUserId:runtimeDeviceId without merging', async () => {
    const { devA, devB, controller, snap, runtimeIds, load, reply } = mountTwoRuntimes();

    await load();
    expect(sentRoomIds()).toEqual(['!roomA:example.org', '!roomB:example.org']);

    await reply(devB, 1, { accountIndex: 0 });
    await reply(devA, 0, { accountIndex: 1 });

    expect(runtimeIds()).toEqual([
      '@mindroom_beta:example.org:DB',
      '@mindroom_alpha:example.org:DA',
    ]);
    expect(snap().snapshot?.accounts.map((a) => a.id)).toEqual(['claude_code:default']);

    controller.selectRuntime('@mindroom_alpha:example.org:DA');
    expect(snap().snapshot?.accounts.map((a) => a.id)).toEqual(['codex:default']);
  });

  it('stays silently hidden when unanswered and sends force_refresh on explicit refresh', async () => {
    const dev = agent('router', 'R1');
    const { controller, snap, load, reply } = mountController(
      [makeRoom('!r:example.org', [dev.userId])],
      SyncState.Syncing
    );

    // Background discovery fires once when sync is ready.
    await flushMicrotasks();
    expect(trustMocks.sentRequests).toHaveLength(1);
    expect(snap().available).toBe(false);

    vi.advanceTimersByTime(USAGE_TIMEOUT);
    expect(snap()).toMatchObject({ status: 'unavailable', available: false });

    // Repeated ensureLoaded does not hammer the homeserver.
    await load('!r:example.org');
    expect(trustMocks.sentRequests).toHaveLength(1);

    // Explicit refresh(true) probes again with force_refresh: true.
    controller.refresh(true);
    await flushMicrotasks();
    expect(trustMocks.sentRequests).toHaveLength(2);
    expect(trustMocks.sentRequests[1]!.content.force_refresh).toBe(true);

    await reply(dev, 1, { healthy: true });
    expect(snap()).toMatchObject({ available: true, hasLowQuota: false });

    // Refresh while already available sets refreshing without clearing snapshot.
    controller.refresh(true);
    expect(snap().refreshing).toBe(true);
    expect(snap().snapshot).toBeDefined();
  });

  it('hydrates lazy room members on explicit discovery while keeping startup probe cheap', async () => {
    const dev = agent('lazy', 'LZ1');
    const lazyRoom = makeRoom('!lazy:example.org', [], [dev.userId]);
    const { snap, load, reply } = mountController([lazyRoom], SyncState.Syncing);

    // Quiet startup probe does not trigger lazy member hydration across rooms.
    await flushMicrotasks();
    expect(lazyRoom.loadMembersIfNeeded).not.toHaveBeenCalled();
    expect(trustMocks.sentRequests).toHaveLength(0);

    // Explicit discovery (/usage/ mount or ensureLoaded) hydrates lazy members and probes.
    await load();
    expect(lazyRoom.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(sentRoomIds()).toEqual(['!lazy:example.org']);

    await reply(dev, 0);
    expect(snap().available).toBe(true);
  });

  it('discovers a second runtime past room 16 and via ensureLoaded(roomId) without short-circuiting', async () => {
    const [devA, devB, devC] = [agent('alpha', 'DA'), agent('beta', 'DB'), agent('gamma', 'DC')];

    // 17 rooms with Runtime A, then room 18 with Runtime B and lazy room 19 with Runtime C.
    const rooms = [
      ...Array.from({ length: 17 }, (_, i) => makeRoom(`!r${i + 1}:example.org`, [devA.userId])),
      makeRoom('!r18:example.org', [devB.userId]),
      makeRoom('!r19:example.org', [], [devC.userId]),
    ];
    const { accountsFor, load, reply } = mountController(rooms);

    await load();
    expect(sentRoomIds()).toEqual(['!r1:example.org', '!r18:example.org', '!r19:example.org']);

    await reply(devA, 0, { accountIndex: 0 });
    await reply(devB, 1, { accountIndex: 1 });
    expect(accountsFor(devA)).toEqual(['claude_code:default']);
    expect(accountsFor(devB)).toEqual(['codex:default']);
    expect(accountsFor(devC)).toBeUndefined();
    expect(accountsFor(undefined)).toBeUndefined();

    // Calling ensureLoaded(roomId) for an unseen room after another runtime is cached still discovers it.
    const devD = agent('delta', 'DD');
    const roomNew = makeRoom('!new:example.org', [], [devD.userId]);
    rooms.push(roomNew);

    vi.advanceTimersByTime(USAGE_TIMEOUT);
    await load('!new:example.org');
    expect(roomNew.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(sentRoomIds().at(-1)).toBe('!new:example.org');

    await reply(devD, -1, { accountIndex: 2 });
    expect(accountsFor(devD)).toEqual(['openrouter:1']);
  });

  it('sends room-addressed requests to all room candidates for per-room responder election while deduplicating device lookups', async () => {
    const [router, dev, writer] = [
      agent('router', 'RT1'),
      agent('dev', 'DV1'),
      agent('writer', 'WR1'),
    ];

    // Lobby has {router, dev} (router replies); Project has {dev, writer} (dev is elected responder).
    const { runtimeIds, accountsFor, load, reply } = mountController([
      makeRoom('!lobby:example.org', [router.userId, dev.userId]),
      makeRoom('!project:example.org', [dev.userId, writer.userId]),
    ]);

    await load();

    // Device-key lookup is deduplicated per unique user across rooms.
    expect(vi.mocked(signedModelDevices)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(signedModelDevices).mock.calls[0]![1]).toEqual([
      router.userId,
      dev.userId,
      writer.userId,
    ]);

    // Each room request is sent to every eligible device in that room, including `dev` in Project.
    expect(sentRoomIds()).toEqual(['!lobby:example.org', '!project:example.org']);
    expect(trustMocks.sentRequests[0]!.devices.map((d) => d.userId)).toEqual([
      router.userId,
      dev.userId,
    ]);
    expect(trustMocks.sentRequests[1]!.devices.map((d) => d.userId)).toEqual([
      dev.userId,
      writer.userId,
    ]);

    await reply(router, 0, { accountIndex: 0 });
    await reply(dev, 1, { accountIndex: 1 });
    expect(runtimeIds()).toEqual([
      '@mindroom_router:example.org:RT1',
      '@mindroom_dev:example.org:DV1',
    ]);
    expect(accountsFor(router)).toEqual(['claude_code:default']);
    expect(accountsFor(dev)).toEqual(['codex:default']);
  });

  it('marks overlapping pending queries answered when a shared candidate device replies', async () => {
    const [router, dev, writer, gamma] = [
      agent('router', 'RT1'),
      agent('dev', 'DV1'),
      agent('writer', 'WR1'),
      agent('gamma', 'GM1'),
    ];
    const { accountsFor, load, reply } = mountController([
      makeRoom('!lobby:example.org', [router.userId, dev.userId]),
      makeRoom('!ops:example.org', [router.userId, writer.userId]),
      makeRoom('!other:example.org', [gamma.userId]),
    ]);

    await load();
    const [lobbyReq, opsReq, otherReq] = trustMocks.sentRequests;
    expect(lobbyReq!.answered(router.id)).toBe(false);
    expect(opsReq!.answered(router.id)).toBe(false);
    expect(otherReq!.answered(gamma.id)).toBe(false);

    // When router answers Lobby, Ops (sharing router) stops retrying while disjoint Other still retries.
    await reply(router, 0, { accountIndex: 0 });
    expect(lobbyReq!.answered(router.id)).toBe(true);
    expect(opsReq!.answered(writer.id)).toBe(true);
    expect(otherReq!.answered(gamma.id)).toBe(false);

    // In-flight responses for still-open queries remain accepted until timeout.
    await reply(writer, 1, { accountIndex: 1 });
    expect(accountsFor(writer)).toEqual(['codex:default']);
  });

  it('completes lazy-member full discovery on first /usage/ ensureLoaded() after quiet startup cached runtime A', async () => {
    const { devA, devB, roomB, controller, snap, runtimeIds, accountsFor, load, reply } =
      mountTwoRuntimes({ lazyB: true, syncState: SyncState.Syncing });

    // Quiet startup probe discovers Runtime A without hydrating lazy Room B.
    await flushMicrotasks();
    expect(roomB.loadMembersIfNeeded).not.toHaveBeenCalled();
    expect(sentRoomIds()).toEqual(['!roomA:example.org']);

    await reply(devA, 0, { accountIndex: 0 });
    expect(snap().available).toBe(true);
    expect(runtimeIds()).toEqual(['@mindroom_alpha:example.org:DA']);

    // First explicit /usage/ visit hydrates Room B and discovers Runtime B while keeping A visible.
    controller.ensureLoaded();
    expect(snap().available).toBe(true);
    expect(accountsFor(devA)).toEqual(['claude_code:default']);
    await flushMicrotasks();

    expect(roomB.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(sentRoomIds()).toEqual(['!roomA:example.org', '!roomB:example.org']);

    await reply(devB, 1, { accountIndex: 1 });
    expect(runtimeIds()).toEqual([
      '@mindroom_alpha:example.org:DA',
      '@mindroom_beta:example.org:DB',
    ]);
    expect(accountsFor(devA)).toEqual(['claude_code:default']);
    expect(accountsFor(devB)).toEqual(['codex:default']);

    // Subsequent /usage/ visits do not re-probe once full discovery completed.
    await load();
    expect(trustMocks.sentRequests).toHaveLength(2);
  });

  it('probes only the requested room on ensureLoaded(roomId) without hydrating unrelated rooms', async () => {
    const { roomA, roomB, load } = mountTwoRuntimes({ lazyA: true, lazyB: true });

    await load(roomB.roomId);
    expect(roomB.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(roomA.loadMembersIfNeeded).not.toHaveBeenCalled();
    expect(sentRoomIds()).toEqual([roomB.roomId]);
  });

  it('does not scan joined room members on RoomMemberEvent.Membership for ordinary users', async () => {
    const room = makeRoom('!large:example.org', ['@alice:example.org']);
    const getJoinedMembersSpy = vi.spyOn(room, 'getJoinedMembers');
    const { mx } = mountController([room]);

    for (const userId of ['@alice:example.org', '@mindroom_bot:foreign.org', VIEWER]) {
      mx.emit(RoomMemberEvent.Membership, {}, { roomId: room.roomId, userId, membership: 'join' });
    }
    await flushMicrotasks();

    expect(getJoinedMembersSpy).not.toHaveBeenCalled();
    expect(trustMocks.sentRequests).toHaveLength(0);
  });

  it('accepts a valid response arriving at 13s within the client timeout', async () => {
    const dev = agent('dev', 'DEV1');
    const { snap, load, reply } = mountController([makeRoom('!slow:example.org', [dev.userId])]);

    await load();
    expect(trustMocks.sentRequests).toHaveLength(1);
    const requestId = trustMocks.sentRequests[0]!.content.request_id as string;

    vi.advanceTimersByTime(13_000);
    expect(snap()).toMatchObject({ loading: true, available: false });

    await reply(dev, requestId);
    expect(snap()).toMatchObject({ status: 'ready', available: true, loading: false });
    expect(snap().snapshot?.request_id).toBe(requestId);
    expect(snap().snapshot?.accounts).toHaveLength(4);
  });

  it('still runs startup auto-probe after cold ensureLoaded() saw no rooms before initial sync', async () => {
    const dev = agent('dev', 'DEV1');
    const rooms: Room[] = [];
    const { mx, load } = mountController(rooms);

    await load();
    expect(trustMocks.sentRequests).toHaveLength(0);

    rooms.push(makeRoom('!synced:example.org', [dev.userId]));
    mx.emit(ClientEvent.Sync, SyncState.Prepared);
    await flushMicrotasks();

    expect(sentRoomIds()).toEqual(['!synced:example.org']);
  });
});
