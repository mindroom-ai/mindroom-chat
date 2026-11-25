import { ClientEvent, type MatrixClient, type ReceivedToDeviceMessage } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_DISCONNECT_CONFIRMED_EVENT,
  DESKTOP_DISCONNECT_REQUEST_EVENT,
  DESKTOP_PAIRING_CONFIRMED_EVENT,
  DESKTOP_PAIRING_CONFIRM_EVENT,
  DESKTOP_SETUP_OFFER_EVENT,
  DESKTOP_SETUP_REQUEST_EVENT,
} from './desktopPairingProtocol';
import {
  confirmAgentPairing,
  disconnectAgentPairing,
  requestAgentSetupOffer,
  sendEncryptedToSingleDevice,
} from './desktopOlmTransport';

type MockDevice = {
  userId: string;
  deviceId: string;
  curveKey: string;
  ed25519: string;
  signedByOwner: boolean;
};

type QueuedPacket = {
  eventType: string;
  targetUserId: string;
  targetDeviceId: string;
  payload: Record<string, unknown>;
};

const createMockMatrix = (devices: MockDevice[]) => {
  const listeners = new Map<string, Set<(payload: ReceivedToDeviceMessage) => void>>();
  const sent: QueuedPacket[] = [];
  let encryptEventType = 'm.room.encrypted';

  const onSentHandlers: Array<(packet: QueuedPacket) => void> = [];

  const crypto = {
    getUserDeviceInfo: vi.fn(async (users: string[]) => {
      const result = new Map<string, Map<string, unknown>>();
      for (const userId of users) {
        const map = new Map<string, unknown>();
        for (const d of devices.filter((entry) => entry.userId === userId)) {
          map.set(d.deviceId, {
            getIdentityKey: () => d.curveKey,
            getFingerprint: () => d.ed25519,
          });
        }
        result.set(userId, map);
      }
      return result;
    }),
    getDeviceVerificationStatus: vi.fn(async (userId: string, deviceId: string) => {
      const found = devices.find((d) => d.userId === userId && d.deviceId === deviceId);
      return found ? { signedByOwner: found.signedByOwner } : null;
    }),
    encryptToDeviceMessages: vi.fn(
      async (
        eventType: string,
        targets: Array<{ userId: string; deviceId: string }>,
        content: Record<string, unknown>
      ) => ({
        eventType: encryptEventType,
        batch: targets.map((t) => ({
          userId: t.userId,
          deviceId: t.deviceId,
          payload: { __innerType: eventType, __innerContent: content },
        })),
      })
    ),
  };

  const mx = {
    getUserId: () => '@bas:mindroom.chat',
    getDeviceId: () => 'CHAT_DEV',
    getCrypto: () => crypto,
    on: vi.fn((event: string, listener: (payload: ReceivedToDeviceMessage) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    }),
    removeListener: vi.fn((event: string, listener: (payload: ReceivedToDeviceMessage) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    queueToDevice: vi.fn(
      async (req: {
        eventType: string;
        batch: Array<{
          userId: string;
          deviceId: string;
          payload: { __innerType: string; __innerContent: Record<string, unknown> };
        }>;
      }) => {
        for (const item of req.batch) {
          const packet: QueuedPacket = {
            eventType: item.payload.__innerType,
            targetUserId: item.userId,
            targetDeviceId: item.deviceId,
            payload: item.payload.__innerContent,
          };
          sent.push(packet);
          onSentHandlers.forEach((fn) => fn(packet));
        }
      }
    ),
  } as unknown as MatrixClient;

  const emitToDevice = (payload: ReceivedToDeviceMessage) => {
    for (const listener of [...(listeners.get(ClientEvent.ReceivedToDeviceMessage) ?? [])]) {
      listener(payload);
    }
  };

  const onSent = (fn: (packet: QueuedPacket) => void) => {
    onSentHandlers.push(fn);
  };

  return {
    mx,
    crypto,
    sent,
    emitToDevice,
    onSent,
    listenerCount: () => listeners.get(ClientEvent.ReceivedToDeviceMessage)?.size ?? 0,
    setEncryptEventType: (t: string) => {
      encryptEventType = t;
    },
  };
};

const AGENT_USER = '@mindroom_general:mindroom.chat';
const AGENT_DEVICE: MockDevice = {
  userId: AGENT_USER,
  deviceId: 'AGENT_DEV_1',
  curveKey: 'curve-agent-1',
  ed25519: 'ed25519-agent-1',
  signedByOwner: true,
};
const UNSIGNED_AGENT_DEVICE: MockDevice = {
  userId: AGENT_USER,
  deviceId: 'AGENT_UNSIGNED',
  curveKey: 'curve-unsigned',
  ed25519: 'ed25519-unsigned',
  signedByOwner: false,
};
const OTHER_USER_DEVICE: MockDevice = {
  userId: '@attacker:evil.example',
  deviceId: 'EVIL_DEV',
  curveKey: 'curve-evil',
  ed25519: 'ed25519-evil',
  signedByOwner: true,
};

describe('desktopOlmTransport', () => {
  it('requests setup offer over Olm and resolves verified controller identity', async () => {
    const env = createMockMatrix([AGENT_DEVICE]);
    env.onSent((packet) => {
      if (packet.eventType !== DESKTOP_SETUP_REQUEST_EVENT) return;
      const nonce = packet.payload.nonce as string;
      env.emitToDevice({
        message: {
          type: DESKTOP_SETUP_OFFER_EVENT,
          sender: AGENT_USER,
          content: {
            v: 1,
            nonce,
            agent_name: 'general',
            eligible: true,
            homeserver: 'https://mindroom.chat',
            user_id: '@bas:mindroom.chat',
            code: 'offer-token-1',
            cloudflare_access: false,
          },
        },
        encryptionInfo: {
          sender: AGENT_USER,
          senderDevice: AGENT_DEVICE.deviceId,
          senderCurve25519KeyBase64: AGENT_DEVICE.curveKey,
          senderVerified: false,
        },
      });
    });

    const result = await requestAgentSetupOffer(env.mx, AGENT_USER, 'general');

    expect(env.sent).toHaveLength(1);
    expect(env.sent[0]?.eventType).toBe(DESKTOP_SETUP_REQUEST_EVENT);
    expect(env.sent[0]?.payload).toMatchObject({ v: 1, agent_name: 'general' });
    expect(result).toEqual({
      offer: {
        v: 1,
        nonce: env.sent[0]?.payload.nonce,
        agent_name: 'general',
        eligible: true,
        homeserver: 'https://mindroom.chat',
        user_id: '@bas:mindroom.chat',
        code: 'offer-token-1',
        cloudflare_access: false,
        error: null,
      },
      controller: {
        user_id: AGENT_USER,
        device_id: AGENT_DEVICE.deviceId,
        ed25519: AGENT_DEVICE.ed25519,
      },
    });
    expect(env.listenerCount()).toBe(0);
  });

  it('ignores unencrypted, spoofed-sender, wrong-nonce, unknown-key, and unsigned setup offers', async () => {
    const env = createMockMatrix([AGENT_DEVICE, UNSIGNED_AGENT_DEVICE, OTHER_USER_DEVICE]);
    env.onSent((packet) => {
      if (packet.eventType !== DESKTOP_SETUP_REQUEST_EVENT) return;
      const nonce = packet.payload.nonce as string;
      const fakeOffer = (code: string, offerNonce = nonce) => ({
        v: 1,
        nonce: offerNonce,
        agent_name: 'general',
        eligible: true,
        homeserver: 'https://mindroom.chat',
        user_id: '@bas:mindroom.chat',
        code,
        cloudflare_access: false,
      });

      // 1. Unencrypted
      env.emitToDevice({
        message: {
          type: DESKTOP_SETUP_OFFER_EVENT,
          sender: AGENT_USER,
          content: fakeOffer('bad-1'),
        },
        encryptionInfo: null,
      });
      // 2. Spoofed encryptionInfo.sender
      env.emitToDevice({
        message: {
          type: DESKTOP_SETUP_OFFER_EVENT,
          sender: AGENT_USER,
          content: fakeOffer('bad-2'),
        },
        encryptionInfo: {
          sender: OTHER_USER_DEVICE.userId,
          senderCurve25519KeyBase64: OTHER_USER_DEVICE.curveKey,
          senderVerified: false,
        },
      });
      // 3. Mismatched nonce
      env.emitToDevice({
        message: {
          type: DESKTOP_SETUP_OFFER_EVENT,
          sender: AGENT_USER,
          content: fakeOffer('bad-3', '00000000000000000000000000000000'),
        },
        encryptionInfo: {
          sender: AGENT_USER,
          senderCurve25519KeyBase64: AGENT_DEVICE.curveKey,
          senderVerified: false,
        },
      });
      // 4. Unsigned agent device
      env.emitToDevice({
        message: {
          type: DESKTOP_SETUP_OFFER_EVENT,
          sender: AGENT_USER,
          content: fakeOffer('bad-4'),
        },
        encryptionInfo: {
          sender: AGENT_USER,
          senderCurve25519KeyBase64: UNSIGNED_AGENT_DEVICE.curveKey,
          senderVerified: false,
        },
      });
      // 5. Unknown curve key
      env.emitToDevice({
        message: {
          type: DESKTOP_SETUP_OFFER_EVENT,
          sender: AGENT_USER,
          content: fakeOffer('bad-5'),
        },
        encryptionInfo: {
          sender: AGENT_USER,
          senderCurve25519KeyBase64: 'curve-unknown',
          senderVerified: false,
        },
      });
      // 6. Genuine reply arrives after all spoofed attempts
      setTimeout(() => {
        env.emitToDevice({
          message: {
            type: DESKTOP_SETUP_OFFER_EVENT,
            sender: AGENT_USER,
            content: fakeOffer('good-code'),
          },
          encryptionInfo: {
            sender: AGENT_USER,
            senderDevice: AGENT_DEVICE.deviceId,
            senderCurve25519KeyBase64: AGENT_DEVICE.curveKey,
            senderVerified: false,
          },
        });
      }, 5);
    });

    const result = await requestAgentSetupOffer(env.mx, AGENT_USER, 'general', undefined, 500);
    expect(result.offer.eligible).toBe(true);
    if (result.offer.eligible) {
      expect(result.offer.code).toBe('good-code');
    }
    expect(result.controller.device_id).toBe(AGENT_DEVICE.deviceId);
  });

  it('pins confirmAgentPairing to the authenticated controller device and rejects other devices', async () => {
    const secondSignedDevice: MockDevice = {
      userId: AGENT_USER,
      deviceId: 'AGENT_DEV_2',
      curveKey: 'curve-agent-2',
      ed25519: 'ed25519-agent-2',
      signedByOwner: true,
    };
    const env = createMockMatrix([AGENT_DEVICE, secondSignedDevice]);

    env.onSent((packet) => {
      if (packet.eventType !== DESKTOP_PAIRING_CONFIRM_EVENT) return;
      const nonce = packet.payload.nonce as string;
      // Reply from a DIFFERENT signed device of the same agent must be ignored.
      env.emitToDevice({
        message: {
          type: DESKTOP_PAIRING_CONFIRMED_EVENT,
          sender: AGENT_USER,
          content: { v: 1, nonce, agent_name: 'general', ok: false, error: 'wrong device' },
        },
        encryptionInfo: {
          sender: AGENT_USER,
          senderDevice: secondSignedDevice.deviceId,
          senderCurve25519KeyBase64: secondSignedDevice.curveKey,
          senderVerified: false,
        },
      });
      // Genuine reply from pinned AGENT_DEVICE.
      setTimeout(() => {
        env.emitToDevice({
          message: {
            type: DESKTOP_PAIRING_CONFIRMED_EVENT,
            sender: AGENT_USER,
            content: { v: 1, nonce, agent_name: 'general', ok: true },
          },
          encryptionInfo: {
            sender: AGENT_USER,
            senderDevice: AGENT_DEVICE.deviceId,
            senderCurve25519KeyBase64: AGENT_DEVICE.curveKey,
            senderVerified: false,
          },
        });
      }, 5);
    });

    const confirmed = await confirmAgentPairing(
      env.mx,
      {
        user_id: AGENT_USER,
        device_id: AGENT_DEVICE.deviceId,
        ed25519: AGENT_DEVICE.ed25519,
      },
      {
        token: 'offer-token-1',
        verification: 'ABCD1234EFGH5678',
        deviceId: 'HELPER_DEV',
        deviceEd25519: 'helper-ed',
      },
      undefined,
      500
    );

    expect(confirmed).toEqual({
      v: 1,
      nonce: env.sent[0]?.payload.nonce,
      agent_name: 'general',
      ok: true,
      error: null,
    });
    expect(env.sent).toHaveLength(1);
    expect(env.sent[0]?.targetDeviceId).toBe(AGENT_DEVICE.deviceId);
    expect(env.sent[0]?.payload).toMatchObject({
      v: 1,
      token: 'offer-token-1',
      verification: 'ABCD1234EFGH5678',
      device_id: 'HELPER_DEV',
      device_ed25519: 'helper-ed',
    });
  });

  it('sends disconnect_request.v1 and resolves verified disconnect_confirmed.v1', async () => {
    const env = createMockMatrix([AGENT_DEVICE]);
    env.onSent((packet) => {
      if (packet.eventType !== DESKTOP_DISCONNECT_REQUEST_EVENT) return;
      const nonce = packet.payload.nonce as string;
      env.emitToDevice({
        message: {
          type: DESKTOP_DISCONNECT_CONFIRMED_EVENT,
          sender: AGENT_USER,
          content: { v: 1, nonce, agent_name: 'general', ok: true },
        },
        encryptionInfo: {
          sender: AGENT_USER,
          senderDevice: AGENT_DEVICE.deviceId,
          senderCurve25519KeyBase64: AGENT_DEVICE.curveKey,
          senderVerified: false,
        },
      });
    });

    const result = await disconnectAgentPairing(env.mx, AGENT_USER, 'general', undefined, 500);
    expect(result).toMatchObject({ ok: true, agent_name: 'general' });
  });

  it('refuses sendEncryptedToSingleDevice for unsigned, key-mismatched, or plaintext targets', async () => {
    const env = createMockMatrix([AGENT_DEVICE, UNSIGNED_AGENT_DEVICE]);

    await expect(
      sendEncryptedToSingleDevice(
        env.mx,
        'io.mindroom.desktop.test',
        { userId: AGENT_USER, deviceId: UNSIGNED_AGENT_DEVICE.deviceId },
        { v: 1 }
      )
    ).rejects.toThrow(/signed|trusted/i);

    await expect(
      sendEncryptedToSingleDevice(
        env.mx,
        'io.mindroom.desktop.test',
        { userId: AGENT_USER, deviceId: AGENT_DEVICE.deviceId, ed25519: 'wrong-ed25519' },
        { v: 1 }
      )
    ).rejects.toThrow(/key|fingerprint/i);

    env.setEncryptEventType('io.mindroom.desktop.test');
    await expect(
      sendEncryptedToSingleDevice(
        env.mx,
        'io.mindroom.desktop.test',
        { userId: AGENT_USER, deviceId: AGENT_DEVICE.deviceId },
        { v: 1 }
      )
    ).rejects.toThrow(/encrypt/i);
    expect(env.sent).toHaveLength(0);
  });

  it('aborts cleanly and removes listener on signal abort', async () => {
    const env = createMockMatrix([AGENT_DEVICE]);
    const ac = new AbortController();
    const promise = requestAgentSetupOffer(env.mx, AGENT_USER, 'general', ac.signal, 5_000);
    ac.abort();
    await expect(promise).rejects.toThrow(/abort/i);
    expect(env.listenerCount()).toBe(0);
  });

  it('retries setup_request.v1 once with authoritative offer.agent_name for namespaced MindRoom agents', async () => {
    const namespacedUser = '@mindroom_writer_ab12:example.test';
    const namespacedDevice: MockDevice = {
      userId: namespacedUser,
      deviceId: 'WRITER_DEV_1',
      curveKey: 'curve-writer-1',
      ed25519: 'ed25519-writer-1',
      signedByOwner: true,
    };
    const env = createMockMatrix([namespacedDevice]);

    env.onSent((packet) => {
      if (packet.eventType !== DESKTOP_SETUP_REQUEST_EVENT) return;
      const nonce = packet.payload.nonce as string;
      const requested = packet.payload.agent_name as string;
      if (requested === 'writer_ab12') {
        env.emitToDevice({
          message: {
            type: DESKTOP_SETUP_OFFER_EVENT,
            sender: namespacedUser,
            content: {
              v: 1,
              nonce,
              agent_name: 'writer',
              eligible: false,
              homeserver: null,
              user_id: null,
              code: null,
              cloudflare_access: false,
              error: 'Requested agent name writer_ab12 does not match writer.',
            },
          },
          encryptionInfo: {
            sender: namespacedUser,
            senderDevice: namespacedDevice.deviceId,
            senderCurve25519KeyBase64: namespacedDevice.curveKey,
            senderVerified: false,
          },
        });
        return;
      }
      if (requested === 'writer') {
        env.emitToDevice({
          message: {
            type: DESKTOP_SETUP_OFFER_EVENT,
            sender: namespacedUser,
            content: {
              v: 1,
              nonce,
              agent_name: 'writer',
              eligible: true,
              homeserver: 'https://example.test',
              user_id: '@bas:mindroom.chat',
              code: 'namespaced-code-1',
              cloudflare_access: false,
            },
          },
          encryptionInfo: {
            sender: namespacedUser,
            senderDevice: namespacedDevice.deviceId,
            senderCurve25519KeyBase64: namespacedDevice.curveKey,
            senderVerified: false,
          },
        });
      }
    });

    const result = await requestAgentSetupOffer(env.mx, namespacedUser, 'writer_ab12', undefined, 500);
    expect(env.sent).toHaveLength(2);
    expect(env.sent.map((p) => p.payload.agent_name)).toEqual(['writer_ab12', 'writer']);
    expect(result.offer).toMatchObject({
      eligible: true,
      agent_name: 'writer',
      code: 'namespaced-code-1',
    });
    expect(result.controller).toEqual({
      user_id: namespacedUser,
      device_id: namespacedDevice.deviceId,
      ed25519: namespacedDevice.ed25519,
    });

    // Unrelated agent_name (not a namespace prefix) must NOT trigger a retry.
    const unrelatedEnv = createMockMatrix([namespacedDevice]);
    unrelatedEnv.onSent((packet) => {
      if (packet.eventType !== DESKTOP_SETUP_REQUEST_EVENT) return;
      unrelatedEnv.emitToDevice({
        message: {
          type: DESKTOP_SETUP_OFFER_EVENT,
          sender: namespacedUser,
          content: {
            v: 1,
            nonce: packet.payload.nonce as string,
            agent_name: 'other',
            eligible: false,
            homeserver: null,
            user_id: null,
            code: null,
            cloudflare_access: false,
            error: 'Wrong agent.',
          },
        },
        encryptionInfo: {
          sender: namespacedUser,
          senderDevice: namespacedDevice.deviceId,
          senderCurve25519KeyBase64: namespacedDevice.curveKey,
          senderVerified: false,
        },
      });
    });

    const noRetry = await requestAgentSetupOffer(
      unrelatedEnv.mx,
      namespacedUser,
      'writer_ab12',
      undefined,
      500
    );
    expect(unrelatedEnv.sent).toHaveLength(1);
    expect(noRetry.offer.eligible).toBe(false);
  });
});
