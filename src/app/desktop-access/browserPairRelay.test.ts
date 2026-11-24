// @vitest-environment jsdom
import { createElement } from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import {
  ClientEvent,
  type AuthDict,
  type MatrixClient,
  type MatrixEvent,
  type ReceivedToDeviceMessage,
} from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopAccessBridge,
  DesktopAccessSnapshot,
  DesktopBridge,
} from '../lib/desktopBridge';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import {
  DESKTOP_MAC_DEVICES_ACCOUNT_DATA,
  DESKTOP_PAIRING_CONFIRMED_EVENT,
  DESKTOP_PAIRING_CONFIRM_EVENT,
  DESKTOP_PAIR_INVITE_CONFIRMED_EVENT,
  DESKTOP_PAIR_INVITE_EVENT,
  DESKTOP_PAIR_INVITE_RESULT_EVENT,
  DESKTOP_SETUP_OFFER_EVENT,
  DESKTOP_SETUP_REQUEST_EVENT,
  derivePairInviteSas,
} from './desktopPairingProtocol';
import {
  registerThisMacDevice,
  relayPairToMac,
  useRegisteredMacDevices,
  type RelayPairState,
} from './browserPairRelay';
import {
  DesktopMacRelayFeature,
  approveIncomingPairInvite,
  declineIncomingPairInvite,
  incomingPairInviteAtom,
} from './macPairInvite';

const bridgeState = vi.hoisted(() => ({ current: undefined as DesktopBridge | undefined }));

vi.mock('../lib/nativeShell', () => ({
  desktopBridge: () => bridgeState.current,
  isDesktopAccessAvailable: () => Boolean(bridgeState.current?.desktopAccess),
}));

type DeviceSpec = {
  userId: string;
  deviceId: string;
  curveKey: string;
  ed25519: string;
  signedByOwner: boolean;
};

const USER_ID = '@bas:mindroom.chat';
const AGENT_USER = '@mindroom_general:mindroom.chat';
const MAC_DEVICE: DeviceSpec = {
  userId: USER_ID,
  deviceId: 'MAC_DEV',
  curveKey: 'curve-mac',
  ed25519: 'ed-mac',
  signedByOwner: true,
};
const BROWSER_DEVICE: DeviceSpec = {
  userId: USER_ID,
  deviceId: 'BROWSER_DEV',
  curveKey: 'curve-browser',
  ed25519: 'ed-browser',
  signedByOwner: true,
};
const UNSIGNED_BROWSER: DeviceSpec = {
  userId: USER_ID,
  deviceId: 'UNSIGNED_DEV',
  curveKey: 'curve-unsigned',
  ed25519: 'ed-unsigned',
  signedByOwner: false,
};
const AGENT_DEVICE: DeviceSpec = {
  userId: AGENT_USER,
  deviceId: 'AGENT_DEV',
  curveKey: 'curve-agent',
  ed25519: 'ed-agent',
  signedByOwner: true,
};

type BusNode = {
  spec: DeviceSpec;
  mx: MatrixClient;
  emitToDevice: (payload: ReceivedToDeviceMessage) => void;
  setAccountDataLocal: (type: string, content: Record<string, unknown>) => void;
  setAccountDataMock: ReturnType<typeof vi.fn>;
  listenerCount: () => number;
};

