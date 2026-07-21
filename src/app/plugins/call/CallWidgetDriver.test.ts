import { type MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallWidgetDriver } from './CallWidgetDriver';
import {
  CALL_MEMBERSHIP_WRITES_SETTLE_TIMEOUT_MS,
  roomCallMembershipWritesSettled,
  trackRoomCallMembershipWrite,
} from './rtcMembershipCleanup';

type EncryptBatch = Awaited<
  ReturnType<NonNullable<ReturnType<MatrixClient['getCrypto']>>['encryptToDeviceMessages']>
>;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const encryptedBatch = (...recipients: Array<{ userId: string; deviceId: string }>): EncryptBatch =>
  ({
    eventType: 'm.room.encrypted',
    batch: recipients.map(({ userId, deviceId }) => ({ userId, deviceId, payload: {} })),
  } as EncryptBatch);

const makeDriver = (batches: EncryptBatch[]) => {
  const encryptToDeviceMessages = vi.fn();
  batches.forEach((batch) => encryptToDeviceMessages.mockResolvedValueOnce(batch));
  const getUserDeviceInfo = vi
    .fn()
    .mockImplementation((userIds: string[]) =>
      Promise.resolve(new Map(userIds.map((userId) => [userId, { has: () => true }])))
    );
  const prepareToEncrypt = vi.fn();
  const room = { roomId: '!room:example.org' };
  const getRoom = vi.fn().mockReturnValue(room);
  const queueToDevice = vi.fn().mockResolvedValue(undefined);
  const mx = {
    getDeviceId: () => 'LOCAL',
    getSafeUserId: () => '@local:example.org',
    getRoom,
    getCrypto: () => ({ encryptToDeviceMessages, getUserDeviceInfo, prepareToEncrypt }),
    queueToDevice,
  } as unknown as MatrixClient;

  return {
    driver: new CallWidgetDriver(mx, '!room:example.org'),
    encryptToDeviceMessages,
    getUserDeviceInfo,
    getRoom,
    prepareToEncrypt,
    queueToDevice,
    room,
  };
};

