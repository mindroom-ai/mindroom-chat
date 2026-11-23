import { EventEmitter } from 'node:events';
import { ClientEvent, MatrixClient, Room, SyncState } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import contractFixture from './__fixtures__/providerUsageContract.json';
import {
  disposeProviderUsageController,
  getProviderUsageController,
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

const makeRoom = (roomId: string, memberIds: string[]): Room =>
  ({
    roomId,
    getMember: (userId: string) =>
      memberIds.includes(userId) ? { userId, membership: 'join' } : null,
    getJoinedMembers: () => memberIds.map((userId) => ({ userId, membership: 'join' })),
  } as unknown as Room);

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

    controller.ensureLoaded('!b:example.org');
    await flushMicrotasks();

    expect(trustMocks.sentRequests).toHaveLength(2);
    // Preferred room is probed first.
    expect(trustMocks.sentRequests[0]!.content.room_id).toBe('!b:example.org');
    expect(trustMocks.sentRequests[1]!.content.room_id).toBe('!a:example.org');

    const reqB = trustMocks.sentRequests[0]!.content.request_id as string;
    const reqA = trustMocks.sentRequests[1]!.content.request_id as string;

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
});