/** In-memory Olm to-device router connecting multiple signed-in Matrix devices and an agent. */
const createRelayNetwork = (devices: DeviceSpec[]) => {
  const accountData = new Map<string, Record<string, unknown>>();
  const nodes = new Map<string, BusNode>();

  const makeNode = (self: DeviceSpec): BusNode => {
    const toDeviceListeners = new Set<(payload: ReceivedToDeviceMessage) => void>();
    const accountDataListeners = new Set<(event: MatrixEvent) => void>();

    const setAccountDataMock = vi.fn(async (type: string, content: Record<string, unknown>) => {
      accountData.set(type, content);
      const event = { getType: () => type, getContent: () => content } as unknown as MatrixEvent;
      for (const node of nodes.values()) {
        if (node.spec.userId === self.userId) {
          node.setAccountDataLocal(type, content);
        }
      }
      void event;
    });

    const emitToDevice = (payload: ReceivedToDeviceMessage) => {
      for (const fn of [...toDeviceListeners]) fn(payload);
    };

    const setAccountDataLocal = (type: string, content: Record<string, unknown>) => {
      accountData.set(type, content);
      const event = { getType: () => type, getContent: () => content } as unknown as MatrixEvent;
      for (const fn of [...accountDataListeners]) fn(event);
    };

    const crypto = {
      getUserDeviceInfo: vi.fn(async (users: string[]) => {
        const result = new Map<string, Map<string, unknown>>();
        for (const uid of users) {
          const map = new Map<string, unknown>();
          for (const d of devices.filter((entry) => entry.userId === uid)) {
            map.set(d.deviceId, {
              getIdentityKey: () => d.curveKey,
              getFingerprint: () => d.ed25519,
            });
          }
          result.set(uid, map);
        }
        return result;
      }),
      getDeviceVerificationStatus: vi.fn(async (uid: string, did: string) => {
        const found = devices.find((d) => d.userId === uid && d.deviceId === did);
        return found ? { signedByOwner: found.signedByOwner } : null;
      }),
      encryptToDeviceMessages: vi.fn(
        async (
          eventType: string,
          targets: Array<{ userId: string; deviceId: string }>,
          content: Record<string, unknown>
        ) => ({
          eventType: 'm.room.encrypted',
          batch: targets.map((t) => ({
            userId: t.userId,
            deviceId: t.deviceId,
            payload: { __type: eventType, __content: content },
          })),
        })
      ),
    };

    const mx = {
      getUserId: () => self.userId,
      getDeviceId: () => self.deviceId,
      getHomeserverUrl: () => 'https://mindroom.chat',
      getCrypto: () => crypto,
      getAccountData: (type: string) => {
        const content = accountData.get(type);
        return content
          ? ({ getType: () => type, getContent: () => content } as MatrixEvent)
          : undefined;
      },
      setAccountData: setAccountDataMock,
      on: vi.fn((event: ClientEvent, listener: (...args: any[]) => void) => {
        if (event === ClientEvent.ReceivedToDeviceMessage) toDeviceListeners.add(listener);
        if (event === ClientEvent.AccountData) accountDataListeners.add(listener);
      }),
      off: vi.fn((event: ClientEvent, listener: (...args: any[]) => void) => {
        if (event === ClientEvent.ReceivedToDeviceMessage) toDeviceListeners.delete(listener);
        if (event === ClientEvent.AccountData) accountDataListeners.delete(listener);
      }),
      removeListener: vi.fn((event: ClientEvent, listener: (...args: any[]) => void) => {
        if (event === ClientEvent.ReceivedToDeviceMessage) toDeviceListeners.delete(listener);
        if (event === ClientEvent.AccountData) accountDataListeners.delete(listener);
      }),
      queueToDevice: vi.fn(
        async (req: {
          batch: Array<{
            userId: string;
            deviceId: string;
            payload: { __type: string; __content: Record<string, unknown> };
          }>;
        }) => {
          for (const item of req.batch) {
            const target = nodes.get(`${item.userId}:${item.deviceId}`);
            if (!target) continue;
            queueMicrotask(() => {
              target.emitToDevice({
                message: {
                  type: item.payload.__type,
                  sender: self.userId,
                  content: item.payload.__content,
                },
                encryptionInfo: {
                  sender: self.userId,
                  senderDevice: self.deviceId,
                  senderCurve25519KeyBase64: self.curveKey,
                  senderVerified: false,
                },
              });
            });
          }
        }
      ),
    } as unknown as MatrixClient;

    const node: BusNode = {
      spec: self,
      mx,
      emitToDevice,
      setAccountDataLocal,
      setAccountDataMock,
      listenerCount: () => toDeviceListeners.size,
    };
    nodes.set(`${self.userId}:${self.deviceId}`, node);
    return node;
  };

  return { makeNode, accountData };
};