describe('CallWidgetDriver.sendToDevice', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('prepares lazy encrypted-room members before looking up call devices', async () => {
    const recipient = { userId: '@agent:example.org', deviceId: 'AGENT' };
    const { driver, getUserDeviceInfo, prepareToEncrypt, room } = makeDriver([
      encryptedBatch(recipient),
    ]);

    await driver.sendToDevice('io.element.call.encryption_keys', true, {
      [recipient.userId]: { [recipient.deviceId]: { keys: { key: 'secret', index: 0 } } },
    });

    expect(prepareToEncrypt).toHaveBeenCalledWith(room);
    expect(prepareToEncrypt.mock.invocationCallOrder[0]).toBeLessThan(
      getUserDeviceInfo.mock.invocationCallOrder[0]
    );
  });

  it('queues an encrypted batch once every recipient is present', async () => {
    const recipient = { userId: '@agent:example.org', deviceId: 'AGENT' };
    const { driver, encryptToDeviceMessages, getUserDeviceInfo, queueToDevice } = makeDriver([
      encryptedBatch(recipient),
    ]);

    await driver.sendToDevice('io.element.call.encryption_keys', true, {
      [recipient.userId]: { [recipient.deviceId]: { keys: { key: 'secret', index: 0 } } },
    });

    expect(getUserDeviceInfo).toHaveBeenCalledWith([recipient.userId]);
    expect(encryptToDeviceMessages).toHaveBeenCalledTimes(1);
    expect(queueToDevice).toHaveBeenCalledOnce();
  });

  it('waits for a newly joined device and retries an empty encryption batch', async () => {
    vi.useFakeTimers();
    const recipient = { userId: '@agent:example.org', deviceId: 'AGENT' };
    const { driver, encryptToDeviceMessages, getUserDeviceInfo, queueToDevice } = makeDriver([
      encryptedBatch(),
      encryptedBatch(recipient),
    ]);

    const send = driver.sendToDevice('io.element.call.encryption_keys', true, {
      [recipient.userId]: { [recipient.deviceId]: { keys: { key: 'secret', index: 0 } } },
    });
    await vi.advanceTimersByTimeAsync(250);
    await send;

    expect(getUserDeviceInfo).toHaveBeenCalledTimes(2);
    expect(encryptToDeviceMessages).toHaveBeenCalledTimes(2);
    expect(queueToDevice).toHaveBeenCalledOnce();
  });

  it('waits until the exact target device reaches the Rust crypto store', async () => {
    vi.useFakeTimers();
    const recipient = { userId: '@agent:example.org', deviceId: 'AGENT' };
    const { driver, encryptToDeviceMessages, getUserDeviceInfo, queueToDevice } = makeDriver([
      encryptedBatch(recipient),
    ]);
    getUserDeviceInfo
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map([[recipient.userId, new Map([[recipient.deviceId, {}]])]]));

    const send = driver.sendToDevice('io.element.call.encryption_keys', true, {
      [recipient.userId]: { [recipient.deviceId]: { keys: { key: 'secret', index: 0 } } },
    });
    await vi.advanceTimersByTimeAsync(250);
    await send;

    expect(getUserDeviceInfo).toHaveBeenCalledTimes(2);
    expect(encryptToDeviceMessages).toHaveBeenCalledOnce();
    expect(queueToDevice).toHaveBeenCalledOnce();
  });

  it('prepares a room that appears after the first key-delivery attempt', async () => {
    vi.useFakeTimers();
    const recipient = { userId: '@agent:example.org', deviceId: 'AGENT' };
    const { driver, getRoom, getUserDeviceInfo, prepareToEncrypt, queueToDevice, room } =
      makeDriver([encryptedBatch(recipient)]);
    getRoom.mockReturnValueOnce(null).mockReturnValue(room);
    getUserDeviceInfo
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map([[recipient.userId, new Map([[recipient.deviceId, {}]])]]));

    const send = driver.sendToDevice('io.element.call.encryption_keys', true, {
      [recipient.userId]: { [recipient.deviceId]: { keys: { key: 'secret', index: 0 } } },
    });
    await vi.advanceTimersByTimeAsync(250);
    await send;

    expect(getRoom).toHaveBeenCalledTimes(2);
    expect(prepareToEncrypt).toHaveBeenCalledWith(room);
    expect(queueToDevice).toHaveBeenCalledOnce();
  });

  it('queues available devices and retries only recipients omitted by crypto', async () => {
    vi.useFakeTimers();
    const first = { userId: '@agent:example.org', deviceId: 'KNOWN' };
    const second = { userId: '@agent:example.org', deviceId: 'NEW' };
    const { driver, encryptToDeviceMessages, queueToDevice } = makeDriver([
      encryptedBatch(first),
      encryptedBatch(second),
    ]);

    const send = driver.sendToDevice('io.element.call.encryption_keys', true, {
      [first.userId]: {
        [first.deviceId]: { keys: { key: 'secret', index: 0 } },
        [second.deviceId]: { keys: { key: 'secret', index: 0 } },
      },
    });
    await vi.advanceTimersByTimeAsync(250);
    await send;

    expect(encryptToDeviceMessages).toHaveBeenNthCalledWith(
      2,
      'io.element.call.encryption_keys',
      [second],
      { keys: { key: 'secret', index: 0 } }
    );
    expect(queueToDevice).toHaveBeenCalledTimes(2);
  });

  it('retries exact recipients when the local to-device queue rejects a batch', async () => {
    vi.useFakeTimers();
    const recipient = { userId: '@agent:example.org', deviceId: 'AGENT' };
    const { driver, encryptToDeviceMessages, queueToDevice } = makeDriver([
      encryptedBatch(recipient),
      encryptedBatch(recipient),
    ]);
    queueToDevice.mockRejectedValueOnce(new Error('store unavailable'));

    const send = driver.sendToDevice('io.element.call.encryption_keys', true, {
      [recipient.userId]: { [recipient.deviceId]: { keys: { key: 'secret', index: 0 } } },
    });
    await vi.advanceTimersByTimeAsync(250);
    await send;

    expect(encryptToDeviceMessages).toHaveBeenCalledTimes(2);
    expect(encryptToDeviceMessages).toHaveBeenNthCalledWith(
      2,
      'io.element.call.encryption_keys',
      [recipient],
      { keys: { key: 'secret', index: 0 } }
    );
    expect(queueToDevice).toHaveBeenCalledTimes(2);
  });

  it('continues retrying a missing device in the background', async () => {
    vi.useFakeTimers();
    const recipient = { userId: '@agent:example.org', deviceId: 'MISSING' };
    const { driver, queueToDevice } = makeDriver([
      encryptedBatch(),
      encryptedBatch(),
      encryptedBatch(),
      encryptedBatch(),
      encryptedBatch(),
      encryptedBatch(recipient),
    ]);

    const send = driver.sendToDevice('io.element.call.encryption_keys', true, {
      [recipient.userId]: { [recipient.deviceId]: { keys: { key: 'secret', index: 0 } } },
    });
    await vi.advanceTimersByTimeAsync(5500);
    await send;
    expect(queueToDevice).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);

    expect(queueToDevice).toHaveBeenCalledOnce();
  });

  it('recovers when the exact device appears only after foreground retries', async () => {
    vi.useFakeTimers();
    const recipient = { userId: '@agent:example.org', deviceId: 'LATE' };
    const { driver, encryptToDeviceMessages, getUserDeviceInfo, queueToDevice } = makeDriver([
      encryptedBatch(recipient),
    ]);
    getUserDeviceInfo
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map([[recipient.userId, new Map([[recipient.deviceId, {}]])]]));

    const send = driver.sendToDevice('io.element.call.encryption_keys', true, {
      [recipient.userId]: { [recipient.deviceId]: { keys: { key: 'secret', index: 0 } } },
    });
    await vi.advanceTimersByTimeAsync(5500);
    await send;
    expect(encryptToDeviceMessages).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);

    expect(encryptToDeviceMessages).toHaveBeenCalledOnce();
    expect(queueToDevice).toHaveBeenCalledOnce();
  });

  it('keeps retries independent for different recipients of the same event type', async () => {
    vi.useFakeTimers();
    const first = { userId: '@first-agent:example.org', deviceId: 'FIRST' };
    const second = { userId: '@second-agent:example.org', deviceId: 'SECOND' };
    const { driver, encryptToDeviceMessages, queueToDevice } = makeDriver([
      encryptedBatch(),
      encryptedBatch(),
      encryptedBatch(),
      encryptedBatch(),
      encryptedBatch(),
      encryptedBatch(second),
      encryptedBatch(first),
    ]);

    const firstSend = driver.sendToDevice('io.element.call.encryption_keys', true, {
      [first.userId]: { [first.deviceId]: { keys: { key: 'first', index: 0 } } },
    });
    await vi.advanceTimersByTimeAsync(5500);
    await firstSend;

    await driver.sendToDevice('io.element.call.encryption_keys', true, {
      [second.userId]: { [second.deviceId]: { keys: { key: 'second', index: 0 } } },
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect(encryptToDeviceMessages).toHaveBeenLastCalledWith(
      'io.element.call.encryption_keys',
      [first],
      { keys: { key: 'first', index: 0 } }
    );
    expect(queueToDevice).toHaveBeenCalledTimes(2);
  });

  it('does not queue an older key superseded during encryption', async () => {
    const recipient = { userId: '@agent:example.org', deviceId: 'AGENT' };
    const oldEncryption = deferred<EncryptBatch>();
    const { driver, encryptToDeviceMessages, queueToDevice } = makeDriver([]);
    encryptToDeviceMessages
      .mockImplementationOnce(() => oldEncryption.promise)
      .mockResolvedValueOnce(encryptedBatch(recipient));

    const oldSend = driver.sendToDevice('io.element.call.encryption_keys', true, {
      [recipient.userId]: { [recipient.deviceId]: { keys: { key: 'old', index: 0 } } },
    });
    await vi.waitFor(() => expect(encryptToDeviceMessages).toHaveBeenCalledOnce());

    await driver.sendToDevice('io.element.call.encryption_keys', true, {
      [recipient.userId]: { [recipient.deviceId]: { keys: { key: 'new', index: 1 } } },
    });
    oldEncryption.resolve(encryptedBatch(recipient));
    await oldSend;

    expect(queueToDevice).toHaveBeenCalledOnce();
    expect(encryptToDeviceMessages).toHaveBeenNthCalledWith(
      2,
      'io.element.call.encryption_keys',
      [recipient],
      { keys: { key: 'new', index: 1 } }
    );
  });

  it('does not continue an in-flight key send after disposal', async () => {
    const recipient = { userId: '@agent:example.org', deviceId: 'AGENT' };
    const deviceInfo = deferred<Map<string, never>>();
    const { driver, encryptToDeviceMessages, getUserDeviceInfo, queueToDevice } = makeDriver([]);
    getUserDeviceInfo.mockImplementationOnce(() => deviceInfo.promise);

    const send = driver.sendToDevice('io.element.call.encryption_keys', true, {
      [recipient.userId]: { [recipient.deviceId]: { keys: { key: 'secret', index: 0 } } },
    });
    await vi.waitFor(() => expect(getUserDeviceInfo).toHaveBeenCalledOnce());
    driver.dispose();
    deviceInfo.resolve(new Map());
    await send;

    expect(encryptToDeviceMessages).not.toHaveBeenCalled();
    expect(queueToDevice).not.toHaveBeenCalled();
  });

  it('stops background retries when the call driver is disposed', async () => {
    vi.useFakeTimers();
    const recipient = { userId: '@agent:example.org', deviceId: 'MISSING' };
    const { driver, queueToDevice } = makeDriver([
      encryptedBatch(),
      encryptedBatch(),
      encryptedBatch(),
      encryptedBatch(),
      encryptedBatch(),
    ]);

    const send = driver.sendToDevice('io.element.call.encryption_keys', true, {
      [recipient.userId]: { [recipient.deviceId]: { keys: { key: 'secret', index: 0 } } },
    });
    await vi.advanceTimersByTimeAsync(5500);
    await send;
    driver.dispose();
    await vi.advanceTimersByTimeAsync(5000);

    expect(queueToDevice).not.toHaveBeenCalled();
  });
});

