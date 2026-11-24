import { EventEmitter } from 'node:events';
import { ClientEvent, MatrixClient, Room, SyncState } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signedModelDevices } from '../matrix/runtimeDeviceTrust';
import contractFixture from './__fixtures__/providerUsageContract.json';
import {
  disposeProviderUsageController,
  getProviderUsageController,
  snapshotForRuntime,
} from './providerUsageController';
import { USAGE_REQUEST, USAGE_RESPONSE, USAGE_TIMEOUT } from './providerUsageProtocol';

const trustMocks = vi.hoisted(() => ({
  signedDevices: new Map<
    string,
    Array<{ id: string; userId: string; deviceId: string; curveKey: string }>
  >(),
  sentRequests: [] as Array<{
    eventType: string;
    devices: Array<{ id: string; userId: string; deviceId: string; curveKey: string }>;
    content: Record<string, unknown>;
  }>,
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
      devices: Array<{ id: string; userId: string; deviceId: string; curveKey: string }>,
      content: Record<string, unknown>
    ) => {
      trustMocks.sentRequests.push({ eventType, devices, content });
    }
  ),
}));

const makeRoom = (
  roomId: string,
  memberIds: string[],
  options?: { lazyMembers?: string[] }
): Room & { loadMembersIfNeeded: ReturnType<typeof vi.fn> } => {
  let loaded = !options?.lazyMembers;
  let currentMembers = [...memberIds];
  const loadMembersIfNeeded = vi.fn(async () => {
    if (!loaded && options?.lazyMembers) {
      currentMembers = [...new Set([...currentMembers, ...options.lazyMembers])];
      loaded = true;
    }
    return true;
  });
  return {
    roomId,
    getMyMembership: () => 'join',
    membersLoaded: () => loaded,
    loadMembersIfNeeded,
    getMember: (userId: string) =>
      currentMembers.includes(userId) ? { userId, membership: 'join' } : null,
    getJoinedMembers: () => currentMembers.map((userId) => ({ userId, membership: 'join' })),
  } as unknown as Room & { loadMembersIfNeeded: ReturnType<typeof vi.fn> };
};

const makeClient = (rooms: Room[], syncState: SyncState | null = SyncState.Syncing) => {
  const emitter = new EventEmitter();
  const mx = Object.assign(emitter, {
    getUserId: () => '@viewer:example.org',
    getSyncState: () => syncState,
    getRooms: () => rooms,
    getRoom: (roomId: string) => rooms.find((room) => room.roomId === roomId) ?? null,
  }) as unknown as MatrixClient & EventEmitter;
  return mx;
};

const device = (userId: string, deviceId: string, curveKey: string) => ({
  id: JSON.stringify([userId, deviceId, curveKey]),
  userId,
  deviceId,
  curveKey,
});

const cloneSnapshot = (requestId: string, overrides?: Partial<typeof contractFixture>) => ({
  ...JSON.parse(JSON.stringify(contractFixture)),
  request_id: requestId,
  ...overrides,
});

const flushMicrotasks = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

