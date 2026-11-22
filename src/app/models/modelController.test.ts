import {
  createClient,
  Device,
  MatrixEvent,
  MatrixEventEvent,
  MatrixScheduler,
  Room,
  ClientEvent,
  RoomMemberEvent,
  RoomStateEvent,
  RoomEvent,
  SyncState,
  type IStateEventWithRoomId,
} from 'matrix-js-sdk';
import type { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { CryptoEvent, type CryptoApi } from 'matrix-js-sdk/lib/crypto-api';
import { logger } from 'matrix-js-sdk/lib/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getModelController, disposeModelController } from './modelController';
import { THREAD_MODEL_KEY } from '../matrix/protocol/threadModel';

const viewer = '@viewer:test';
const router = '@mindroom_router:test';
const helper = '@mindroom_helper:test';
beforeEach(() => {
  // Expected SDK offline/retry logs are not application failures.
  vi.spyOn(logger, 'debug').mockImplementation(() => {});
  vi.spyOn(logger, 'log').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
const cleanups: (() => void)[] = [];
const flush = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};
const setup = (lazyLoadMembers = false, userId = viewer, roomId = '!room:test') => {
  vi.useFakeTimers();
  const mx = createClient({
    baseUrl: 'https://test',
    userId,
    deviceId: 'LOCAL',
    scheduler: new MatrixScheduler(() => -1),
  });
  const room = new Room(roomId, mx, userId, { lazyLoadMembers });
  const member = (userId: string, membership = 'join') => {
    room.currentState.setStateEvents([
      new MatrixEvent({
        type: 'm.room.member',
        room_id: room.roomId,
        sender: userId,
        state_key: userId,
        content: { membership },
      }),
    ]);
  };
  [userId, ...(lazyLoadMembers ? [] : [router, helper])].forEach((id) => member(id));
  vi.spyOn(mx, 'getRoom').mockImplementation((id) => (id === room.roomId ? room : null));
  const device = (userId = router, deviceId = 'DEVICE', key = 'curve') =>
    new Device({
      userId,
      deviceId,
      algorithms: ['m.olm.v1.curve25519-aes-sha2'],
      keys: new Map([['curve25519:' + deviceId, key]]),
    });
  const devices = new Map([[router, new Map([['DEVICE', device()]])]]);
  const crypto = {
    getUserDeviceInfo: vi.fn(async () => devices),
    getDeviceVerificationStatus: vi.fn(async () => ({ signedByOwner: true })),
    encryptToDeviceMessages: vi.fn(async (_type, recipients, content) => ({
      eventType: 'm.room.encrypted',
      batch: recipients.map((r: object) => ({ ...r, payload: { encrypted: content } })),
    })),
  };
  vi.spyOn(mx, 'getCrypto').mockReturnValue(crypto as unknown as CryptoApi);
  const queued: any[] = [];
  const queue = vi.spyOn(mx, 'queueToDevice').mockImplementation(async (batch) => {
    queued.push(batch);
  });
  const send = vi.spyOn(mx, 'sendMessage').mockResolvedValue({ event_id: '$command' });
  const controller = getModelController(mx);
  cleanups.push(() => disposeModelController(mx));
  const snapshot = (thread = '$root') => controller.getSnapshot(room, thread);
  const response = (request: any, changes: any = {}, identity: any = {}, sender = router) => {
    mx.emit(ClientEvent.ReceivedToDeviceMessage, {
      message: {
        type: 'io.mindroom.models.response',
        sender,
        content: {
          version: 1,
          request_id: request.request_id,
          room_id: request.room_id,
          ...(request.thread_id ? { thread_id: request.thread_id } : {}),
          capabilities: ['model_selection'],
          agent_user_ids: [helper],
          catalog_revision: 'revision',
          models: [
            { key: 'fast', display_name: 'Quick', provider: 'openai', id: 'model' },
            { key: 'reset', display_name: 'Reset model', provider: 'openai', id: 'model2' },
          ],
          selection: { override: null, inherited: [{ entity: 'helper', model: 'fast' }] },
          ...changes,
        },
      },
      encryptionInfo:
        identity === null
          ? null
          : {
              sender,
              senderDevice: 'FORGED',
              senderVerified: false,
              senderCurve25519KeyBase64: 'curve',
              ...identity,
            },
    });
  };
  const request = () => queued[queued.length - 1].batch[0].payload.encrypted;
  const discover = async (changes?: object) => {
    const unsubscribe = controller.subscribe(room, '$root', () => {});
    await flush();
    response(request(), changes);
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    return unsubscribe;
  };
  const ack = (changes: any = {}, eventChanges: any = {}) => {
    const event = new MatrixEvent({
      event_id: '$ack',
      type: 'm.room.message',
      sender: router,
      room_id: room.roomId,
      content: {
        msgtype: 'm.notice',
        body: 'Model selected',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
        'io.mindroom.model_selection_result': {
          version: 1,
          command_event_id: '$command',
          room_id: room.roomId,
          thread_id: '$root',
          runtime_user_id: router,
          runtime_device_id: 'DEVICE',
          operation: 'set',
          model: 'fast',
          status: 'applied',
          override: 'fast',
          ...changes,
        },
      },
      ...eventChanges,
    });
    mx.emit(ClientEvent.Event, event);
    return event;
  };
  const message = (
    sender: string,
    body: string,
    id: string,
    reply?: { eventId: string; isFallback: boolean }
  ) =>
    mx.emit(
      ClientEvent.Event,
      new MatrixEvent({
        event_id: id,
        type: 'm.room.message',
        sender,
        room_id: room.roomId,
        content: {
          msgtype: 'm.text',
          body,
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: '$root',
            ...(reply && {
              'm.in_reply_to': { event_id: reply.eventId },
              is_falling_back: reply.isFallback,
            }),
          },
        },
      })
    );
  return {
    mx,
    room,
    member,
    device,
    devices,
    crypto,
    queue,
    queued,
    send,
    controller,
    snapshot,
    response,
    request,
    discover,
    ack,
    message,
  };
};
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('persisted room catalogs', () => {
  const key = `mindroom_client_model_catalogs::${viewer}`;
  const values = new Map<string, string>();
  const cachedCatalog = {
    runtime: {
      id: JSON.stringify([router, 'DEVICE', 'curve']),
      userId: router,
      deviceId: 'DEVICE',
      curveKey: 'curve',
    },
    agentUserIds: [helper],
    models: [{ key: 'fast', display_name: 'Quick', provider: 'openai', id: 'model' }],
    inherited: [{ entity: 'helper', model: 'fast' }],
  };
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => values.set(name, value),
      removeItem: (name: string) => values.delete(name),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    values.clear();
  });

  it('seeds a thread before discovery on a new controller for the same account', async () => {
    const first = setup();
    first.controller.subscribe(first.room, '$root', () => {});
    await flush();
    first.response(first.request(), {
      selection: { override: 'reset', inherited: cachedCatalog.inherited },
    });
    await flush();
    expect(first.snapshot().loading).toBe(true);
    expect(values.has(key)).toBe(false); // The room cache still updates when discovery finishes.
    await vi.advanceTimersByTimeAsync(12000);
    expect(first.snapshot().override).toBe('reset');
    const { models } = first.snapshot();
    first.controller.dispose();

    const reloaded = setup();
    expect(reloaded.snapshot('$new')).toMatchObject({
      eligible: true,
      models,
      override: null,
      inherited: cachedCatalog.inherited,
      canMutate: false,
    });
    expect(reloaded.snapshot('$new').runtime).toBeUndefined();
    expect(reloaded.queue).not.toHaveBeenCalled();
  });

  it.each(['cold scope', 'watched scope'])(
    'preserves a disk seed through lazy hydration (%s)',
    async (kind) => {
      await setup().discover();
      const h = setup(true);
      // Relay the SDK's synchronous per-member events, even though membersLoaded() is already true.
      h.room.currentState.on(RoomStateEvent.NewMember, (_event, _state, member) => {
        member.on(RoomMemberEvent.Membership, (event, changed) => {
          h.mx.emit(RoomMemberEvent.Membership, event, changed);
        });
      });
      vi.spyOn(h.mx, 'members').mockResolvedValue({
        chunk: [router, helper].map((id) => ({
          type: 'm.room.member',
          room_id: h.room.roomId,
          sender: id,
          state_key: id,
          content: { membership: 'join' },
        })) as IStateEventWithRoomId[],
      });
      if (kind === 'watched scope') {
        cleanups.push(
          h.controller.retain(),
          h.controller.watch(h.room, '$root', () => {})
        );
        const unrelated = '@someone:test';
        h.member(unrelated);
        h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember(unrelated)!);
      }
      expect(h.snapshot().eligible).toBe(false);
      h.controller.subscribe(h.room, '$root', () => {});
      await flush();
      expect(h.room.membersLoaded()).toBe(true);
      expect(h.snapshot()).toMatchObject({ eligible: true, loading: true, canMutate: false });
      expect(h.snapshot().models).not.toHaveLength(0);
      expect(setup().snapshot().eligible).toBe(true);

      h.member(helper, 'leave');
      expect(h.snapshot().eligible).toBe(false);
      expect(setup().snapshot().eligible).toBe(false);
    }
  );

  it('shows the saved catalog when returning after a cancelled hydration probe', async () => {
    const first = setup();
    await first.discover();
    const h = setup(true);
    let finishLoading!: () => void;
    const loading = new Promise<void>((resolve) => {
      finishLoading = resolve;
    });
    vi.spyOn(h.mx, 'members').mockImplementation(async () => {
      await loading;
      return {
        chunk: [router, helper].map((id) => ({
          type: 'm.room.member',
          room_id: h.room.roomId,
          sender: id,
          state_key: id,
          content: { membership: 'join' },
        })) as IStateEventWithRoomId[],
      };
    });

    const leave = h.controller.subscribe(h.room, '$root', () => {});
    expect(h.snapshot().eligible).toBe(false);
    leave();
    finishLoading();
    await flush();
    expect(h.room.membersLoaded()).toBe(true);
    expect(h.queue).not.toHaveBeenCalled();

    h.controller.subscribe(h.room, '$root', () => {});
    expect(h.snapshot()).toMatchObject({
      eligible: true,
      models: first.snapshot().models,
      loading: true,
      canMutate: false,
    });
    expect(h.snapshot().runtime).toBeUndefined();
  });

  it('removes a visible seed when its agent leaves during hydration', async () => {
    await setup().discover();
    const h = setup(true);
    h.member(router);
    h.member(helper);
    let hydrated!: (loaded: boolean) => void;
    vi.spyOn(h.room, 'loadMembersIfNeeded').mockReturnValue(
      new Promise((resolve) => {
        hydrated = resolve;
      })
    );
    expect(h.snapshot().eligible).toBe(true);
    h.controller.subscribe(h.room, '$root', () => {});
    h.member(helper, 'leave');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember(helper)!);
    hydrated(true);
    await flush();
    expect(h.snapshot()).toMatchObject({
      eligible: false,
      models: [],
      inherited: [],
      loading: true,
    });
  });

  it('does not name a cached agent that left before this client started', async () => {
    const h = setup();
    const other = '@mindroom_other:test';
    h.member(other);
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    h.response(h.request(), {
      agent_user_ids: [helper, other],
      selection: {
        override: null,
        inherited: [{ entity: 'other', model: 'fast', user_id: other }],
      },
    });
    await flush();
    await vi.advanceTimersByTimeAsync(12000);

    const reloaded = setup(); // Only the viewer, router and helper remain joined.
    expect(reloaded.snapshot()).toMatchObject({ eligible: true, inherited: [] });
  });

  it('requires a verified answer for the scope before a seeded model can be selected', async () => {
    const first = setup();
    await first.discover();
    const reloaded = setup();
    reloaded.controller.subscribe(reloaded.room, '$new', () => {});
    expect(reloaded.snapshot('$new')).toMatchObject({
      eligible: true,
      loading: true,
      canMutate: false,
    });
    await flush();
    reloaded.response(reloaded.request(), {}, null);
    await flush();
    reloaded.controller.selectModel(reloaded.room, '$new', 'fast');
    reloaded.controller.resetToRoomDefault(reloaded.room, '$new');
    await flush();
    expect(reloaded.send).not.toHaveBeenCalled();

    reloaded.response(reloaded.request(), { models: [cachedCatalog.models[0]] });
    await flush();
    expect(reloaded.snapshot('$new')).toMatchObject({
      canMutate: true,
      models: cachedCatalog.models,
    });
    reloaded.controller.selectModel(reloaded.room, '$new', 'fast');
    await flush();
    expect(reloaded.send).toHaveBeenCalledOnce();
  });

  it('does not seed another account even when it shares the room and agents', async () => {
    const first = setup();
    await first.discover();
    expect(setup().snapshot().eligible).toBe(true);
    first.controller.dispose(); // Switching accounts stops this client without signing it out.
    const other = setup(false, '@other:test');
    expect(other.snapshot().eligible).toBe(false);
    expect(setup().snapshot().eligible).toBe(true);
  });

  it('does not seed where the reported agent is no longer joined', async () => {
    await setup().discover();
    const reloaded = setup();
    expect(reloaded.snapshot().eligible).toBe(true);
    reloaded.member(helper, 'leave');
    expect(reloaded.snapshot('$new').eligible).toBe(false);
  });

  it.each(['{', JSON.stringify({ version: 2, rooms: { '!room:test': [cachedCatalog] } })])(
    'ignores unreadable storage %s',
    (raw) => {
      values.set(key, raw);
      expect(setup().snapshot().eligible).toBe(false);
    }
  );

  it('ignores an otherwise valid blob that exceeds the byte cap', () => {
    const raw = JSON.stringify({ version: 1, rooms: { '!room:test': [cachedCatalog] } });
    values.set(key, raw.padEnd(256 * 1024 + 1));
    expect(setup().snapshot().eligible).toBe(false);
  });

  it('validates each stored room catalog before using it', () => {
    const longUserId = `@mindroom_${'a'.repeat(1024)}:test`;
    const invalidCatalogs = [
      {
        ...cachedCatalog,
        models: [{ ...cachedCatalog.models[0], icon_url: 'https://other.test/icon' }],
      },
      { ...cachedCatalog, inherited: [{ entity: 'helper', model: 42 }] },
      { ...cachedCatalog, runtime: { ...cachedCatalog.runtime, deviceId: '' } },
      { ...cachedCatalog, runtime: { ...cachedCatalog.runtime, userId: longUserId } },
      { ...cachedCatalog, runtime: { ...cachedCatalog.runtime, curveKey: 'a'.repeat(1025) } },
    ];
    values.set(
      key,
      JSON.stringify({
        version: 1,
        rooms: { '!room:test': invalidCatalogs, '!other:test': [cachedCatalog] },
      })
    );
    const h = setup();
    h.member(longUserId);
    expect(h.snapshot().eligible).toBe(false);
    expect(setup(false, viewer, '!other:test').snapshot().models).toEqual(cachedCatalog.models);
  });

  it('hides old scope data on an identity mismatch without deleting the signed-in cache', async () => {
    await setup().discover();
    const h = setup();
    expect(h.snapshot().eligible).toBe(true);
    vi.spyOn(h.mx, 'getUserId').mockReturnValue('@other:test');
    h.member('@other:test');
    expect(h.snapshot().eligible).toBe(false);
    expect(h.snapshot('$new').eligible).toBe(false);
    h.controller.refresh(h.room, '$new');
    expect(values.has(key)).toBe(true);
  });

  it('keeps at most 64 rooms across reloads, evicting the least recently discovered', async () => {
    for (let room = 0; room < 64; room += 1) {
      await setup(false, viewer, `!room${room}:test`).discover();
    }
    await setup(false, viewer, '!room0:test').discover();
    await setup(false, viewer, '!room64:test').discover();
    const stored = JSON.parse(values.get(key)!) as { rooms: Record<string, unknown> };
    expect(Object.keys(stored.rooms)).toHaveLength(64);
    expect(setup(false, viewer, '!room64:test').snapshot().eligible).toBe(true);
    expect(setup(false, viewer, '!room0:test').snapshot().eligible).toBe(true);
    expect(setup(false, viewer, '!room1:test').snapshot().eligible).toBe(false);
  });

  it('bounds the stored JSON even when many rooms have large valid catalogs', async () => {
    const models = Array.from({ length: 24 }, (_, index) => ({
      key: `model-${index}`,
      display_name: 'Model name '.repeat(90),
      provider: 'local',
      id: 'model-id'.repeat(125),
    }));
    for (let room = 0; room < 10; room += 1) {
      await setup(false, viewer, `!large${room}:test`).discover({ models });
    }
    expect(values.get(key)!.length * 2).toBeLessThanOrEqual(512 * 1024);
    expect(setup(false, viewer, '!large9:test').snapshot().models).toEqual(models);
    expect(setup(false, viewer, '!large0:test').snapshot().eligible).toBe(false);
  });

  it('reloads disk seeds when explicitly restarting a disposed controller', async () => {
    const initial = setup();
    const release = initial.controller.retain();
    await initial.discover();
    release();
    const other = setup(false, viewer, '!other:test');
    await other.discover();

    initial.controller.retain();
    expect(initial.controller.getSnapshot(other.room, '$seed').eligible).toBe(true);
  });

  it('reads only once and does not write for unrelated membership or device events', async () => {
    const read = vi.spyOn(localStorage, 'getItem');
    const h = setup();
    await h.discover();
    h.snapshot('$other');
    expect(read).toHaveBeenCalledExactlyOnceWith(key);
    read.mockClear();
    const write = vi.spyOn(localStorage, 'setItem');
    const remove = vi.spyOn(localStorage, 'removeItem');
    h.member('@someone:test', 'leave');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember('@someone:test')!);
    h.mx.emit(CryptoEvent.DevicesUpdated, ['@someone:test'], false);
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    h.member(helper, 'leave');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember(helper)!);
    h.mx.emit(CryptoEvent.DevicesUpdated, [router], false);
    expect(read).not.toHaveBeenCalled();
    expect(values.has(key)).toBe(false);
  });

  it('does not rewrite an unchanged room catalog when it is already the newest', async () => {
    const h = setup();
    await h.discover();
    const write = vi.spyOn(localStorage, 'setItem');
    h.controller.refresh(h.room, '$root');
    await flush();
    h.response(h.request());
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(write).not.toHaveBeenCalled();
  });

  it('removes the previous disk blob if an invalidation rewrite fails', async () => {
    await setup().discover();
    await setup(false, viewer, '!other:test').discover();
    const a = setup();
    a.controller.retain();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    a.member(helper, 'leave');
    a.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), a.room.getMember(helper)!);

    expect(values.has(key)).toBe(false);
  });

  it('ignores duplicate runtime IDs on read', () => {
    values.set(
      key,
      JSON.stringify({ version: 1, rooms: { '!room:test': [cachedCatalog, cachedCatalog] } })
    );
    expect(setup().snapshot().models).toEqual(cachedCatalog.models);
  });

  it('removes a device-invalidated catalog from disk', async () => {
    const h = setup();
    await h.discover();
    expect(setup().snapshot().eligible).toBe(true);
    h.mx.emit(CryptoEvent.DevicesUpdated, [router], false);
    expect(setup().snapshot().eligible).toBe(false);
  });
});

