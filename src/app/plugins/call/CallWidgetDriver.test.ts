import { type MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallWidgetDriver } from './CallWidgetDriver';

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
  const getUserDeviceInfo = vi.fn().mockResolvedValue(new Map());
  const queueToDevice = vi.fn().mockResolvedValue(undefined);
  const mx = {
    getDeviceId: () => 'LOCAL',
    getSafeUserId: () => '@local:example.org',
    getCrypto: () => ({ encryptToDeviceMessages, getUserDeviceInfo }),
    queueToDevice,
  } as unknown as MatrixClient;

  return {
    driver: new CallWidgetDriver(mx, '!room:example.org'),
    encryptToDeviceMessages,
    getUserDeviceInfo,
    queueToDevice,
  };
};

describe('CallWidgetDriver.sendToDevice', () => {
  afterEach(() => {
    vi.useRealTimers();
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