const makeReadySnapshot = (): DesktopAccessSnapshot => ({
  availability: 'available',
  helperRunning: true,
  helperError: null,
  status: {
    config: {
      state: 'ready',
      revision: 1,
      enabled: true,
      controllers: [],
      allowed_app_ids: ['primary-screen'],
      file_roots: [],
      shell_enabled: true,
    },
    pairing: {
      state: 'paired',
      session_state: 'ready',
      homeserver: 'https://mindroom.chat',
      user_id: USER_ID,
      device_id: 'HELPER_DEV',
    },
    helper: { state: 'running', version: '1.0.0' },
    bridge: { state: 'control', active_action: null, last_error: null },
    authority: {
      control_available: true,
      lease_remaining_seconds: 0,
      control_scope: 'computer',
      controllers: {},
    },
    permissions: {
      accessibility: 'granted',
      screen_recording: 'granted',
      gui_permissions_ready: true,
    },
    shell: {
      enabled: true,
      ready: true,
      pending: null,
      auto_approve_remaining_seconds: 0,
      auto_approve_until_revoked: true,
      active_request_id: null,
      handles: [],
      controllers: {},
    },
  },
  consent: {},
  permissions: {
    accessibility: 'granted',
    screen_recording: 'granted',
    gui_permissions_ready: true,
  },
  relaunchRequired: false,
});

const installMacBridge = () => {
  const snapshot = makeReadySnapshot();
  const showMainWindow = vi.fn(async () => ({ ok: true as const, value: undefined }));
  const desktopAccess: DesktopAccessBridge = {
    status: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    login: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    pair: vi.fn(async () => ({
      ok: true as const,
      value: {
        controllerKey: '["@mindroom_general:mindroom.chat", "AGENT_DEV", "ed-agent"]',
        deviceId: 'HELPER_DEV',
        deviceEd25519: 'ed-helper',
        verification: 'ABCD1234EFGH5678',
        confirmationCommand: '!desktop confirm',
        snapshot,
      },
    })),
    finishSetup: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    updateLimits: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    removeController: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    revokeAll: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    requestPermission: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    relaunch: vi.fn(async () => ({ ok: true as const, value: undefined })),
    listInstalledApps: vi.fn(async () => ({ ok: true as const, value: [] })),
    pickFolder: vi.fn(async () => ({ ok: true as const, value: null })),
    decideShell: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    killShellHandle: vi.fn(async () => ({ ok: true as const, value: snapshot })),
  };
  bridgeState.current = {
    onShellEvent: () => () => undefined,
    showMainWindow,
    desktopAccess,
  } as unknown as DesktopBridge;
  return { desktopAccess, showMainWindow, snapshot };
};

const directRunUia = <T>(request: (auth?: AuthDict) => Promise<T>) => request();

beforeEach(() => {
  vi.clearAllMocks();
  bridgeState.current = undefined;
});

describe('registerThisMacDevice and useRegisteredMacDevices', () => {
  it('merges mac_devices account data, prunes stale devices, and excludes the current device', async () => {
    const net = createRelayNetwork([MAC_DEVICE, BROWSER_DEVICE]);
    net.accountData.set(DESKTOP_MAC_DEVICES_ACCOUNT_DATA, {
      v: 1,
      devices: [
        { device_id: 'STALE_MAC', label: 'Old Mac', updated_at: 100 },
        { device_id: BROWSER_DEVICE.deviceId, label: 'Browser Self', updated_at: 200 },
      ],
    });
    const mac = net.makeNode(MAC_DEVICE);
    const browser = net.makeNode(BROWSER_DEVICE);

    await registerThisMacDevice(mac.mx, 'Bas MacBook Pro', () => 1_700_000_000_000);

    expect(mac.setAccountDataMock).toHaveBeenCalledWith(DESKTOP_MAC_DEVICES_ACCOUNT_DATA, {
      v: 1,
      devices: [
        { device_id: MAC_DEVICE.deviceId, label: 'Bas MacBook Pro', updated_at: 1_700_000_000_000 },
        { device_id: BROWSER_DEVICE.deviceId, label: 'Browser Self', updated_at: 200 },
      ],
    });

    const { result } = renderHook(() => useRegisteredMacDevices(browser.mx));
    await waitFor(() => {
      expect(result.current).toEqual([
        { device_id: MAC_DEVICE.deviceId, label: 'Bas MacBook Pro', updated_at: 1_700_000_000_000 },
      ]);
    });
  });
});