describe('CallWidgetDriver.sendEvent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const flushMicrotasks = () =>
    new Promise<void>((resolve) => {
      process.nextTick(resolve);
    });

  const makeStateDriver = (roomId: string) => {
    const sendStateEvent = vi.fn().mockResolvedValue({ event_id: '$published' });
    const mx = {
      getDeviceId: () => 'LOCAL',
      getSafeUserId: () => '@local:example.org',
      sendStateEvent,
    } as unknown as MatrixClient;
    return { driver: new CallWidgetDriver(mx, roomId), sendStateEvent };
  };

  it('serializes a membership publish behind a predecessor cleanup write still in flight', async () => {
    // The claim fence cannot recall a `{}` PUT already on the wire, so the
    // successor call's own membership publish must wait for it to settle —
    // otherwise the stale write could land second and wipe the fresh state.
    const roomId = '!driver-gate:example.org';
    const { driver, sendStateEvent } = makeStateDriver(roomId);
    let settleCleanup!: () => void;
    trackRoomCallMembershipWrite(
      roomId,
      new Promise<void>((resolve) => {
        settleCleanup = resolve;
      })
    );

    const stateKey = '_@local:example.org_LOCAL_m.call';
    const publishing = driver.sendEvent(
      'org.matrix.msc3401.call.member',
      { application: 'm.call' },
      stateKey
    );
    await flushMicrotasks();
    expect(sendStateEvent).not.toHaveBeenCalled();

    settleCleanup();
    await expect(publishing).resolves.toEqual({ roomId, eventId: '$published' });
    expect(sendStateEvent).toHaveBeenCalledWith(
      roomId,
      'org.matrix.msc3401.call.member',
      { application: 'm.call' },
      stateKey
    );
  });

  it('publishes past the bounded gate when a predecessor cleanup write never settles', async () => {
    // A blackholed cleanup request has no local timeout in this client
    // configuration; the successor call's join must still reach a bounded
    // outcome instead of silently never publishing membership.
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const roomId = '!driver-bounded:example.org';
      const { driver, sendStateEvent } = makeStateDriver(roomId);
      trackRoomCallMembershipWrite(
        roomId,
        new Promise<void>(() => {
          // never settles
        })
      );

      const stateKey = '_@local:example.org_LOCAL_m.call';
      const publishing = driver.sendEvent(
        'org.matrix.msc3401.call.member',
        { application: 'm.call' },
        stateKey
      );
      await vi.advanceTimersByTimeAsync(CALL_MEMBERSHIP_WRITES_SETTLE_TIMEOUT_MS - 1);
      expect(sendStateEvent).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await expect(publishing).resolves.toEqual({ roomId, eventId: '$published' });
      expect(sendStateEvent).toHaveBeenCalledWith(
        roomId,
        'org.matrix.msc3401.call.member',
        { application: 'm.call' },
        stateKey
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('did not settle');
    } finally {
      warn.mockRestore();
    }
  });

  it('refuses to publish membership when the driver was disposed while gated', async () => {
    // Ending or replacing the embed while its publish waits at the gate must
    // not let the suspended continuation recreate ghost membership or
    // overwrite a newer same-room call after disposal.
    const roomId = '!driver-disposed-gated:example.org';
    const { driver, sendStateEvent } = makeStateDriver(roomId);
    let settleCleanup!: () => void;
    trackRoomCallMembershipWrite(
      roomId,
      new Promise<void>((resolve) => {
        settleCleanup = resolve;
      })
    );

    const publishing = driver.sendEvent(
      'org.matrix.msc3401.call.member',
      { application: 'm.call' },
      '_@local:example.org_LOCAL_m.call'
    );
    const rejection = expect(publishing).rejects.toThrow('disposed');
    await flushMicrotasks();
    driver.dispose();
    settleCleanup();
    await rejection;

    expect(sendStateEvent).not.toHaveBeenCalled();
  });

  it('refuses a membership publish outright on an already-disposed driver', async () => {
    const roomId = '!driver-predisposed:example.org';
    const { driver, sendStateEvent } = makeStateDriver(roomId);
    trackRoomCallMembershipWrite(
      roomId,
      new Promise<void>(() => {
        // never settles: the pre-gate check must not even start waiting
      })
    );
    driver.dispose();

    await expect(
      driver.sendEvent(
        'org.matrix.msc3401.call.member',
        { application: 'm.call' },
        '_@local:example.org_LOCAL_m.call'
      )
    ).rejects.toThrow('disposed');
    expect(sendStateEvent).not.toHaveBeenCalled();
  });

  it('tracks a dispatched membership publish until it settles', async () => {
    // Element Call's join/renewal PUTs cannot be aborted after disposal;
    // the terminal residual scrub must be able to drain them before its
    // read, or one can land after it and resurrect membership with no
    // iframe left (review A2, round 4).
    const roomId = '!driver-tracked:example.org';
    const { driver, sendStateEvent } = makeStateDriver(roomId);
    let landPublish!: (value: { event_id: string }) => void;
    sendStateEvent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          landPublish = resolve;
        })
    );

    const publishing = driver.sendEvent(
      'org.matrix.msc3401.call.member',
      { application: 'm.call' },
      '_@local:example.org_LOCAL_m.call'
    );
    await flushMicrotasks();
    expect(sendStateEvent).toHaveBeenCalledTimes(1);

    let drained = false;
    const drain = roomCallMembershipWritesSettled(roomId).then(() => {
      drained = true;
    });
    await flushMicrotasks();
    expect(drained).toBe(false);

    landPublish({ event_id: '$landed' });
    await publishing;
    await drain;
    expect(drained).toBe(true);
  });

  it('a later publish does not re-pay the bound on an entry an expired gate abandoned', async () => {
    // One blackholed write must tax the room's publishes once, not forever
    // (review A3, round 4).
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const roomId = '!driver-evict:example.org';
      const { driver, sendStateEvent } = makeStateDriver(roomId);
      trackRoomCallMembershipWrite(
        roomId,
        new Promise<void>(() => {
          // never settles
        })
      );

      const stateKey = '_@local:example.org_LOCAL_m.call';
      const first = driver.sendEvent(
        'org.matrix.msc3401.call.member',
        { application: 'm.call' },
        stateKey
      );
      await vi.advanceTimersByTimeAsync(CALL_MEMBERSHIP_WRITES_SETTLE_TIMEOUT_MS);
      await first;
      expect(sendStateEvent).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);

      // The expired gate evicted the abandoned entry: the next publish
      // dispatches without waiting out the bound again.
      await driver.sendEvent('org.matrix.msc3401.call.member', { application: 'm.call' }, stateKey);
      expect(sendStateEvent).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not gate non-membership state events behind cleanup writes', async () => {
    const roomId = '!driver-ungated:example.org';
    const { driver, sendStateEvent } = makeStateDriver(roomId);
    trackRoomCallMembershipWrite(
      roomId,
      new Promise<void>(() => {
        // never settles: an unrelated state event must not wait for it
      })
    );

    await driver.sendEvent('m.room.name', { name: 'renamed' }, '');
    expect(sendStateEvent).toHaveBeenCalledWith(roomId, 'm.room.name', { name: 'renamed' }, '');
  });
});