describe('shared model discovery', () => {
  it('hydrates lazy room membership before considering discovery candidates', async () => {
    const h = setup(true);
    vi.spyOn(h.mx, 'members').mockResolvedValue({
      chunk: [viewer, router, helper].map((id) => ({
        type: 'm.room.member',
        room_id: h.room.roomId,
        sender: id,
        state_key: id,
        content: { membership: 'join' },
      })) as IStateEventWithRoomId[],
    });
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    expect(h.queue).toHaveBeenCalledTimes(1);
    h.response(h.request());
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().eligible).toBe(true);
  });
  it('rediscovers for active subscribers after device invalidation', async () => {
    const h = setup();
    await h.discover();
    const oldCount = h.queued.length;
    h.mx.emit(CryptoEvent.DevicesUpdated, [router], false);
    // The button stays while it revalidates, but nothing can change the model meanwhile.
    expect(h.snapshot()).toMatchObject({ eligible: true, loading: true, canMutate: false });
    await flush();
    expect(h.queued.length).toBeGreaterThan(oldCount);
    h.response(h.request());
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot()).toMatchObject({ eligible: true, loading: false, canMutate: true });
  });
  it('does not cancel a selection when a superseded room seed runtime changes devices', async () => {
    const h = setup();
    await h.discover();
    const other = '@mindroom_other:test';
    h.member(other);
    h.devices.set(other, new Map([['OTHER', h.device(other, 'OTHER', 'other-curve')]]));

    h.controller.subscribe(h.room, '$new', () => {});
    expect(h.snapshot('$new')).toMatchObject({ eligible: true, canMutate: false });
    await flush();
    h.response(h.request(), {}, { senderCurve25519KeyBase64: 'other-curve' }, other);
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot('$new')).toMatchObject({ runtime: { userId: other }, canMutate: true });

    h.controller.selectModel(h.room, '$new', 'fast');
    expect(h.crypto.getUserDeviceInfo).toHaveBeenLastCalledWith([other], true);
    expect(h.send).not.toHaveBeenCalled();
    h.mx.emit(CryptoEvent.DevicesUpdated, [router], false);
    await flush();
    expect(h.send).toHaveBeenCalledOnce();
  });
  it('lets a watcher read a scope without asking for it', async () => {
    const h = setup();
    const heard = vi.fn();
    const unwatch = h.controller.watch(h.room, '$root', heard);
    await flush();
    await vi.advanceTimersByTimeAsync(120000);
    // Watching alone discovers nothing, now or on a retry, and wakes nothing up.
    h.mx.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Reconnecting);
    await flush();
    expect(h.queue).not.toHaveBeenCalled();
    expect(h.snapshot().models).toEqual([]);

    // A composer's discovery reaches the watcher too.
    const unsubscribe = await h.discover();
    expect(heard).toHaveBeenCalled();
    expect(h.snapshot().models.map((model) => model.display_name)).toEqual([
      'Quick',
      'Reset model',
    ]);
    const requests = h.queued.length;
    unsubscribe();
    heard.mockClear();
    // With only the watcher left, a change of the room asks for nothing again.
    h.mx.emit(CryptoEvent.DevicesUpdated, [router], false);
    await flush();
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.queued.length).toBe(requests);
    expect(heard).toHaveBeenCalled();

    unwatch();
    heard.mockClear();
    await h.discover();
    expect(heard).not.toHaveBeenCalled();
  });
  it("gives a runtime's models only while its catalog is the one the scope shows", async () => {
    const h = setup();
    h.devices.get(router)!.set('SECOND', h.device(router, 'SECOND', 'curve2'));
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    h.response(h.request());
    h.response(h.request(), {}, { senderCurve25519KeyBase64: 'curve2' });
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    const names = (deviceId: string, userId = router, threadId = '$root') =>
      h.controller
        .runtimeModels(h.room, threadId, userId, deviceId)
        .map((model) => model.display_name);
    // Two runtimes and no choice yet: the scope shows neither's catalog.
    expect([names('DEVICE'), names('SECOND')]).toEqual([[], []]);
    h.controller.chooseRuntime(h.room, '$root', h.snapshot().runtimes[1]!.id);
    // Both list `fast`, perhaps under other names: only the shown runtime's answer names its own.
    expect(names('SECOND')).toEqual(['Quick', 'Reset model']);
    expect([names('DEVICE'), names('GONE'), names('SECOND', helper)]).toEqual([[], [], []]);
    // The same list while nothing changes, as a store's snapshot must be.
    expect(h.controller.runtimeModels(h.room, '$root', router, 'DEVICE')).toBe(
      h.controller.runtimeModels(h.room, '$root', router, 'GONE')
    );
  });
  it("gives the one cached runtime's models to a thread not discovered yet", async () => {
    const h = setup();
    await h.discover();
    const names = (deviceId: string) =>
      h.controller
        .runtimeModels(h.room, '$second', router, deviceId)
        .map((model) => model.display_name);
    expect(h.snapshot('$second').runtime).toBeUndefined();
    expect(names('DEVICE')).toEqual(['Quick', 'Reset model']);
    expect(names('SECOND')).toEqual([]);
  });
  it('coalesces subscribers and authenticates actual curve key before exposing capability', async () => {
    const h = setup();
    const a = h.controller.subscribe(h.room, '$root', () => {});
    const b = h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    expect(h.queue).toHaveBeenCalledTimes(1);
    expect(h.snapshot().eligible).toBe(false);
    h.response(h.request());
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().eligible).toBe(true);
    expect(h.snapshot().runtime).toMatchObject({
      userId: router,
      deviceId: 'DEVICE',
      curveKey: 'curve',
    });
    expect(h.crypto.getUserDeviceInfo).toHaveBeenCalledWith(expect.arrayContaining([router]), true);
    a();
    b();
  });
  it('reuses room capability across threads without copying another thread selection', async () => {
    const h = setup();
    await h.discover();
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    h.ack();
    await flush();
    h.controller.subscribe(h.room, '$second', () => {});
    await flush();
    expect(h.snapshot('$second').eligible).toBe(true);
    expect(h.snapshot('$second').override).toBeNull();
    expect(h.snapshot('$second').runtime).toBeUndefined();
    expect(h.snapshot('$second').loading).toBe(true);
    h.controller.selectModel(h.room, '$second', 'fast');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('registers listener before a synchronous transport response', async () => {
    const h = setup();
    h.queue.mockImplementation(async (batch: any) => {
      h.response(batch.batch[0].payload.encrypted);
    });
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().eligible).toBe(true);
  });
  it.each(['invite', 'leave', 'foreign', 'self-left'])(
    'does not probe ineligible candidate rooms: %s',
    async (kind) => {
      const h = setup();
      h.member(router, 'leave');
      h.member(helper, 'leave');
      if (kind === 'foreign') h.member('@mindroom_router:elsewhere');
      else if (kind === 'self-left') {
        h.member(router);
        h.member(viewer, 'leave');
      } else h.member(router, kind);
      h.controller.subscribe(h.room, '$root', () => {});
      await flush();
      expect(h.queue).not.toHaveBeenCalled();
      expect(h.snapshot().eligible).toBe(false);
    }
  );
  it.each([
    'plaintext',
    'curve',
    'sender',
    'unsigned',
    'rotated',
    'room',
    'thread',
    'request',
    'no-eligible-agent',
    'left-agent',
    'invited-agent',
    'foreign-agent',
  ])('rejects untrusted or mismatched reply: %s', async (kind) => {
    const h = setup();
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    const changes: any = {};
    const identity: any = {};
    if (kind === 'curve') identity.senderCurve25519KeyBase64 = 'unknown';
    if (kind === 'sender') identity.sender = '@stranger:test';
    if (kind === 'unsigned')
      h.crypto.getDeviceVerificationStatus.mockResolvedValue({ signedByOwner: false });
    if (kind === 'rotated')
      h.devices.get(router)!.set('DEVICE', h.device(router, 'DEVICE', 'new-key'));
    if (kind === 'room') changes.room_id = '!elsewhere:test';
    if (kind === 'thread') changes.thread_id = '$other';
    if (kind === 'request') changes.request_id = 'old';
    if (kind === 'no-eligible-agent') changes.agent_user_ids = [];
    if (kind === 'left-agent') h.member(helper, 'leave');
    if (kind === 'invited-agent') h.member(helper, 'invite');
    if (kind === 'foreign-agent') {
      h.member('@mindroom_helper:elsewhere');
      changes.agent_user_ids = ['@mindroom_helper:elsewhere'];
    }
    h.response(h.request(), changes, kind === 'plaintext' ? null : identity);
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().eligible).toBe(false);
  });
  it('discovers a signed runtime that is the only agent in the room', async () => {
    const h = setup();
    h.member(router, 'leave');
    h.devices.set(helper, new Map([['DEVICE', h.device(helper)]]));
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    h.response(h.request(), { agent_user_ids: [helper] }, undefined, helper);
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot()).toMatchObject({
      eligible: true,
      canMutate: true,
      runtime: { userId: helper, deviceId: 'DEVICE' },
    });
  });
  it('requires explicit choice between authenticated runtime devices', async () => {
    const h = setup();
    h.devices.get(router)!.set('SECOND', h.device(router, 'SECOND', 'curve2'));
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    h.response(h.request());
    h.response(h.request(), {}, { senderCurve25519KeyBase64: 'curve2' });
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().runtimes).toHaveLength(2);
    expect(h.snapshot().runtime).toBeUndefined();
    h.controller.chooseRuntime(h.room, '$root', h.snapshot().runtimes[1]!.id);
    expect(h.snapshot().runtime?.deviceId).toBe('SECOND');
  });
  it('does not silently retain an automatic choice when a second runtime appears', async () => {
    const h = setup();
    await h.discover();
    h.devices.get(router)!.set('SECOND', h.device(router, 'SECOND', 'curve2'));
    h.controller.refresh(h.room, '$root');
    await flush();
    h.response(h.request());
    h.response(h.request(), {}, { senderCurve25519KeyBase64: 'curve2' });
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().runtime).toBeUndefined();
  });
  it('keeps controllers isolated per client and removes listeners on logout', async () => {
    const h = setup();
    await h.discover();
    const other = setup();
    expect(other.snapshot().eligible).toBe(false);
    expect(getModelController(h.mx)).toBe(h.controller);
    h.mx.emit(ClientEvent.Sync, SyncState.Stopped, SyncState.Syncing);
    expect(h.snapshot().eligible).toBe(false);
    expect(h.mx.listenerCount(ClientEvent.ReceivedToDeviceMessage)).toBe(0);
  });
  it.each(['logout', 'device change'])(
    'clears evicted thread room catalogs on %s',
    async (cause) => {
      const h = setup();
      const leave = await h.discover();
      leave();
      for (let index = 0; index < 65; index += 1) {
        h.controller.getSnapshot(new Room('!cache' + index + ':test', h.mx, viewer), '$root');
      }
      if (cause === 'logout') disposeModelController(h.mx);
      else h.mx.emit(CryptoEvent.DevicesUpdated, [router], false);
      expect(h.snapshot().eligible).toBe(false);
    }
  );
  it('expires in 12 seconds and ignores late navigation and disposal replies', async () => {
    const h = setup();
    const leave = h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    const request = h.request();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().loading).toBe(false);
    h.response(request);
    await flush();
    expect(h.snapshot().eligible).toBe(false);
    // The retry asks again under a new ID; the expired request's answer still counts for nothing.
    await vi.advanceTimersByTimeAsync(3000);
    const next = h.request();
    expect(next.request_id).not.toBe(request.request_id);
    leave();
    h.response(next);
    await flush();
    expect(h.snapshot().eligible).toBe(false);
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    const last = h.request();
    h.response(request);
    h.response(next);
    await flush();
    expect(h.snapshot().eligible).toBe(false);
    disposeModelController(h.mx);
    h.response(last);
    await flush();
    expect(h.snapshot().eligible).toBe(false);
  });
  it('asks again after an unanswered window and shows the answer to the retry', async () => {
    const h = setup();
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    const first = h.request();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot()).toMatchObject({ eligible: false, loading: false });
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.snapshot().loading).toBe(true);
    expect(h.request().request_id).not.toBe(first.request_id);
    h.response(h.request());
    await flush();
    expect(h.snapshot()).toMatchObject({ eligible: true, canMutate: true });
  });
  it.each(['unsubscribe', 'dispose'])(
    'backs off 3, 10, 30 then 60 seconds between attempts and stops on %s',
    async (stop) => {
      const h = setup();
      const leave = h.controller.subscribe(h.room, '$root', () => {});
      await flush();
      const asked = () =>
        new Set(h.queued.map((b) => b.batch[0].payload.encrypted.request_id)).size;
      expect(asked()).toBe(1);
      for (const [index, delay] of [3000, 10000, 30000, 60000, 60000].entries()) {
        await vi.advanceTimersByTimeAsync(12000 + delay - 1);
        expect(asked()).toBe(index + 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(asked()).toBe(index + 2);
      }
      if (stop === 'unsubscribe') leave();
      else disposeModelController(h.mx);
      const sent = h.queued.length;
      await vi.advanceTimersByTimeAsync(10 * 60000);
      expect(h.queued.length).toBe(sent);
    }
  );
  it('probes again when the keys of a room candidate arrive after a probe found no signed device', async () => {
    const h = setup();
    const known = h.devices.get(router)!;
    h.devices.delete(router);
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    expect(h.queue).not.toHaveBeenCalled();
    expect(h.snapshot().loading).toBe(false);
    h.devices.set(router, known);
    h.mx.emit(CryptoEvent.DevicesUpdated, [router], false);
    await flush();
    expect(h.queue).toHaveBeenCalledTimes(1);
    h.response(h.request());
    await flush();
    expect(h.snapshot().eligible).toBe(true);
  });
  it('probes a shown scope without a button again when sync comes back', async () => {
    const h = setup();
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    const asked = h.queued.length;
    h.mx.emit(ClientEvent.Sync, SyncState.Reconnecting, SyncState.Syncing);
    await flush();
    expect(h.queued.length).toBe(asked);
    h.mx.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Reconnecting);
    await flush();
    expect(h.queued.length).toBe(asked + 1);
    h.response(h.request());
    await flush();
    expect(h.snapshot().eligible).toBe(true);
  });
  it('probes a shown scope without a button again when the page becomes visible', async () => {
    const page = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
    vi.stubGlobal('document', page);
    try {
      const h = setup();
      h.controller.subscribe(h.room, '$root', () => {});
      await flush();
      await vi.advanceTimersByTimeAsync(12000);
      const asked = h.queued.length;
      page.dispatchEvent(new Event('visibilitychange'));
      await flush();
      expect(h.queued.length).toBe(asked);
      page.visibilityState = 'visible';
      page.dispatchEvent(new Event('visibilitychange'));
      await flush();
      expect(h.queued.length).toBe(asked + 1);
      disposeModelController(h.mx);
      page.dispatchEvent(new Event('visibilitychange'));
      await flush();
      expect(h.queued.length).toBe(asked + 1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('keeps the button through an unrelated membership change without letting it send', async () => {
    const h = setup();
    await h.discover();
    const asked = h.queued.length;
    h.member('@someone:test');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember('@someone:test')!);
    expect(h.snapshot()).toMatchObject({
      eligible: true,
      loading: true,
      canMutate: false,
      override: null,
    });
    expect(h.snapshot().models).toHaveLength(2);
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.queued.length).toBeGreaterThan(asked);
    h.response(h.request());
    await flush();
    expect(h.snapshot().canMutate).toBe(true);
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('keeps a cached button and its room cache while local capacity refuses its probe', async () => {
    const h = setup();
    (await h.discover())();
    const busy = Array.from({ length: 8 }, (_, index) =>
      h.controller.subscribe(h.room, '$busy' + index, () => {})
    );
    await flush();
    h.controller.subscribe(h.room, '$ninth', () => {});
    await flush();
    expect(h.snapshot('$ninth')).toMatchObject({ eligible: true, canMutate: false });
    expect(h.snapshot('$ninth').error).toBeDefined();
    const asked = h.queued.length;
    for (let wake = 0; wake < 6; wake += 1) {
      h.mx.emit(ClientEvent.Sync, SyncState.Reconnecting, SyncState.Syncing);
      h.mx.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Reconnecting);
      await flush();
    }
    expect(h.queued.length).toBe(asked);
    expect(h.snapshot('$ninth').eligible).toBe(true);
    expect(h.snapshot('$fresh').eligible).toBe(true);
    busy.forEach((leave) => leave());
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.request().thread_id).toBe('$ninth');
    h.response(h.request());
    await flush();
    expect(h.snapshot('$ninth')).toMatchObject({ eligible: true, canMutate: true });
  });
  it('backs off and hides a button whose runtime lost its signed devices', async () => {
    const h = setup();
    await h.discover();
    const known = h.devices.get(router)!;
    h.devices.delete(router);
    const probes = h.crypto.getUserDeviceInfo.mock.calls.length;
    h.mx.emit(CryptoEvent.DevicesUpdated, [router], false);
    await flush();
    expect(h.snapshot()).toMatchObject({ eligible: true, canMutate: false });
    // Probes at 0, 3, 13 and 43 s, then every 60 s: the fifth, at 103 s, hides the button.
    await vi.advanceTimersByTimeAsync(102000);
    expect(h.crypto.getUserDeviceInfo.mock.calls.length - probes).toBe(4);
    expect(h.snapshot().eligible).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.snapshot().eligible).toBe(false);
    await vi.advanceTimersByTimeAsync(10 * 60000 - 103000);
    expect(h.crypto.getUserDeviceInfo.mock.calls.length - probes).toBe(13);
    h.devices.set(router, known);
    h.mx.emit(CryptoEvent.DevicesUpdated, [router], false);
    await flush();
    h.response(h.request());
    await flush();
    expect(h.snapshot()).toMatchObject({ eligible: true, canMutate: true });
  });
  it('gives up on one thread without evicting the room cache another thread just verified', async () => {
    const h = setup();
    await h.discover();
    h.controller.subscribe(h.room, '$a', () => {});
    await flush();
    expect(h.snapshot('$a').eligible).toBe(true);
    // Four unanswered attempts: 12 s, then retries after 3, 10 and 30 s.
    for (const delay of [0, 3000, 10000, 30000]) await vi.advanceTimersByTimeAsync(delay + 12000);
    expect(h.snapshot('$a')).toMatchObject({ eligible: true, canMutate: false });
    h.controller.subscribe(h.room, '$b', () => {});
    await flush();
    expect(h.request().thread_id).toBe('$b');
    h.response(h.request());
    await flush();
    expect(h.snapshot('$b')).toMatchObject({ eligible: true, canMutate: true });
    // The fifth attempt, 60 s later, also goes unanswered.
    await vi.advanceTimersByTimeAsync(60000 + 12000);
    expect(h.snapshot('$a').eligible).toBe(false);
    expect(h.snapshot('$b').eligible).toBe(true);
    h.controller.subscribe(h.room, '$c', () => {});
    expect(h.snapshot('$c').eligible).toBe(true);
  });
  it('hides a revalidating button after 5 failed attempts and shows it on a later answer', async () => {
    const h = setup();
    await h.discover();
    h.member('@someone:test');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember('@someone:test')!);
    await flush();
    // Attempts 1 to 4 end unanswered: the button stays, with the error and its Retry.
    for (const delay of [3000, 10000, 30000]) {
      await vi.advanceTimersByTimeAsync(12000 + delay);
      expect(h.snapshot().eligible).toBe(true);
    }
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot()).toMatchObject({ eligible: true, loading: false, canMutate: false });
    expect(h.snapshot().error).toBeDefined();
    await vi.advanceTimersByTimeAsync(60000 + 12000);
    expect(h.snapshot().eligible).toBe(false);
    // The join kept the runtime and its agent, so the room cache stays for another thread.
    expect(h.snapshot('$second').eligible).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.snapshot().loading).toBe(true);
    h.response(h.request());
    await flush();
    expect(h.snapshot()).toMatchObject({ eligible: true, canMutate: true });
  });
  it('keeps the button through a burst of membership changes', async () => {
    const h = setup();
    await h.discover();
    const join = (userId: string) => {
      h.member(userId);
      h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember(userId)!);
    };
    join('@one:test');
    join('@two:test');
    join('@three:test');
    expect(h.snapshot()).toMatchObject({ eligible: true, canMutate: false });
    await flush();
    join('@four:test');
    expect(h.snapshot()).toMatchObject({ eligible: true, canMutate: false });
    await flush();
    h.response(h.request());
    await flush();
    expect(h.snapshot()).toMatchObject({ eligible: true, canMutate: true });
  });
  it('keeps a button opened from the room cache through its first membership change', async () => {
    const h = setup();
    (await h.discover())();
    h.controller.subscribe(h.room, '$b', () => {});
    await flush();
    expect(h.snapshot('$b')).toMatchObject({ eligible: true, canMutate: false });
    const asked = h.request().request_id;
    h.member('@someone:test');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember('@someone:test')!);
    await flush();
    expect(h.request().request_id).not.toBe(asked);
    expect(h.snapshot('$b')).toMatchObject({ eligible: true, loading: true, canMutate: false });
  });
  it('shows a revisited thread its last selection at once after a membership change while away', async () => {
    const h = setup();
    const inherited = [{ entity: 'helper', model: 'fast' }];
    const leave = h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    h.response(h.request(), { selection: { override: 'reset', inherited } });
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    leave();
    h.member('@someone:test');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember('@someone:test')!);
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    expect(h.snapshot()).toMatchObject({
      eligible: true,
      override: 'reset',
      inherited,
      loading: true,
      canMutate: false,
    });
    expect(h.snapshot().models).toHaveLength(2);
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    expect(h.send).not.toHaveBeenCalled();
    h.response(h.request(), { selection: { override: 'fast', inherited } });
    await flush();
    expect(h.snapshot()).toMatchObject({ override: 'fast', canMutate: true });
  });
  it('shows a thread first opened from the room cache the room default at once', async () => {
    const h = setup();
    (await h.discover())();
    h.controller.subscribe(h.room, '$second', () => {});
    await flush();
    expect(h.snapshot('$second')).toMatchObject({
      eligible: true,
      override: null,
      inherited: [{ entity: 'helper', model: 'fast' }],
      loading: true,
      canMutate: false,
    });
    expect(h.snapshot('$second').models).toHaveLength(2);
    h.response(h.request(), {
      selection: { override: 'reset', inherited: [{ entity: 'helper', model: 'fast' }] },
    });
    await flush();
    expect(h.snapshot('$second')).toMatchObject({ override: 'reset', canMutate: true });
  });
  it('keeps the room cache through a membership change that keeps its agents, not a departure', async () => {
    const h = setup();
    (await h.discover())();
    h.member('@someone:test');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember('@someone:test')!);
    h.controller.subscribe(h.room, '$second', () => {});
    await flush();
    expect(h.snapshot('$second')).toMatchObject({
      eligible: true,
      inherited: [{ entity: 'helper', model: 'fast' }],
    });
    h.member(helper, 'leave');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember(helper)!);
    expect(h.snapshot()).toMatchObject({ eligible: false, inherited: [] });
    expect(h.snapshot('$second')).toMatchObject({ eligible: false, inherited: [] });
    h.member(helper);
    expect(h.snapshot('$third')).toMatchObject({ eligible: false, inherited: [] });
  });
  it('does not show a thread left before its runtime devices changed the old selection', async () => {
    const h = setup();
    const inherited = [{ entity: 'helper', model: 'fast' }];
    const leave = h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    h.response(h.request(), { selection: { override: 'reset', inherited } });
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    leave();
    h.mx.emit(CryptoEvent.DevicesUpdated, [router], false);
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    expect(h.snapshot()).toMatchObject({ eligible: false, override: null, inherited: [] });
    h.response(h.request(), { selection: { override: 'reset', inherited } });
    await flush();
    expect(h.snapshot()).toMatchObject({ eligible: true, override: 'reset', canMutate: true });
  });
  it('drops what no composer shows once one of its agents leaves, not a shown button', async () => {
    const h = setup();
    const other = '@mindroom_other:test';
    h.member(other);
    const answer = {
      agent_user_ids: [helper, other],
      selection: {
        override: null,
        inherited: [
          { entity: 'helper', model: 'fast' },
          { entity: 'other', model: 'reset' },
        ],
      },
    };
    const leave = h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    h.response(h.request(), answer);
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    leave();
    h.controller.subscribe(h.room, '$shown', () => {});
    await flush();
    h.member(other, 'leave');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember(other)!);
    expect(h.snapshot('$new')).toMatchObject({ eligible: false, inherited: [] });
    h.controller.subscribe(h.room, '$root', () => {});
    expect(h.snapshot()).toMatchObject({ eligible: false, inherited: [] });
    expect(h.snapshot('$shown')).toMatchObject({ eligible: true, canMutate: false });
  });
  it('keeps a shown button through an agent leaving without naming that agent', async () => {
    const h = setup();
    const other = '@mindroom_other:test';
    h.member(other);
    const leave = h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    h.response(h.request(), {
      agent_user_ids: [helper, other],
      selection: {
        override: null,
        inherited: [
          { entity: 'helper', model: 'fast' },
          { entity: 'other', model: 'reset' },
        ],
      },
    });
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    h.member(other, 'leave');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember(other)!);
    const gone = { eligible: true, override: null, inherited: [], canMutate: false };
    expect(h.snapshot()).toMatchObject(gone);
    expect(h.snapshot().models).toHaveLength(2);
    // Closed and opened again before discovery answers, it still names no one who left.
    leave();
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    expect(h.snapshot()).toMatchObject(gone);
    h.response(h.request());
    await flush();
    expect(h.snapshot()).toMatchObject({ inherited: [{ entity: 'helper', model: 'fast' }] });
  });
  it('drops the room cache when a command finds its runtime device gone', async () => {
    const h = setup();
    await h.discover();
    h.devices.set(router, new Map());
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.snapshot('$new').eligible).toBe(false);
  });
  it('starts counting failures again after an answer', async () => {
    const h = setup();
    await h.discover();
    const invalidate = (userId: string) => {
      h.member(userId);
      h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember(userId)!);
    };
    invalidate('@one:test');
    await flush();
    // Four unanswered attempts, then the fifth, 60 s later, is answered.
    for (const delay of [3000, 10000, 30000]) await vi.advanceTimersByTimeAsync(12000 + delay);
    await vi.advanceTimersByTimeAsync(12000 + 60000);
    h.response(h.request());
    await flush();
    expect(h.snapshot()).toMatchObject({ eligible: true, canMutate: true });
    // Invalidate while the answered query's window is still open, so the reset must come from the answer.
    invalidate('@two:test');
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot()).toMatchObject({ eligible: true, loading: false, canMutate: false });
    const asked = h.request().request_id;
    await vi.advanceTimersByTimeAsync(2999);
    expect(h.request().request_id).toBe(asked);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.request().request_id).not.toBe(asked);
  });
  it('resets the failure count on the answer itself, not on a later invalidation', async () => {
    const h = setup();
    await h.discover();
    h.member('@one:test');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember('@one:test')!);
    await flush();
    // Four unanswered attempts, then the fifth, 60 s later, is answered.
    for (const delay of [3000, 10000, 30000]) await vi.advanceTimersByTimeAsync(12000 + delay);
    await vi.advanceTimersByTimeAsync(12000 + 60000);
    h.response(h.request());
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    // A plain refresh (no invalidation) goes unanswered: it is the first failure, so retry after 3 s.
    h.controller.refresh(h.room, '$root');
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot()).toMatchObject({ eligible: true, canMutate: true });
    const asked = h.request().request_id;
    await vi.advanceTimersByTimeAsync(2999);
    expect(h.request().request_id).toBe(asked);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.request().request_id).not.toBe(asked);
  });
  it('does not probe again on a sync that stays syncing', async () => {
    const h = setup();
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    const asked = h.request().request_id;
    h.mx.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
    await flush();
    expect(h.request().request_id).toBe(asked);
  });
  it('keeps a verified button through 5 unanswered refreshes', async () => {
    const h = setup();
    await h.discover();
    h.controller.refresh(h.room, '$root');
    await flush();
    const attempts = new Set([h.request().request_id]);
    for (const delay of [3000, 10000, 30000, 60000]) {
      await vi.advanceTimersByTimeAsync(12000 + delay);
      attempts.add(h.request().request_id);
    }
    expect(attempts.size).toBe(5);
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot()).toMatchObject({ eligible: true, loading: false });
    expect(h.snapshot().models).toHaveLength(2);
  });
  it('stops the spinner of a kept button when local capacity refuses its probe', async () => {
    const h = setup();
    // These scopes come first, so their probes take the capacity before the shown thread asks.
    const threads = Array.from({ length: 8 }, (_, index) => '$busy' + index);
    threads.forEach((thread) => h.snapshot(thread));
    await h.discover();
    const busy = threads.map((thread) => h.controller.subscribe(h.room, thread, () => {}));
    await flush();
    h.member('@someone:test');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember('@someone:test')!);
    await flush();
    expect(h.snapshot()).toMatchObject({
      eligible: true,
      loading: false,
      canMutate: false,
      error: 'Model discovery is busy. Try again.',
    });
    busy.forEach((leave) => leave());
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.request().thread_id).toBe('$root');
    h.response(h.request());
    await flush();
    expect(h.snapshot()).toMatchObject({ eligible: true, canMutate: true });
  });
  it('invalidates membership and device changes immediately', async () => {
    const h = setup();
    await h.discover();
    h.member(helper, 'leave');
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember(helper)!);
    expect(h.snapshot().eligible).toBe(false);
    h.member(helper);
    h.controller.refresh(h.room, '$root');
    await flush();
    h.response(h.request());
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().canMutate).toBe(true);
    h.mx.emit(CryptoEvent.DevicesUpdated, [router], false);
    expect(h.snapshot()).toMatchObject({ eligible: true, canMutate: false });
  });
  it('retries omitted encrypted recipients without dropping or widening target set', async () => {
    const h = setup();
    h.devices.get(router)!.set('SECOND', h.device(router, 'SECOND', 'curve2'));
    let omitted = false;
    h.crypto.encryptToDeviceMessages.mockImplementation(async (_type, recipients, content) => ({
      eventType: 'm.room.encrypted',
      batch: recipients
        .filter((recipient: { deviceId: string }) => {
          if (recipient.deviceId !== 'SECOND' || omitted) return true;
          omitted = true;
          return false;
        })
        .map((recipient: object) => ({ ...recipient, payload: { encrypted: content } })),
    }));
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.queued.flatMap((batch) => batch.batch.map((r: any) => r.deviceId))).toEqual([
      'DEVICE',
      'SECOND',
    ]);
  });
  it('shows the model picker after discovery succeeds beside a stale signed device', async () => {
    const h = setup();
    h.devices.get(router)!.set('STALE', h.device(router, 'STALE', 'stale-curve'));
    h.crypto.encryptToDeviceMessages.mockImplementation(async (_type, recipients, content) => {
      if (recipients.some((recipient: { deviceId: string }) => recipient.deviceId === 'STALE')) {
        throw new Error('Device has no Olm session');
      }
      return {
        eventType: 'm.room.encrypted',
        batch: recipients.map((recipient: object) => ({
          ...recipient,
          payload: { encrypted: content },
        })),
      };
    });
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    expect(h.queued).toHaveLength(1);
    h.response(h.request());
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().eligible).toBe(true);
    expect(h.snapshot().canMutate).toBe(true);
  });
  it('retransmits unanswered discovery with the same request ID and stops after authenticated response', async () => {
    const h = setup();
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    const first = h.request();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.queued).toHaveLength(2);
    expect(h.request()).toEqual(first);
    h.response(h.request());
    await flush();
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.queued).toHaveLength(2);
    expect(h.snapshot().eligible).toBe(true);
  });
});