describe('DesktopMacRelayFeature security and Browser-to-Mac relay flows', () => {
  it('rejects unencrypted, other-user, unsigned, and tampered-SAS pair_invite.v1 events', async () => {
    const { showMainWindow } = installMacBridge();
    const net = createRelayNetwork([MAC_DEVICE, BROWSER_DEVICE, UNSIGNED_BROWSER]);
    const mac = net.makeNode(MAC_DEVICE);
    const store = createStore();

    const { unmount } = render(
      createElement(
        Provider,
        { store },
        createElement(
          MatrixClientProvider,
          { value: mac.mx },
          createElement(DesktopMacRelayFeature)
        )
      )
    );

    const nonce = 'abcdef0123456789abcdef0123456789';
    const goodSas = await derivePairInviteSas(nonce, 'pair-code-1', BROWSER_DEVICE.deviceId);
    const baseInvite = {
      v: 1,
      nonce,
      agent_name: 'general',
      agent_user_id: AGENT_USER,
      controller: {
        user_id: AGENT_USER,
        device_id: AGENT_DEVICE.deviceId,
        ed25519: AGENT_DEVICE.ed25519,
      },
      homeserver: 'https://mindroom.chat',
      user_id: USER_ID,
      code: 'pair-code-1',
      cloudflare_access: false,
      requester_label: 'Safari',
      sas_code: goodSas,
    };

    // 1. Unencrypted
    mac.emitToDevice({
      message: { type: DESKTOP_PAIR_INVITE_EVENT, sender: USER_ID, content: baseInvite },
      encryptionInfo: null,
    });
    // 2. Other Matrix user
    mac.emitToDevice({
      message: {
        type: DESKTOP_PAIR_INVITE_EVENT,
        sender: '@attacker:evil.example',
        content: baseInvite,
      },
      encryptionInfo: {
        sender: '@attacker:evil.example',
        senderCurve25519KeyBase64: 'curve-evil',
        senderVerified: false,
      },
    });
    // 3. Unsigned device of the same user
    const unsignedSas = await derivePairInviteSas(nonce, 'pair-code-1', UNSIGNED_BROWSER.deviceId);
    mac.emitToDevice({
      message: {
        type: DESKTOP_PAIR_INVITE_EVENT,
        sender: USER_ID,
        content: { ...baseInvite, sas_code: unsignedSas },
      },
      encryptionInfo: {
        sender: USER_ID,
        senderDevice: UNSIGNED_BROWSER.deviceId,
        senderCurve25519KeyBase64: UNSIGNED_BROWSER.curveKey,
        senderVerified: false,
      },
    });
    // 4. Tampered SAS code from genuine browser device
    mac.emitToDevice({
      message: {
        type: DESKTOP_PAIR_INVITE_EVENT,
        sender: USER_ID,
        content: { ...baseInvite, sas_code: goodSas === '000000' ? '111111' : '000000' },
      },
      encryptionInfo: {
        sender: USER_ID,
        senderDevice: BROWSER_DEVICE.deviceId,
        senderCurve25519KeyBase64: BROWSER_DEVICE.curveKey,
        senderVerified: false,
      },
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(store.get(incomingPairInviteAtom)).toBeNull();
    expect(showMainWindow).not.toHaveBeenCalled();

    // 5. Genuine Olm-encrypted invite from signed browser device with matching SAS
    mac.emitToDevice({
      message: { type: DESKTOP_PAIR_INVITE_EVENT, sender: USER_ID, content: baseInvite },
      encryptionInfo: {
        sender: USER_ID,
        senderDevice: BROWSER_DEVICE.deviceId,
        senderCurve25519KeyBase64: BROWSER_DEVICE.curveKey,
        senderVerified: false,
      },
    });

    await waitFor(() => {
      expect(store.get(incomingPairInviteAtom)).toMatchObject({
        senderDeviceId: BROWSER_DEVICE.deviceId,
        senderEd25519: BROWSER_DEVICE.ed25519,
        invite: baseInvite,
      });
    });
    expect(showMainWindow).toHaveBeenCalledTimes(1);

    unmount();
    expect(mac.listenerCount()).toBe(0);
  });

  it('completes end-to-end Browser -> Mac relay happy path and calls finishSetup after confirmation', async () => {
    const { desktopAccess } = installMacBridge();
    const net = createRelayNetwork([MAC_DEVICE, BROWSER_DEVICE, AGENT_DEVICE]);
    const mac = net.makeNode(MAC_DEVICE);
    const browser = net.makeNode(BROWSER_DEVICE);
    const agent = net.makeNode(AGENT_DEVICE);
    const store = createStore();

    // Agent responds to setup_request.v1 and pairing_confirm.v1 over Olm.
    agent.mx.on(ClientEvent.ReceivedToDeviceMessage, (payload: ReceivedToDeviceMessage) => {
      const { message } = payload;
      if (message.type === DESKTOP_SETUP_REQUEST_EVENT) {
        browser.emitToDevice({
          message: {
            type: DESKTOP_SETUP_OFFER_EVENT,
            sender: AGENT_USER,
            content: {
              v: 1,
              nonce: message.content.nonce,
              agent_name: 'general',
              eligible: true,
              homeserver: 'https://mindroom.chat',
              user_id: USER_ID,
              code: 'relay-code-42',
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
      } else if (message.type === DESKTOP_PAIRING_CONFIRM_EVENT) {
        expect(message.content.token).toBe('relay-code-42');
        expect(message.content.device_id).toBe('HELPER_DEV');
        browser.emitToDevice({
          message: {
            type: DESKTOP_PAIRING_CONFIRMED_EVENT,
            sender: AGENT_USER,
            content: { v: 1, nonce: message.content.nonce, agent_name: 'general', ok: true },
          },
          encryptionInfo: {
            sender: AGENT_USER,
            senderDevice: AGENT_DEVICE.deviceId,
            senderCurve25519KeyBase64: AGENT_DEVICE.curveKey,
            senderVerified: false,
          },
        });
      }
    });

    const { unmount } = render(
      createElement(
        Provider,
        { store },
        createElement(
          MatrixClientProvider,
          { value: mac.mx },
          createElement(DesktopMacRelayFeature)
        )
      )
    );

    const states: RelayPairState[] = [];
    const relayPromise = relayPairToMac(
      browser.mx,
      { device_id: MAC_DEVICE.deviceId, label: 'Bas MacBook Pro', updated_at: 1_700_000_000_000 },
      AGENT_USER,
      'general',
      (state) => states.push(state)
    );

    // Wait for Mac to receive the verified invite.
    await waitFor(() => {
      expect(store.get(incomingPairInviteAtom)).not.toBeNull();
    });
    const incoming = store.get(incomingPairInviteAtom)!;
    const awaiting = states.find((s) => s.phase === 'awaiting_mac');
    expect(awaiting).toBeDefined();
    if (awaiting && awaiting.phase === 'awaiting_mac') {
      expect(incoming.invite.sas_code).toBe(awaiting.sasCode);
    }

    // Approve on the Mac while Browser awaits pair_invite_result.v1 and sends pair_invite_confirmed.v1.
    const [relayResult, macSnapshot] = await Promise.all([
      relayPromise,
      approveIncomingPairInvite(
        mac.mx,
        incoming,
        directRunUia,
        'full',
        undefined,
        undefined,
        store
      ),
    ]);

    expect(relayResult).toMatchObject({
      deviceId: 'HELPER_DEV',
      deviceEd25519: 'ed-helper',
    });
    expect(macSnapshot).toBeDefined();
    expect(desktopAccess.pair).toHaveBeenCalledTimes(1);
    expect(desktopAccess.finishSetup).toHaveBeenCalledWith({
      controllerKey: '["@mindroom_general:mindroom.chat", "AGENT_DEV", "ed-agent"]',
      agentName: 'general',
      mode: 'full',
    });
    expect(store.get(incomingPairInviteAtom)).toBeNull();
    expect(states.map((s) => s.phase)).toEqual([
      'requesting_offer',
      'awaiting_mac',
      'confirming',
      'paired',
    ]);

    unmount();
  });

  it('notifies browser and clears invite atom when declined on Mac', async () => {
    installMacBridge();
    const net = createRelayNetwork([MAC_DEVICE, BROWSER_DEVICE, AGENT_DEVICE]);
    const mac = net.makeNode(MAC_DEVICE);
    const browser = net.makeNode(BROWSER_DEVICE);
    const agent = net.makeNode(AGENT_DEVICE);
    const store = createStore();

    agent.mx.on(ClientEvent.ReceivedToDeviceMessage, (payload: ReceivedToDeviceMessage) => {
      if (payload.message.type !== DESKTOP_SETUP_REQUEST_EVENT) return;
      browser.emitToDevice({
        message: {
          type: DESKTOP_SETUP_OFFER_EVENT,
          sender: AGENT_USER,
          content: {
            v: 1,
            nonce: payload.message.content.nonce,
            agent_name: 'general',
            eligible: true,
            homeserver: 'https://mindroom.chat',
            user_id: USER_ID,
            code: 'decline-code-1',
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

    const { unmount } = render(
      createElement(
        Provider,
        { store },
        createElement(
          MatrixClientProvider,
          { value: mac.mx },
          createElement(DesktopMacRelayFeature)
        )
      )
    );

    const relayPromise = relayPairToMac(
      browser.mx,
      { device_id: MAC_DEVICE.deviceId, label: 'Bas MacBook Pro', updated_at: 1_700_000_000_000 },
      AGENT_USER,
      'general'
    );

    await waitFor(() => {
      expect(store.get(incomingPairInviteAtom)).not.toBeNull();
    });
    const incoming = store.get(incomingPairInviteAtom)!;

    await declineIncomingPairInvite(mac.mx, incoming, store);
    expect(store.get(incomingPairInviteAtom)).toBeNull();
    await expect(relayPromise).rejects.toThrow('Declined on Mac.');

    unmount();
  });

  it('rejects spoofed pair_invite_result.v1 and pair_invite_confirmed.v1 from wrong devices', async () => {
    installMacBridge();
    const otherSignedDevice: DeviceSpec = {
      userId: USER_ID,
      deviceId: 'OTHER_DEV',
      curveKey: 'curve-other',
      ed25519: 'ed-other',
      signedByOwner: true,
    };
    const net = createRelayNetwork([MAC_DEVICE, BROWSER_DEVICE, otherSignedDevice, AGENT_DEVICE]);
    const mac = net.makeNode(MAC_DEVICE);
    const browser = net.makeNode(BROWSER_DEVICE);
    const store = createStore();

    // Send a spoofed pair_invite_confirmed.v1 from OTHER_DEV while Mac waits for BROWSER_DEV.
    const nonce = 'fedcba9876543210fedcba9876543210';
    const sasCode = await derivePairInviteSas(nonce, 'code-99', BROWSER_DEVICE.deviceId);
    const incoming = {
      invite: {
        v: 1 as const,
        nonce,
        agent_name: 'general',
        agent_user_id: AGENT_USER,
        controller: {
          user_id: AGENT_USER,
          device_id: AGENT_DEVICE.deviceId,
          ed25519: AGENT_DEVICE.ed25519,
        },
        homeserver: 'https://mindroom.chat',
        user_id: USER_ID,
        code: 'code-99',
        cloudflare_access: false,
        requester_label: 'Safari',
        sas_code: sasCode,
      },
      senderDeviceId: BROWSER_DEVICE.deviceId,
      senderEd25519: BROWSER_DEVICE.ed25519,
      receivedAt: Date.now(),
    };
    store.set(incomingPairInviteAtom, incoming);

    browser.mx.on(ClientEvent.ReceivedToDeviceMessage, (payload: ReceivedToDeviceMessage) => {
      if (payload.message.type !== DESKTOP_PAIR_INVITE_RESULT_EVENT) return;
      // Spoofed confirmation from OTHER_DEV must be ignored.
      mac.emitToDevice({
        message: {
          type: DESKTOP_PAIR_INVITE_CONFIRMED_EVENT,
          sender: USER_ID,
          content: { v: 1, nonce, ok: true },
        },
        encryptionInfo: {
          sender: USER_ID,
          senderDevice: otherSignedDevice.deviceId,
          senderCurve25519KeyBase64: otherSignedDevice.curveKey,
          senderVerified: false,
        },
      });
    });

    await expect(
      approveIncomingPairInvite(
        mac.mx,
        incoming,
        directRunUia,
        'full',
        undefined,
        { confirmTimeoutMs: 60 },
        store
      )
    ).rejects.toThrow(/timed out/i);
  });
});
