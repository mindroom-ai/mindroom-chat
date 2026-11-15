import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { sendCallKey, type CallKeyDelivery } from './callKeyProvider';

const agent = { userId: '@agent:test', deviceId: 'AGENTDEVICE' };

const delivery: CallKeyDelivery = {
  roomId: '!call:test',
  key: new Uint8Array([1, 2, 3]),
  keyIndex: 4,
  memberId: '@me:test:MYDEVICE',
  to: agent,
};

/** What `encryptToDeviceMessages` returns when the crypto knows the device, or does not. */
const batchFor = (known: boolean) => ({
  eventType: 'm.room.encrypted',
  batch: known ? [{ ...agent, payload: { ciphertext: 'olm' } }] : [],
});

/** A client whose crypto knows the agent's device on the given encryption attempts. */
const clientKnowing = (...known: boolean[]) => {
  const encryptToDeviceMessages = vi.fn(async () => batchFor(known.shift() ?? false));
  const getUserDeviceInfo = vi.fn(async () => new Map());
  const sendToDevice = vi.fn(async () => ({}));
  const mx = {
    getCrypto: () => ({ encryptToDeviceMessages, getUserDeviceInfo }),
    getDeviceId: () => 'MYDEVICE',
    sendToDevice,
  } as unknown as MatrixClient;
  return { mx, encryptToDeviceMessages, getUserDeviceInfo, sendToDevice };
};

const sentContent = new Map([[agent.userId, new Map([[agent.deviceId, { ciphertext: 'olm' }]])]]);

describe('sendCallKey', () => {
  it('sends the key encrypted for the device straight to the server', async () => {
    const { mx, encryptToDeviceMessages, getUserDeviceInfo, sendToDevice } = clientKnowing(true);

    await sendCallKey(mx, delivery);

    expect(encryptToDeviceMessages).toHaveBeenCalledWith(
      'io.element.call.encryption_keys',
      [agent],
      expect.objectContaining({
        keys: { index: 4, key: 'AQID' },
        room_id: '!call:test',
        member: { claimed_device_id: 'MYDEVICE', id: '@me:test:MYDEVICE' },
      })
    );
    expect(getUserDeviceInfo).not.toHaveBeenCalled();
    expect(sendToDevice).toHaveBeenCalledWith('m.room.encrypted', sentContent);
  });

  it('fetches the device list of a device the crypto does not know, then sends', async () => {
    const { mx, getUserDeviceInfo, sendToDevice } = clientKnowing(false, true);

    await sendCallKey(mx, delivery);

    expect(getUserDeviceInfo).toHaveBeenCalledWith([agent.userId], true);
    expect(sendToDevice).toHaveBeenCalledWith('m.room.encrypted', sentContent);
  });

  it('rejects, instead of sending nothing, when the device stays unknown', async () => {
    const { mx, sendToDevice } = clientKnowing(false, false);

    await expect(sendCallKey(mx, delivery)).rejects.toThrow('AGENTDEVICE');
    expect(sendToDevice).not.toHaveBeenCalled();
  });

  it('sends nothing when the batch holds only another device of the user', async () => {
    const { mx, encryptToDeviceMessages, getUserDeviceInfo, sendToDevice } = clientKnowing();
    encryptToDeviceMessages.mockResolvedValue({
      eventType: 'm.room.encrypted',
      batch: [{ userId: agent.userId, deviceId: 'OTHERDEVICE', payload: { ciphertext: 'olm' } }],
    });

    await expect(sendCallKey(mx, delivery)).rejects.toThrow('AGENTDEVICE');
    expect(getUserDeviceInfo).toHaveBeenCalledTimes(1);
    expect(sendToDevice).not.toHaveBeenCalled();
  });

  it('rejects when the server refuses the send', async () => {
    const { mx, sendToDevice } = clientKnowing(true);
    sendToDevice.mockRejectedValueOnce(new Error('M_LIMIT_EXCEEDED'));

    await expect(sendCallKey(mx, delivery)).rejects.toThrow('M_LIMIT_EXCEEDED');
  });
});