describe('model mutation acknowledgement', () => {
  it('exposes recovery-blocked mutation availability after a settled send loses its acknowledgement', async () => {
    const h = setup();
    await h.discover();
    expect(h.snapshot().canMutate).toBe(true);
    h.controller.refresh(h.room, '$root');
    await flush();
    expect(h.snapshot().canMutate).toBe(true);
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.snapshot().canMutate).toBe(false);
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().pending).toBe(false);
    expect(h.snapshot().loading).toBe(true);
    expect(h.snapshot().canMutate).toBe(false);
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().pending).toBe(false);
    expect(h.snapshot().loading).toBe(false);
    expect(h.snapshot().error).toBeDefined();
    expect(h.snapshot().canMutate).toBe(false);
    h.controller.selectModel(h.room, '$root', 'fast');
    h.controller.resetToRoomDefault(h.room, '$root');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    h.controller.refresh(h.room, '$root');
    await flush();
    h.response(h.request());
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().canMutate).toBe(true);
    h.controller.resetToRoomDefault(h.room, '$root');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['timeout', 'resolve'],
    ['timeout', 'reject'],
    ['device invalidation', 'resolve'],
    ['device invalidation', 'reject'],
  ])(
    'retains unresolved SDK send ownership after %s until %s and fresh discovery',
    async (cause, settlement) => {
      const h = setup();
      await h.discover();
      let resolve!: (value: { event_id: string }) => void;
      let reject!: (error: Error) => void;
      h.send.mockImplementationOnce(
        () =>
          new Promise((done, fail) => {
            resolve = done;
            reject = fail;
          })
      );
      h.controller.selectModel(h.room, '$root', 'fast');
      await flush();
      const initialRequestId = h.request().request_id;
      if (cause === 'timeout') await vi.advanceTimersByTimeAsync(12000);
      else {
        h.mx.emit(CryptoEvent.DevicesUpdated, [router], false);
        await flush();
      }
      expect(h.request().request_id).not.toBe(initialRequestId);
      h.response(h.request(), { selection: { override: 'reset', inherited: [] } });
      await flush();
      await vi.advanceTimersByTimeAsync(12000);
      expect(h.snapshot().override).toBe('reset');
      expect(h.snapshot().loading).toBe(false);
      h.controller.resetToRoomDefault(h.room, '$root');
      await flush();
      expect(h.send).toHaveBeenCalledTimes(1);
      expect(h.snapshot().pending).toBe(true);
      const requestBeforeSettlement = h.request().request_id;
      if (settlement === 'resolve') resolve({ event_id: '$command' });
      else reject(new Error('transport failed'));
      await flush();
      expect(h.snapshot().loading).toBe(true);
      expect(h.request().request_id).not.toBe(requestBeforeSettlement);
      h.controller.resetToRoomDefault(h.room, '$root');
      await flush();
      expect(h.send).toHaveBeenCalledTimes(1);
      h.response(h.request(), { selection: { override: 'fast', inherited: [] } });
      await flush();
      await vi.advanceTimersByTimeAsync(12000);
      expect(h.snapshot().override).toBe('fast');
      expect(h.snapshot().pending).toBe(false);
      h.controller.resetToRoomDefault(h.room, '$root');
      await flush();
      expect(h.send).toHaveBeenCalledTimes(2);
    }
  );
  it('retains the transport barrier through client remount and inactive cache eviction', async () => {
    const h = setup();
    const leave = await h.discover();
    let resolve!: (value: { event_id: string }) => void;
    h.send.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    leave();
    h.mx.emit(ClientEvent.Sync, SyncState.Stopped, SyncState.Syncing);
    const release = h.controller.retain();
    for (let index = 0; index < 65; index += 1) {
      h.controller.getSnapshot(new Room('!cache' + index + ':test', h.mx, viewer), '$root');
    }
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    const beforeSettlement = h.request();
    resolve({ event_id: '$command' });
    await flush();
    const afterSettlement = h.request();
    expect(afterSettlement.request_id).not.toBe(beforeSettlement.request_id);
    h.response(beforeSettlement);
    await flush();
    h.controller.resetToRoomDefault(h.room, '$root');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.snapshot().pending).toBe(true);
    h.response(afterSettlement, { selection: { override: 'fast', inherited: [] } });
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().override).toBe('fast');
    expect(h.snapshot().pending).toBe(false);
    h.controller.resetToRoomDefault(h.room, '$root');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(2);
    release();
  });
  it.each(['valid', 'wrong-key', 'unsigned', 'plaintext'])(
    'authenticates encrypted room acknowledgement: %s',
    async (kind) => {
      const h = setup();
      h.room.currentState.setStateEvents([
        new MatrixEvent({
          type: 'm.room.encryption',
          room_id: h.room.roomId,
          state_key: '',
          content: { algorithm: 'm.megolm.v1.aes-sha2' },
        }),
      ]);
      expect(h.room.currentState.getStateEvents('m.room.encryption', '')).not.toBeNull();
      await h.discover();
      h.controller.selectModel(h.room, '$root', 'fast');
      await flush();
      const clear = h.ack();
      await flush();
      if (kind !== 'plaintext') {
        const encrypted = new MatrixEvent({
          event_id: '$encrypted-ack',
          type: 'm.room.encrypted',
          sender: router,
          room_id: h.room.roomId,
          content: {
            algorithm: 'm.megolm.v1.aes-sha2',
            ciphertext: 'ciphertext',
            session_id: 'session',
            'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
          },
        });
        await encrypted.attemptDecryption({
          decryptEvent: async () => ({
            clearEvent: {
              type: 'm.room.message',
              room_id: h.room.roomId,
              content: clear.getContent(),
            },
            senderCurve25519Key: kind === 'wrong-key' ? 'other' : 'curve',
            claimedEd25519Key: 'edkey',
          }),
        } as unknown as CryptoBackend);
        expect(encrypted.getType()).toBe('m.room.message');
        expect(encrypted.getRelation()?.event_id).toBe('$root');
        if (kind === 'unsigned')
          h.crypto.getDeviceVerificationStatus.mockResolvedValue({ signedByOwner: false });
        h.mx.emit(MatrixEventEvent.Decrypted, encrypted);
        await flush();
      }
      expect(h.snapshot().override).toBe(kind === 'valid' ? 'fast' : null);
      expect(h.snapshot().pending).toBe(kind !== 'valid');
    }
  );
  it('does not send the command again after its send fails', async () => {
    const h = setup();
    await h.discover();
    h.send.mockRestore();
    // A synced client re-emits room local echo updates; the old fallback resent from those.
    h.mx.reEmitter.reEmit(h.room, [RoomEvent.LocalEchoUpdated]);
    const sends: string[] = [];
    vi.spyOn(h.mx.http, 'authedRequest').mockImplementation(async (_method, path) => {
      if (path.includes('/send/')) sends.push(path);
      throw new Error('offline');
    });
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    await flush();
    expect(sends).toHaveLength(1);
    expect(h.snapshot().error).toBe(
      'Model selection unconfirmed. Try again once the models reload.'
    );
  });
  it('sends reset without a model key and applies only a confirmed null override', async () => {
    const h = setup();
    await h.discover();
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    h.ack();
    await flush();
    h.controller.resetToRoomDefault(h.room, '$root');
    await flush();
    expect(
      (h.send.mock.calls[1]![2] as unknown as Record<string, unknown>)[
        'io.mindroom.model_selection'
      ]
    ).toEqual({
      version: 1,
      runtime_user_id: router,
      runtime_device_id: 'DEVICE',
      operation: 'reset',
    });
    expect(h.snapshot().override).toBe('fast');
    h.ack({ operation: 'reset', model: undefined, override: null });
    await flush();
    expect(h.snapshot().override).toBeNull();
  });
  describe('reasoning levels', () => {
    const sol = {
      key: 'sol',
      display_name: 'Sol',
      provider: 'codex',
      id: 'gpt-sol',
      reasoning_levels: ['low', 'medium', 'high', 'xhigh'],
      reasoning_default: 'high',
    };
    const levelled = async (h: ReturnType<typeof setup>, selection: object) => {
      h.controller.subscribe(h.room, '$root', () => {});
      await flush();
      h.response(h.request(), {
        models: [{ key: 'fast', display_name: 'Quick', provider: 'openai', id: 'model' }, sol],
        selection,
      });
      await flush();
      await vi.advanceTimersByTimeAsync(12000);
    };
    const sent = (h: ReturnType<typeof setup>, call = 0) =>
      h.send.mock.calls[call]![2] as unknown as Record<string, any>;

    it('shows the level of the override and of each inherited model', async () => {
      const h = setup();
      await levelled(h, {
        override: 'sol',
        reasoning: 'xhigh',
        inherited: [{ entity: 'helper', model: 'sol', reasoning: 'low' }],
      });
      expect(h.snapshot().override).toBe('sol');
      expect(h.snapshot().reasoning).toBe('xhigh');
      expect(h.snapshot().inherited).toEqual([
        { entity: 'helper', model: 'sol', reasoning: 'low' },
      ]);
    });

    it('sends the model at a level as one reference and applies its echo', async () => {
      const h = setup();
      await levelled(h, { override: null, inherited: [{ entity: 'helper', model: 'sol' }] });
      h.controller.selectModel(h.room, '$root', 'sol', 'xhigh');
      await flush();
      expect(h.send).toHaveBeenCalledTimes(1);
      expect(sent(h).body).toBe('!model sol@xhigh');
      expect(sent(h)['io.mindroom.model_selection']).toEqual({
        version: 1,
        runtime_user_id: router,
        runtime_device_id: 'DEVICE',
        operation: 'set',
        model: 'sol@xhigh',
      });
      // A result for the plain key answers another command.
      h.ack({ model: 'sol', override: 'sol' });
      await flush();
      expect(h.snapshot().pending).toBe(true);
      h.ack({ model: 'sol@xhigh', override: 'sol@xhigh' });
      await flush();
      expect(h.snapshot()).toMatchObject({ pending: false, override: 'sol', reasoning: 'xhigh' });
    });

    it('names the default level too, since a stale catalog may name another default', async () => {
      const h = setup();
      await levelled(h, { override: 'sol', reasoning: 'low', inherited: [] });
      h.controller.selectModel(h.room, '$root', 'sol', 'high');
      await flush();
      expect(sent(h).body).toBe('!model sol@high');
      expect(sent(h)['io.mindroom.model_selection'].model).toBe('sol@high');
      h.ack({ model: 'sol', override: 'sol' });
      await flush();
      expect(h.snapshot().pending).toBe(true);
      h.ack({ model: 'sol@high', override: 'sol@high' });
      await flush();
      expect(h.snapshot()).toMatchObject({ pending: false, override: 'sol', reasoning: 'high' });
    });

    it('sends the plain key for a model without a level, which clears the level', async () => {
      const h = setup();
      await levelled(h, { override: 'sol', reasoning: 'low', inherited: [] });
      h.controller.selectModel(h.room, '$root', 'sol');
      await flush();
      expect(sent(h).body).toBe('!model sol');
      h.ack({ model: 'sol', override: 'sol' });
      await flush();
      expect(h.snapshot()).toMatchObject({ override: 'sol', reasoning: null });
    });

    it('refuses a level the model does not offer, and any level on a model without levels', async () => {
      const h = setup();
      await levelled(h, { override: null, inherited: [] });
      h.controller.selectModel(h.room, '$root', 'sol', 'max');
      h.controller.selectModel(h.room, '$root', 'fast', 'high');
      await flush();
      expect(h.send).not.toHaveBeenCalled();
      expect(h.snapshot().pending).toBe(false);
    });

    it('never sends a reference to a backend whose catalog has no levels', async () => {
      const h = setup();
      await h.discover();
      expect(h.snapshot().models.some((m) => m.reasoning_levels)).toBe(false);
      h.controller.selectModel(h.room, '$root', 'fast', 'high');
      await flush();
      expect(h.send).not.toHaveBeenCalled();
      h.controller.selectModel(h.room, '$root', 'fast');
      await flush();
      expect(sent(h).body).toBe('!model fast');
      expect(h.snapshot().reasoning).toBeNull();
    });
  });
  it('reports rejection without changing confirmed selection', async () => {
    const h = setup();
    await h.discover();
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    h.ack({ status: 'rejected', override: undefined, error: 'Selection denied' });
    await flush();
    expect(h.snapshot().pending).toBe(false);
    expect(h.snapshot().error).toBe('Selection denied');
    expect(h.snapshot().override).toBeNull();
  });
  it('sends stable key with exact thread/runtime metadata and waits for its own result', async () => {
    const h = setup();
    await h.discover();
    h.controller.selectModel(h.room, '$root', 'reset');
    await flush();
    expect(h.send).toHaveBeenCalledWith(
      '!room:test',
      '$root',
      expect.objectContaining({
        body: '!model reset',
        msgtype: 'm.text',
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: '$root',
          is_falling_back: true,
          'm.in_reply_to': { event_id: '$root' },
        },
        'io.mindroom.model_selection': {
          version: 1,
          runtime_user_id: router,
          runtime_device_id: 'DEVICE',
          operation: 'set',
          model: 'reset',
        },
      })
    );
    expect(h.snapshot().pending).toBe(true);
    expect(h.snapshot().override).toBeNull();
    h.ack({ model: 'reset', override: 'reset' });
    await flush();
    expect(h.snapshot().override).toBe('reset');
    expect(h.snapshot().pending).toBe(false);
  });
  it('buffers authenticated early acknowledgement until send yields event ID', async () => {
    const h = setup();
    await h.discover();
    let resolve!: (value: { event_id: string }) => void;
    h.send.mockImplementation(
      () =>
        new Promise((done) => {
          h.ack();
          resolve = done;
        })
    );
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    expect(h.snapshot().pending).toBe(true);
    resolve({ event_id: '$command' });
    await flush();
    expect(h.snapshot().override).toBe('fast');
  });
  it.each([
    { command_event_id: '$other' },
    { runtime_device_id: 'OTHER' },
    { thread_id: '$other' },
    { runtime_user_id: helper },
    { model: 'reset', override: 'reset' },
    { room_id: '!other:test' },
  ])('ignores mismatched acknowledgement %j', async (changes) => {
    const h = setup();
    await h.discover();
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    h.ack(changes);
    await flush();
    expect(h.snapshot().pending).toBe(true);
    expect(h.snapshot().override).toBeNull();
  });
  it('keeps pending through unmount, serializes mutations, and isolates other thread', async () => {
    const h = setup();
    const leave = await h.discover();
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    leave();
    h.controller.resetToRoomDefault(h.room, '$root');
    await flush();
    expect(h.send).toHaveBeenCalledTimes(1);
    h.ack();
    await flush();
    expect(h.snapshot().override).toBe('fast');
    expect(h.snapshot('$other').override).toBeNull();
  });
  it('waits for a joined agent result for the typed !model, even from another runtime', async () => {
    const h = setup();
    await h.discover();
    expect(h.snapshot().override).toBeNull();
    const asked = h.queued.length;
    h.message(viewer, '!model fast', '$typed');
    h.message(helper, 'Something else', '$unrelated');
    await flush();
    expect(h.queued.length).toBe(asked);
    h.ack({ command_event_id: '$older' }, { event_id: '$oldAnswer' });
    await flush();
    expect(h.queued.length).toBe(asked);
    h.ack({ command_event_id: '$typed', runtime_user_id: helper }, { sender: helper });
    await flush();
    expect(h.queued.length).toBe(asked + 1);
    h.response(h.request(), { selection: { override: 'fast', inherited: [] } });
    await flush();
    expect(h.snapshot().override).toBe('fast');
    h.message(helper, 'Something else', '$later');
    await flush();
    expect(h.queued.length).toBe(asked + 1);
  });

  it('reprobes once for each overlapping typed model command', async () => {
    const h = setup();
    await h.discover();
    const asked = h.queued.length;
    h.message(viewer, '!model fast', '$first');
    h.message(viewer, '/model reset', '$second');

    h.ack({ command_event_id: '$first' });
    await flush();
    expect(h.queued.length).toBe(asked + 1);
    h.ack({ command_event_id: '$first' }, { event_id: '$duplicateAnswer' });
    await flush();
    expect(h.queued.length).toBe(asked + 1);

    h.message(helper, 'This thread now uses reset.', '$secondAnswer', {
      eventId: '$second',
      isFallback: false,
    });
    await flush();
    expect(h.queued.length).toBe(asked + 2);
  });

  it('reprobes on a genuine legacy reply to /model, not a thread fallback', async () => {
    const h = setup();
    await h.discover();
    const asked = h.queued.length;
    h.message(viewer, '/model fast', '$typed');
    h.message(helper, 'Something else', '$unrelated', { eventId: '$typed', isFallback: true });
    await flush();
    expect(h.queued.length).toBe(asked);
    h.message(helper, 'This thread now uses fast.', '$answer', {
      eventId: '$typed',
      isFallback: false,
    });
    await flush();
    expect(h.queued.length).toBe(asked + 1);
  });
  it('shows the first answer before its window ends, and follows a !model typed inside it', async () => {
    const h = setup();
    h.controller.subscribe(h.room, '$root', () => {});
    await flush();
    h.response(h.request());
    await flush();
    // The chip shows the thread's selection at once rather than when the 12 s window ends.
    expect(h.snapshot()).toMatchObject({ eligible: true, override: null, loading: true });
    const asked = h.queued.length;
    h.message(viewer, '!model fast', '$typed');
    h.ack({ command_event_id: '$typed' });
    await flush();
    expect(h.queued.length).toBe(asked + 1);
    h.response(h.request(), { selection: { override: 'fast', inherited: [] } });
    await flush();
    expect(h.snapshot().override).toBe('fast');
    // The answer from before the command never comes back when the window ends.
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot()).toMatchObject({ eligible: true, override: 'fast', loading: false });
  });
  it('refreshes after timeout and prevents older discovery replacing acknowledged selection', async () => {
    const h = setup();
    await h.discover();
    h.controller.refresh(h.room, '$root');
    await flush();
    const older = h.request();
    h.controller.selectModel(h.room, '$root', 'fast');
    await flush();
    h.ack();
    await flush();
    h.response(older);
    await flush();
    expect(h.snapshot().override).toBe('fast');
    h.controller.resetToRoomDefault(h.room, '$root');
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.snapshot().override).toBe('fast');
    expect(h.snapshot().pending).toBe(false);
    expect(h.snapshot().error).toBeDefined();
    expect(h.snapshot().loading).toBe(true);
  });
});