describe('ProviderUsageController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    trustMocks.signedDevices.clear();
    trustMocks.sentRequests.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('discovers a non-router mindroom agent on cold /usage/ and authenticates responses', async () => {
    const dev = device('@mindroom_dev:example.org', 'DEV1', 'curve-dev-1');
    trustMocks.signedDevices.set(dev.userId, [dev]);
    const room = makeRoom('!cold:example.org', ['@viewer:example.org', dev.userId]);
    const mx = makeClient([room], null);
    const controller = getProviderUsageController(mx);
    const release = controller.retain();

    expect(controller.getSnapshot().available).toBe(false);
    controller.ensureLoaded();
    await flushMicrotasks();

    expect(trustMocks.sentRequests).toHaveLength(1);
    expect(trustMocks.sentRequests[0]!.eventType).toBe(USAGE_REQUEST);
    expect(trustMocks.sentRequests[0]!.content).toMatchObject({
      version: 1,
      room_id: '!cold:example.org',
      force_refresh: false,
    });
    const requestId = trustMocks.sentRequests[0]!.content.request_id as string;

    // Plaintext and mismatched sender keys are rejected.
    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: { type: USAGE_RESPONSE, sender: dev.userId, content: cloneSnapshot(requestId) },
    });
    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: { type: USAGE_RESPONSE, sender: dev.userId, content: cloneSnapshot(requestId) },
      encryptionInfo: { sender: dev.userId, senderCurve25519KeyBase64: 'wrong-curve' },
    });
    await flushMicrotasks();
    expect(controller.getSnapshot().available).toBe(false);

    // Verified encrypted response unlocks usage state and low-quota flag.
    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: { type: USAGE_RESPONSE, sender: dev.userId, content: cloneSnapshot(requestId) },
      encryptionInfo: { sender: dev.userId, senderCurve25519KeyBase64: dev.curveKey },
    });
    await flushMicrotasks();

    const state = controller.getSnapshot();
    expect(state.available).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.hasLowQuota).toBe(true);
    expect(state.selectedRuntimeId).toBe('@mindroom_dev:example.org:DEV1');
    expect(state.snapshot?.accounts).toHaveLength(4);

    release();
    disposeProviderUsageController(mx);
  });

  it('keeps multiple runtimes isolated by runtimeUserId:runtimeDeviceId without merging', async () => {
    const devA = device('@mindroom_alpha:example.org', 'DA', 'curve-a');
    const devB = device('@mindroom_beta:example.org', 'DB', 'curve-b');
    trustMocks.signedDevices.set(devA.userId, [devA]);
    trustMocks.signedDevices.set(devB.userId, [devB]);
    const roomA = makeRoom('!a:example.org', ['@viewer:example.org', devA.userId]);
    const roomB = makeRoom('!b:example.org', ['@viewer:example.org', devB.userId]);
    const mx = makeClient([roomA, roomB], null);
    const controller = getProviderUsageController(mx);
    const release = controller.retain();

    controller.ensureLoaded();
    await flushMicrotasks();

    expect(trustMocks.sentRequests).toHaveLength(2);
    expect(trustMocks.sentRequests[0]!.content.room_id).toBe('!a:example.org');
    expect(trustMocks.sentRequests[1]!.content.room_id).toBe('!b:example.org');

    const reqA = trustMocks.sentRequests[0]!.content.request_id as string;
    const reqB = trustMocks.sentRequests[1]!.content.request_id as string;

    const snapB = cloneSnapshot(reqB, {
      accounts: [cloneSnapshot(reqB).accounts[0]!],
    });
    const snapA = cloneSnapshot(reqA, {
      accounts: [cloneSnapshot(reqA).accounts[1]!],
    });

    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: { type: USAGE_RESPONSE, sender: devB.userId, content: snapB },
      encryptionInfo: { sender: devB.userId, senderCurve25519KeyBase64: devB.curveKey },
    });
    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: { type: USAGE_RESPONSE, sender: devA.userId, content: snapA },
      encryptionInfo: { sender: devA.userId, senderCurve25519KeyBase64: devA.curveKey },
    });
    await flushMicrotasks();

    expect(controller.getSnapshot().runtimes.map((r) => r.id)).toEqual([
      '@mindroom_beta:example.org:DB',
      '@mindroom_alpha:example.org:DA',
    ]);
    expect(controller.getSnapshot().snapshot?.accounts.map((a) => a.id)).toEqual([
      'claude_code:default',
    ]);

    controller.selectRuntime('@mindroom_alpha:example.org:DA');
    expect(controller.getSnapshot().snapshot?.accounts.map((a) => a.id)).toEqual(['codex:default']);

    release();
  });

  it('stays silently hidden when unanswered and sends force_refresh on explicit refresh', async () => {
    const dev = device('@mindroom_router:example.org', 'R1', 'curve-r1');
    trustMocks.signedDevices.set(dev.userId, [dev]);
    const room = makeRoom('!r:example.org', ['@viewer:example.org', dev.userId]);
    const mx = makeClient([room], SyncState.Syncing);
    const controller = getProviderUsageController(mx);
    const release = controller.retain();

    // Background discovery fires once when sync is ready.
    await flushMicrotasks();
    expect(trustMocks.sentRequests).toHaveLength(1);
    expect(controller.getSnapshot().available).toBe(false);

    vi.advanceTimersByTime(USAGE_TIMEOUT);
    expect(controller.getSnapshot().status).toBe('unavailable');
    expect(controller.getSnapshot().available).toBe(false);

    // Repeated ensureLoaded does not hammer the homeserver.
    controller.ensureLoaded('!r:example.org');
    await flushMicrotasks();
    expect(trustMocks.sentRequests).toHaveLength(1);

    // Explicit refresh(true) probes again with force_refresh: true.
    controller.refresh(true);
    await flushMicrotasks();
    expect(trustMocks.sentRequests).toHaveLength(2);
    expect(trustMocks.sentRequests[1]!.content.force_refresh).toBe(true);

    const requestId = trustMocks.sentRequests[1]!.content.request_id as string;
    const healthy = cloneSnapshot(requestId);
    for (const acc of healthy.accounts) {
      for (const w of acc.windows) {
        w.remaining_percent = 80;
        w.used_percent = 20;
      }
    }
    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: { type: USAGE_RESPONSE, sender: dev.userId, content: healthy },
      encryptionInfo: { sender: dev.userId, senderCurve25519KeyBase64: dev.curveKey },
    });
    await flushMicrotasks();
    expect(controller.getSnapshot().available).toBe(true);
    expect(controller.getSnapshot().hasLowQuota).toBe(false);

    // Refresh while already available sets refreshing without clearing snapshot.
    controller.refresh(true);
    expect(controller.getSnapshot().refreshing).toBe(true);
    expect(controller.getSnapshot().snapshot).toBeDefined();

    release();
  });

  it('hydrates lazy room members on explicit discovery while keeping startup probe cheap', async () => {
    const dev = device('@mindroom_lazy:example.org', 'LZ1', 'curve-lazy');
    trustMocks.signedDevices.set(dev.userId, [dev]);
    const lazyRoom = makeRoom('!lazy:example.org', ['@viewer:example.org'], {
      lazyMembers: [dev.userId],
    });
    const mx = makeClient([lazyRoom], SyncState.Syncing);
    const controller = getProviderUsageController(mx);
    const release = controller.retain();

    // Quiet startup probe does not trigger lazy member hydration across rooms.
    await flushMicrotasks();
    expect(lazyRoom.loadMembersIfNeeded).not.toHaveBeenCalled();
    expect(trustMocks.sentRequests).toHaveLength(0);

    // Explicit discovery (/usage/ mount or ensureLoaded) hydrates lazy members and probes.
    controller.ensureLoaded();
    await flushMicrotasks();
    expect(lazyRoom.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(trustMocks.sentRequests).toHaveLength(1);
    expect(trustMocks.sentRequests[0]!.content.room_id).toBe('!lazy:example.org');

    const requestId = trustMocks.sentRequests[0]!.content.request_id as string;
    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: { type: USAGE_RESPONSE, sender: dev.userId, content: cloneSnapshot(requestId) },
      encryptionInfo: { sender: dev.userId, senderCurve25519KeyBase64: dev.curveKey },
    });
    await flushMicrotasks();
    expect(controller.getSnapshot().available).toBe(true);

    release();
  });

  it('discovers a second runtime past room 16 and via ensureLoaded(roomId) without short-circuiting', async () => {
    const devA = device('@mindroom_alpha:example.org', 'DA', 'curve-a');
    const devB = device('@mindroom_beta:example.org', 'DB', 'curve-b');
    const devC = device('@mindroom_gamma:example.org', 'DC', 'curve-c');
    trustMocks.signedDevices.set(devA.userId, [devA]);
    trustMocks.signedDevices.set(devB.userId, [devB]);
    trustMocks.signedDevices.set(devC.userId, [devC]);

    // 17 rooms with Runtime A, then room 18 with Runtime B and lazy room 19 with Runtime C.
    const rooms = [
      ...Array.from({ length: 17 }, (_, i) =>
        makeRoom(`!r${i + 1}:example.org`, ['@viewer:example.org', devA.userId])
      ),
      makeRoom('!r18:example.org', ['@viewer:example.org', devB.userId]),
      makeRoom('!r19:example.org', ['@viewer:example.org'], { lazyMembers: [devC.userId] }),
    ];
    const mx = makeClient(rooms, null);
    const controller = getProviderUsageController(mx);
    const release = controller.retain();

    controller.ensureLoaded();
    await flushMicrotasks();
    expect(trustMocks.sentRequests.map((req) => req.content.room_id)).toEqual([
      '!r1:example.org',
      '!r18:example.org',
      '!r19:example.org',
    ]);

    const reqA = trustMocks.sentRequests[0]!.content.request_id as string;
    const reqB = trustMocks.sentRequests[1]!.content.request_id as string;
    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: {
        type: USAGE_RESPONSE,
        sender: devA.userId,
        content: cloneSnapshot(reqA, { accounts: [cloneSnapshot(reqA).accounts[0]!] }),
      },
      encryptionInfo: { sender: devA.userId, senderCurve25519KeyBase64: devA.curveKey },
    });
    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: {
        type: USAGE_RESPONSE,
        sender: devB.userId,
        content: cloneSnapshot(reqB, { accounts: [cloneSnapshot(reqB).accounts[1]!] }),
      },
      encryptionInfo: { sender: devB.userId, senderCurve25519KeyBase64: devB.curveKey },
    });
    await flushMicrotasks();

    const snap = controller.getSnapshot();
    expect(snapshotForRuntime(snap, devA)?.accounts.map((a) => a.id)).toEqual([
      'claude_code:default',
    ]);
    expect(snapshotForRuntime(snap, devB)?.accounts.map((a) => a.id)).toEqual(['codex:default']);
    expect(snapshotForRuntime(snap, devC)).toBeUndefined();
    expect(snapshotForRuntime(snap, undefined)).toBeUndefined();

    // Calling ensureLoaded(roomId) for an unseen room after another runtime is cached still discovers it.
    const devD = device('@mindroom_delta:example.org', 'DD', 'curve-d');
    trustMocks.signedDevices.set(devD.userId, [devD]);
    const roomNew = makeRoom('!new:example.org', ['@viewer:example.org'], {
      lazyMembers: [devD.userId],
    });
    rooms.push(roomNew);

    vi.advanceTimersByTime(USAGE_TIMEOUT);
    controller.ensureLoaded('!new:example.org');
    await flushMicrotasks();
    expect(roomNew.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(trustMocks.sentRequests.at(-1)?.content.room_id).toBe('!new:example.org');

    const reqD = trustMocks.sentRequests.at(-1)!.content.request_id as string;
    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: {
        type: USAGE_RESPONSE,
        sender: devD.userId,
        content: cloneSnapshot(reqD, { accounts: [cloneSnapshot(reqD).accounts[2]!] }),
      },
      encryptionInfo: { sender: devD.userId, senderCurve25519KeyBase64: devD.curveKey },
    });
    await flushMicrotasks();
    expect(snapshotForRuntime(controller.getSnapshot(), devD)?.accounts.map((a) => a.id)).toEqual([
      'openrouter:1',
    ]);

    release();
  });

  it('sends room-addressed requests to all room candidates for per-room responder election while deduplicating device lookups', async () => {
    const router = device('@mindroom_router:example.org', 'RT1', 'curve-router');
    const dev = device('@mindroom_dev:example.org', 'DV1', 'curve-dev');
    const writer = device('@mindroom_writer:example.org', 'WR1', 'curve-writer');
    trustMocks.signedDevices.set(router.userId, [router]);
    trustMocks.signedDevices.set(dev.userId, [dev]);
    trustMocks.signedDevices.set(writer.userId, [writer]);

    // Lobby has {router, dev} (router replies); Project has {dev, writer} (dev is elected responder).
    const lobby = makeRoom('!lobby:example.org', [
      '@viewer:example.org',
      router.userId,
      dev.userId,
    ]);
    const project = makeRoom('!project:example.org', [
      '@viewer:example.org',
      dev.userId,
      writer.userId,
    ]);
    const mx = makeClient([lobby, project], null);
    const controller = getProviderUsageController(mx);
    const release = controller.retain();

    controller.ensureLoaded();
    await flushMicrotasks();

    // Device-key lookup is deduplicated per unique user across rooms.
    expect(vi.mocked(signedModelDevices)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(signedModelDevices).mock.calls[0]![1]).toEqual([
      router.userId,
      dev.userId,
      writer.userId,
    ]);

    // Each room request is sent to every eligible device in that room, including `dev` in Project.
    expect(trustMocks.sentRequests).toHaveLength(2);
    expect(trustMocks.sentRequests[0]!.content.room_id).toBe('!lobby:example.org');
    expect(trustMocks.sentRequests[0]!.devices.map((d) => d.userId)).toEqual([
      router.userId,
      dev.userId,
    ]);
    expect(trustMocks.sentRequests[1]!.content.room_id).toBe('!project:example.org');
    expect(trustMocks.sentRequests[1]!.devices.map((d) => d.userId)).toEqual([
      dev.userId,
      writer.userId,
    ]);

    const lobbyReq = trustMocks.sentRequests[0]!.content.request_id as string;
    const projectReq = trustMocks.sentRequests[1]!.content.request_id as string;

    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: {
        type: USAGE_RESPONSE,
        sender: router.userId,
        content: cloneSnapshot(lobbyReq, { accounts: [cloneSnapshot(lobbyReq).accounts[0]!] }),
      },
      encryptionInfo: { sender: router.userId, senderCurve25519KeyBase64: router.curveKey },
    });
    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: {
        type: USAGE_RESPONSE,
        sender: dev.userId,
        content: cloneSnapshot(projectReq, { accounts: [cloneSnapshot(projectReq).accounts[1]!] }),
      },
      encryptionInfo: { sender: dev.userId, senderCurve25519KeyBase64: dev.curveKey },
    });
    await flushMicrotasks();

    const state = controller.getSnapshot();
    expect(state.runtimes.map((r) => r.id)).toEqual([
      '@mindroom_router:example.org:RT1',
      '@mindroom_dev:example.org:DV1',
    ]);
    expect(snapshotForRuntime(state, router)?.accounts.map((a) => a.id)).toEqual([
      'claude_code:default',
    ]);
    expect(snapshotForRuntime(state, dev)?.accounts.map((a) => a.id)).toEqual(['codex:default']);

    release();
  });

  it('completes lazy-member full discovery on first /usage/ ensureLoaded() after quiet startup cached runtime A', async () => {
    const devA = device('@mindroom_alpha:example.org', 'DA', 'curve-a');
    const devB = device('@mindroom_beta:example.org', 'DB', 'curve-b');
    trustMocks.signedDevices.set(devA.userId, [devA]);
    trustMocks.signedDevices.set(devB.userId, [devB]);

    const roomA = makeRoom('!roomA:example.org', ['@viewer:example.org', devA.userId]);
    const roomB = makeRoom('!roomB:example.org', ['@viewer:example.org'], {
      lazyMembers: [devB.userId],
    });
    const mx = makeClient([roomA, roomB], SyncState.Syncing);
    const controller = getProviderUsageController(mx);
    const release = controller.retain();

    // Quiet startup probe discovers Runtime A without hydrating lazy Room B.
    await flushMicrotasks();
    expect(roomB.loadMembersIfNeeded).not.toHaveBeenCalled();
    expect(trustMocks.sentRequests).toHaveLength(1);
    expect(trustMocks.sentRequests[0]!.content.room_id).toBe('!roomA:example.org');

    const reqA = trustMocks.sentRequests[0]!.content.request_id as string;
    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: {
        type: USAGE_RESPONSE,
        sender: devA.userId,
        content: cloneSnapshot(reqA, { accounts: [cloneSnapshot(reqA).accounts[0]!] }),
      },
      encryptionInfo: { sender: devA.userId, senderCurve25519KeyBase64: devA.curveKey },
    });
    await flushMicrotasks();
    expect(controller.getSnapshot().available).toBe(true);
    expect(controller.getSnapshot().runtimes.map((r) => r.id)).toEqual([
      '@mindroom_alpha:example.org:DA',
    ]);

    // First explicit /usage/ visit hydrates Room B and discovers Runtime B while keeping A visible.
    controller.ensureLoaded();
    expect(controller.getSnapshot().available).toBe(true);
    expect(snapshotForRuntime(controller.getSnapshot(), devA)?.accounts.map((a) => a.id)).toEqual([
      'claude_code:default',
    ]);
    await flushMicrotasks();

    expect(roomB.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(trustMocks.sentRequests).toHaveLength(2);
    expect(trustMocks.sentRequests[1]!.content.room_id).toBe('!roomB:example.org');

    const reqB = trustMocks.sentRequests[1]!.content.request_id as string;
    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: {
        type: USAGE_RESPONSE,
        sender: devB.userId,
        content: cloneSnapshot(reqB, { accounts: [cloneSnapshot(reqB).accounts[1]!] }),
      },
      encryptionInfo: { sender: devB.userId, senderCurve25519KeyBase64: devB.curveKey },
    });
    await flushMicrotasks();

    const state = controller.getSnapshot();
    expect(state.runtimes.map((r) => r.id)).toEqual([
      '@mindroom_alpha:example.org:DA',
      '@mindroom_beta:example.org:DB',
    ]);
    expect(snapshotForRuntime(state, devA)?.accounts.map((a) => a.id)).toEqual([
      'claude_code:default',
    ]);
    expect(snapshotForRuntime(state, devB)?.accounts.map((a) => a.id)).toEqual(['codex:default']);

    // Subsequent /usage/ visits do not re-probe once full discovery completed.
    controller.ensureLoaded();
    await flushMicrotasks();
    expect(trustMocks.sentRequests).toHaveLength(2);

    release();
  });

  it('probes only the requested room on ensureLoaded(roomId) without hydrating unrelated rooms', async () => {
    const devA = device('@mindroom_alpha:example.org', 'DA', 'curve-a');
    const devB = device('@mindroom_beta:example.org', 'DB', 'curve-b');
    trustMocks.signedDevices.set(devA.userId, [devA]);
    trustMocks.signedDevices.set(devB.userId, [devB]);

    const unrelatedLazy = makeRoom('!unrelated:example.org', ['@viewer:example.org'], {
      lazyMembers: [devA.userId],
    });
    const targetRoom = makeRoom('!target:example.org', ['@viewer:example.org'], {
      lazyMembers: [devB.userId],
    });
    const mx = makeClient([unrelatedLazy, targetRoom], null);
    const controller = getProviderUsageController(mx);
    const release = controller.retain();

    controller.ensureLoaded('!target:example.org');
    await flushMicrotasks();

    expect(targetRoom.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(unrelatedLazy.loadMembersIfNeeded).not.toHaveBeenCalled();
    expect(trustMocks.sentRequests).toHaveLength(1);
    expect(trustMocks.sentRequests[0]!.content.room_id).toBe('!target:example.org');

    release();
  });
});