describe('ModelController main-room next-thread draft', () => {
  const rootCaps = ['model_selection', 'thread_model_on_root'];
  const reasoningModels = [
    {
      key: 'sonnet',
      display_name: 'Sonnet',
      provider: 'anthropic',
      id: 'claude-sonnet',
      reasoning_levels: ['low', 'medium', 'high'],
      reasoning_default: 'medium',
    },
    { key: 'fast', display_name: 'Quick', provider: 'openai', id: 'model' },
  ];

  const discoverMainRoom = async (
    h: ReturnType<typeof setup>,
    changes: Record<string, unknown> = {}
  ) => {
    const unsubscribe = h.controller.subscribe(h.room, undefined, () => {});
    await flush();
    h.response(h.request(), {
      capabilities: rootCaps,
      models: reasoningModels,
      ...changes,
    });
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    return unsubscribe;
  };

  it('stays ineligible in main-room scope when runtime lacks thread_model_on_root', async () => {
    const h = setup();
    h.controller.subscribe(h.room, undefined, () => {});
    await flush();
    const req = h.request();
    expect(req.thread_id).toBeUndefined();
    h.response(req, { capabilities: ['model_selection'] });
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.controller.getSnapshot(h.room, undefined)).toMatchObject({
      eligible: false,
      canMutate: false,
      override: null,
      error: undefined,
    });
  });

  it('sets, updates with reasoning level, clears, and consumes the local draft without sending', async () => {
    const h = setup();
    await discoverMainRoom(h);
    expect(h.controller.getSnapshot(h.room, undefined)).toMatchObject({
      eligible: true,
      canMutate: true,
      override: null,
      reasoning: null,
    });

    h.controller.selectModel(h.room, undefined, 'sonnet', 'high');
    expect(h.send).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot(h.room, undefined)).toMatchObject({
      override: 'sonnet',
      reasoning: 'high',
      pending: false,
    });

    const stamped = h.controller.takeRootModelDraft(h.room);
    expect(stamped).toEqual({
      [THREAD_MODEL_KEY]: {
        version: 1,
        runtime_user_id: router,
        runtime_device_id: 'DEVICE',
        model: 'sonnet@high',
      },
    });
    expect(h.controller.getSnapshot(h.room, undefined)).toMatchObject({
      override: null,
      reasoning: null,
    });
    expect(h.controller.takeRootModelDraft(h.room)).toBeUndefined();

    // Choosing Default clears the draft without sending.
    h.controller.selectModel(h.room, undefined, 'fast');
    expect(h.controller.getSnapshot(h.room, undefined).override).toBe('fast');
    h.controller.resetToRoomDefault(h.room, undefined);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot(h.room, undefined).override).toBeNull();
    expect(h.controller.takeRootModelDraft(h.room)).toBeUndefined();
  });

  it('preserves a valid draft across routine membership events', async () => {
    const h = setup();
    await discoverMainRoom(h);
    h.controller.selectModel(h.room, undefined, 'fast');

    h.member('@bystander:test', 'join');
    const bystander = h.room.getMember('@bystander:test')!;
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), bystander, 'leave');
    await flush();

    // Still stamped even if sent before the background re-probe answers.
    expect(h.controller.getSnapshot(h.room, undefined).override).toBe('fast');
    expect(h.controller.takeRootModelDraft(h.room)).toEqual({
      [THREAD_MODEL_KEY]: {
        version: 1,
        runtime_user_id: router,
        runtime_device_id: 'DEVICE',
        model: 'fast',
      },
    });
  });

  it('silently drops the draft and hides the picker when the runtime leaves', async () => {
    const h = setup();
    await discoverMainRoom(h);
    h.controller.selectModel(h.room, undefined, 'fast');

    h.member(router, 'leave');
    const routerMember = h.room.getMember(router)!;
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), routerMember, 'join');
    await flush();

    expect(h.controller.getSnapshot(h.room, undefined)).toMatchObject({
      eligible: false,
      override: null,
      reasoning: null,
    });
    expect(h.controller.takeRootModelDraft(h.room)).toBeUndefined();
  });

  it('silently drops the draft and hides the picker when thread_model_on_root disappears', async () => {
    const h = setup();
    await discoverMainRoom(h);
    h.controller.selectModel(h.room, undefined, 'fast');

    h.controller.refresh(h.room, undefined);
    await flush();
    h.response(h.request(), { capabilities: ['model_selection'] });
    await flush();
    await vi.advanceTimersByTimeAsync(12000);

    expect(h.controller.getSnapshot(h.room, undefined)).toMatchObject({
      eligible: false,
      override: null,
      reasoning: null,
    });
    expect(h.controller.takeRootModelDraft(h.room)).toBeUndefined();
  });

  it('keeps the draft through a completed routine-membership refresh when the same runtime answers', async () => {
    const h = setup();
    await discoverMainRoom(h);
    h.controller.selectModel(h.room, undefined, 'sonnet', 'high');

    h.member('@bystander:test', 'join');
    h.mx.emit(
      RoomMemberEvent.Membership,
      new MatrixEvent({}),
      h.room.getMember('@bystander:test')!,
      'leave'
    );
    await flush();
    h.response(h.request(), { capabilities: rootCaps, models: reasoningModels }, {}, router);
    await flush();
    await vi.advanceTimersByTimeAsync(12000);

    expect(h.controller.getSnapshot(h.room, undefined)).toMatchObject({
      eligible: true,
      canMutate: true,
      override: 'sonnet',
      reasoning: 'high',
    });
    expect(h.controller.takeRootModelDraft(h.room)).toEqual({
      [THREAD_MODEL_KEY]: {
        version: 1,
        runtime_user_id: router,
        runtime_device_id: 'DEVICE',
        model: 'sonnet@high',
      },
    });
  });

  it('drops the draft silently when another runtime becomes the shown catalog poster', async () => {
    const h = setup();
    await discoverMainRoom(h);
    h.controller.selectModel(h.room, undefined, 'sonnet', 'high');

    const alpha = '@mindroom_alpha:test';
    h.member(alpha, 'join');
    h.devices.set(alpha, new Map([['DEV_A', h.device(alpha, 'DEV_A', 'curve-a')]]));
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember(alpha)!, 'leave');
    await flush();

    // Only A answers the refresh; picker switches to A and must never show B's draft against A.
    h.response(
      h.request(),
      { capabilities: rootCaps, models: reasoningModels },
      { senderCurve25519KeyBase64: 'curve-a' },
      alpha
    );
    await flush();
    await vi.advanceTimersByTimeAsync(12000);

    const snap = h.controller.getSnapshot(h.room, undefined);
    expect(snap).toMatchObject({
      eligible: true,
      canMutate: true,
      override: null,
      reasoning: null,
    });
    expect(snap.runtime?.userId).toBe(alpha);
    expect(h.controller.takeRootModelDraft(h.room)).toBeUndefined();
  });

  it('drops the draft silently on a device change or when another device of the same user answers', async () => {
    const h = setup();
    await discoverMainRoom(h);
    h.controller.selectModel(h.room, undefined, 'sonnet', 'high');

    // A device update for the draft runtime drops the draft immediately.
    h.devices.set(router, new Map([['DEV_NEW', h.device(router, 'DEV_NEW', 'curve-new')]]));
    h.mx.emit(CryptoEvent.DevicesUpdated, [router], false);
    await flush();

    expect(h.controller.getSnapshot(h.room, undefined)).toMatchObject({
      override: null,
      reasoning: null,
    });
    expect(h.controller.takeRootModelDraft(h.room)).toBeUndefined();

    // Even without DevicesUpdated, a refresh answered by a different device of the same user drops it.
    h.response(
      h.request(),
      { capabilities: rootCaps, models: reasoningModels },
      { senderCurve25519KeyBase64: 'curve-new' },
      router
    );
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    h.controller.selectModel(h.room, undefined, 'fast');

    h.devices.set(router, new Map([['DEV_THIRD', h.device(router, 'DEV_THIRD', 'curve-third')]]));
    h.controller.refresh(h.room, undefined);
    await flush();
    h.response(
      h.request(),
      { capabilities: rootCaps, models: reasoningModels },
      { senderCurve25519KeyBase64: 'curve-third' },
      router
    );
    await flush();
    await vi.advanceTimersByTimeAsync(12000);

    const snap = h.controller.getSnapshot(h.room, undefined);
    expect(snap.runtime?.deviceId).toBe('DEV_THIRD');
    expect(snap.override).toBeNull();
    expect(h.controller.takeRootModelDraft(h.room)).toBeUndefined();
  });

  it('drops the draft immediately if its exact runtime answers without thread_model_on_root after invalidation', async () => {
    const h = setup();
    await discoverMainRoom(h);
    h.controller.selectModel(h.room, undefined, 'fast');

    h.member('@bystander:test', 'join');
    h.mx.emit(
      RoomMemberEvent.Membership,
      new MatrixEvent({}),
      h.room.getMember('@bystander:test')!,
      'leave'
    );
    await flush();
    h.response(h.request(), { capabilities: ['model_selection'] }, {}, router);
    await flush();

    expect(h.controller.getSnapshot(h.room, undefined).override).toBeNull();
    expect(h.controller.takeRootModelDraft(h.room)).toBeUndefined();
  });

  it('drops the draft when the same runtime removes the picked model or level on refresh', async () => {
    const h = setup();
    await discoverMainRoom(h);
    h.controller.selectModel(h.room, undefined, 'sonnet', 'high');

    h.controller.refresh(h.room, undefined);
    await flush();
    h.response(
      h.request(),
      {
        capabilities: rootCaps,
        models: [{ key: 'fast', display_name: 'Quick', provider: 'openai', id: 'model' }],
      },
      {},
      router
    );
    await flush();
    await vi.advanceTimersByTimeAsync(12000);

    expect(h.controller.getSnapshot(h.room, undefined)).toMatchObject({
      eligible: true,
      override: null,
      reasoning: null,
    });
    expect(h.controller.takeRootModelDraft(h.room)).toBeUndefined();
  });

  it('keeps the draft when DevicesUpdated fires only for another runtime', async () => {
    const h = setup();
    const alpha = '@mindroom_alpha:test';
    h.member(alpha, 'join');
    h.devices.set(alpha, new Map([['DEV_A', h.device(alpha, 'DEV_A', 'curve-a')]]));

    h.controller.subscribe(h.room, undefined, () => {});
    await flush();
    const req = h.request();
    h.response(req, { capabilities: rootCaps, models: reasoningModels }, {}, router);
    h.response(
      req,
      { capabilities: rootCaps, models: reasoningModels },
      { senderCurve25519KeyBase64: 'curve-a' },
      alpha
    );
    await flush();
    await vi.advanceTimersByTimeAsync(12000);

    const routerRuntime = h.controller
      .getSnapshot(h.room, undefined)
      .runtimes.find((r) => r.userId === router)!;
    h.controller.chooseRuntime(h.room, undefined, routerRuntime.id);
    h.controller.selectModel(h.room, undefined, 'sonnet', 'high');

    h.mx.emit(CryptoEvent.DevicesUpdated, [alpha], false);
    await flush();

    expect(h.controller.getSnapshot(h.room, undefined)).toMatchObject({
      override: 'sonnet',
      reasoning: 'high',
    });
    expect(h.controller.takeRootModelDraft(h.room)).toEqual({
      [THREAD_MODEL_KEY]: {
        version: 1,
        runtime_user_id: router,
        runtime_device_id: 'DEVICE',
        model: 'sonnet@high',
      },
    });
  });

  it('drops the draft when its runtime replies with empty capabilities lacking model_selection', async () => {
    const h = setup();
    await discoverMainRoom(h);
    h.controller.selectModel(h.room, undefined, 'fast');

    h.controller.refresh(h.room, undefined);
    await flush();
    h.response(h.request(), { capabilities: [] }, {}, router);
    await flush();

    expect(h.controller.getSnapshot(h.room, undefined)).toMatchObject({
      eligible: false,
      override: null,
      reasoning: null,
    });
    expect(h.controller.takeRootModelDraft(h.room)).toBeUndefined();
  });

  it('pins the shown runtime when picking before a second runtime answers discovery', async () => {
    const h = setup();
    const alpha = '@mindroom_alpha:test';
    h.member(alpha, 'join');
    h.devices.set(alpha, new Map([['DEV_A', h.device(alpha, 'DEV_A', 'curve-a')]]));

    h.controller.subscribe(h.room, undefined, () => {});
    await flush();
    const req = h.request();
    h.response(req, { capabilities: rootCaps, models: reasoningModels }, {}, router);
    await flush();
    h.controller.selectModel(h.room, undefined, 'sonnet', 'high');

    // Second runtime answers later in the same discovery window.
    h.response(
      req,
      { capabilities: rootCaps, models: reasoningModels },
      { senderCurve25519KeyBase64: 'curve-a' },
      alpha
    );
    await flush();
    await vi.advanceTimersByTimeAsync(12000);

    const snap = h.controller.getSnapshot(h.room, undefined);
    expect(snap.runtime?.userId).toBe(router);
    expect(snap).toMatchObject({ override: 'sonnet', reasoning: 'high' });
    expect(h.controller.takeRootModelDraft(h.room)).toEqual({
      [THREAD_MODEL_KEY]: {
        version: 1,
        runtime_user_id: router,
        runtime_device_id: 'DEVICE',
        model: 'sonnet@high',
      },
    });
  });

  it('clears stale chosenRuntimeId on fallback so the new sole runtime answers immediately', async () => {
    const h = setup();
    await discoverMainRoom(h);
    h.controller.selectModel(h.room, undefined, 'fast');

    // Alpha becomes sole poster; fallback switches shown runtime to alpha.
    const alpha = '@mindroom_alpha:test';
    h.member(alpha, 'join');
    h.devices.set(alpha, new Map([['DEV_A', h.device(alpha, 'DEV_A', 'curve-a')]]));
    h.mx.emit(RoomMemberEvent.Membership, new MatrixEvent({}), h.room.getMember(alpha)!, 'leave');
    await flush();
    h.response(
      h.request(),
      { capabilities: rootCaps, models: reasoningModels },
      { senderCurve25519KeyBase64: 'curve-a' },
      alpha
    );
    await flush();
    await vi.advanceTimersByTimeAsync(12000);
    expect(h.controller.getSnapshot(h.room, undefined).runtime?.userId).toBe(alpha);

    // Next refresh after membership invalidation accepts alpha immediately before the 12s window ends.
    h.member('@bystander:test', 'join');
    h.mx.emit(
      RoomMemberEvent.Membership,
      new MatrixEvent({}),
      h.room.getMember('@bystander:test')!,
      'leave'
    );
    await flush();
    h.response(
      h.request(),
      { capabilities: rootCaps, models: reasoningModels },
      { senderCurve25519KeyBase64: 'curve-a' },
      alpha
    );
    await flush();
    expect(h.controller.getSnapshot(h.room, undefined).canMutate).toBe(true);
  });

  it('isolates drafts per account and clears on dispose', async () => {
    const h1 = setup(false, '@alice:test');
    const h2 = setup(false, '@bob:test');
    await discoverMainRoom(h1);
    h1.controller.selectModel(h1.room, undefined, 'fast');

    expect(h2.controller.getSnapshot(h2.room, undefined).override).toBeNull();
    expect(h2.controller.takeRootModelDraft(h2.room)).toBeUndefined();

    h1.controller.dispose();
    expect(h1.controller.takeRootModelDraft(h1.room)).toBeUndefined();
  });
});
