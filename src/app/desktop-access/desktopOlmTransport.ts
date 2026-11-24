import { ClientEvent, type MatrixClient } from 'matrix-js-sdk';
import type { ReceivedToDeviceMessage } from 'matrix-js-sdk/lib/sync-accumulator';
import { deviceSignedByOwner } from '../matrix/matrix-crypto';
import { signedModelDevices } from '../matrix/runtimeDeviceTrust';
import { sendEncryptedToDeviceRequest } from '../matrix/runtimeToDeviceTransport';
import {
  DESKTOP_DISCONNECT_CONFIRMED_EVENT,
  DESKTOP_DISCONNECT_REQUEST_EVENT,
  DESKTOP_PAIRING_CONFIRMED_EVENT,
  DESKTOP_PAIRING_CONFIRM_EVENT,
  DESKTOP_SETUP_OFFER_EVENT,
  DESKTOP_SETUP_REQUEST_EVENT,
  createPairingNonce,
  parseDesktopDisconnectConfirmed,
  parseDesktopPairingConfirmed,
  parseDesktopSetupOffer,
  type DesktopAgentStatus,
  type DesktopSetupOffer,
  type PinnedDevice,
} from './desktopPairingProtocol';

const REPLY_TIMEOUT_MS = 30_000;

/** A device to reach: its owner and ID, and its signing key when the caller pinned one. */
export type OlmTarget = { userId: string; deviceId: string; ed25519?: string };
export type AgentSetupOfferResult = { offer: DesktopSetupOffer; controller: PinnedDevice };
export type ClaimedHelperDevice = {
  token: string;
  verification: string;
  deviceId: string;
  deviceEd25519: string;
};

/**
 * The device that holds this Curve25519 key, if its owner cross-signed it. The key comes from the
 * Olm session that decrypted a message, so it names the true sender; the device ID beside it does not.
 */
export const signedDeviceOfKey = async (
  mx: MatrixClient,
  userId: string,
  curveKey: string
): Promise<PinnedDevice | null> => {
  const crypto = mx.getCrypto();
  const devices = (await crypto?.getUserDeviceInfo([userId], true))?.get(userId);
  for (const [deviceId, device] of devices ?? []) {
    if (device.getIdentityKey() !== curveKey) continue;
    const ed25519 = device.getFingerprint();
    const signed = crypto && (await deviceSignedByOwner(crypto, userId, deviceId));
    return ed25519 && signed ? { user_id: userId, device_id: deviceId, ed25519 } : null;
  }
  return null;
};

/** Sends one Olm-encrypted event to one cross-signed device, never in plain text. */
export const sendEncryptedToSingleDevice = async (
  mx: MatrixClient,
  eventType: string,
  { userId, deviceId, ed25519 }: OlmTarget,
  content: Record<string, unknown>
): Promise<void> => {
  const crypto = mx.getCrypto();
  if (!crypto) throw new Error('Encryption is not available.');
  const device = (await crypto.getUserDeviceInfo([userId], true)).get(userId)?.get(deviceId);
  if (!device || !(await deviceSignedByOwner(crypto, userId, deviceId)))
    throw new Error('The target device is not signed by its owner.');
  if (ed25519 !== undefined && device.getFingerprint() !== ed25519)
    throw new Error('The target device has another signing key.');
  const encrypted = await crypto.encryptToDeviceMessages(
    eventType,
    [{ userId, deviceId }],
    content
  );
  const message = encrypted.batch.find((m) => m.userId === userId && m.deviceId === deviceId);
  if (encrypted.eventType !== 'm.room.encrypted' || !message)
    throw new Error('Could not encrypt the message for the target device.');
  await mx.queueToDevice({ eventType: encrypted.eventType, batch: [message] });
};

export type OlmExchange<T> = {
  /** The event type of the reply. */
  replyType: string;
  parse: (raw: unknown) => T | null;
  /** The nonce the reply must repeat. */
  nonce: string;
  /** Who may answer: any cross-signed device of the user, or only the one named. */
  from: { userId: string; deviceId?: string; ed25519?: string };
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * Sends a request and resolves with the first reply that is Olm-encrypted, repeats the nonce, and
 * comes from a cross-signed device of the expected user (the pinned one, if any), with that device.
 * `send` gets a signal that aborts once the exchange ends and a check for whether it was answered.
 */
export const exchangeOverOlm = <T extends { nonce: string }>(
  mx: MatrixClient,
  { replyType, parse, nonce, from, signal, timeoutMs = REPLY_TIMEOUT_MS }: OlmExchange<T>,
  send: (signal: AbortSignal, answered: () => boolean) => Promise<void>
): Promise<{ reply: T; device: PinnedDevice }> =>
  new Promise((resolve, reject) => {
    const ended = new AbortController();
    const abort = () => finish(() => reject(new Error('The request was aborted.')));
    const onMessage = ({ message, encryptionInfo }: ReceivedToDeviceMessage): void => {
      if (message.type !== replyType || !encryptionInfo) return;
      if (encryptionInfo.sender !== from.userId || message.sender !== from.userId) return;
      const reply = parse(message.content);
      if (!reply || reply.nonce !== nonce) return;
      signedDeviceOfKey(mx, from.userId, encryptionInfo.senderCurve25519KeyBase64)
        .then((device) => {
          if (!device) return;
          if (from.deviceId !== undefined && device.device_id !== from.deviceId) return;
          if (from.ed25519 !== undefined && device.ed25519 !== from.ed25519) return;
          finish(() => resolve({ reply, device }));
        })
        .catch(() => undefined);
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error('Timed out waiting for a reply.'))),
      timeoutMs
    );
    function finish(settle: () => void): void {
      if (ended.signal.aborted) return;
      ended.abort();
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      mx.removeListener(ClientEvent.ReceivedToDeviceMessage, onMessage);
      settle();
    }
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    mx.on(ClientEvent.ReceivedToDeviceMessage, onMessage);
    send(ended.signal, () => ended.signal.aborted).catch((error: unknown) =>
      finish(() => reject(error instanceof Error ? error : new Error(String(error))))
    );
  });

/** Sends a request to every cross-signed device of the agent, again while none has answered. */
const askAgent = <T extends { nonce: string }>(
  mx: MatrixClient,
  agentUserId: string,
  requestType: string,
  content: { nonce: string } & Record<string, unknown>,
  exchange: Pick<OlmExchange<T>, 'replyType' | 'parse' | 'signal' | 'timeoutMs'>
): Promise<{ reply: T; device: PinnedDevice }> =>
  exchangeOverOlm(
    mx,
    { ...exchange, nonce: content.nonce, from: { userId: agentUserId } },
    async (signal, answered) => {
      const devices = await signedModelDevices(mx, [agentUserId]);
      if (!devices.length) throw new Error('This agent has no verified device to pair with.');
      await sendEncryptedToDeviceRequest(mx, requestType, devices, content, signal, answered);
    }
  );

/** Asks the agent for a setup offer; the device that answers becomes the helper's controller. */
export const requestAgentSetupOffer = async (
  mx: MatrixClient,
  agentUserId: string,
  agentName: string,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<AgentSetupOfferResult> => {
  const content = { v: 1, nonce: createPairingNonce(), agent_name: agentName };
  const { reply, device } = await askAgent(mx, agentUserId, DESKTOP_SETUP_REQUEST_EVENT, content, {
    replyType: DESKTOP_SETUP_OFFER_EVENT,
    parse: parseDesktopSetupOffer,
    signal,
    timeoutMs,
  });
  return { offer: reply, controller: device };
};

/**
 * Tells the controller which helper device claimed the pairing code. Only the device that asked
 * for the offer may confirm it, and only the controller that made the offer may answer.
 */
export const confirmAgentPairing = async (
  mx: MatrixClient,
  controller: PinnedDevice,
  claimed: ClaimedHelperDevice,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<DesktopAgentStatus> => {
  const target = {
    userId: controller.user_id,
    deviceId: controller.device_id,
    ed25519: controller.ed25519,
  };
  const content = {
    v: 1,
    nonce: createPairingNonce(),
    token: claimed.token,
    verification: claimed.verification,
    device_id: claimed.deviceId,
    device_ed25519: claimed.deviceEd25519,
  };
  const { reply } = await exchangeOverOlm(
    mx,
    {
      replyType: DESKTOP_PAIRING_CONFIRMED_EVENT,
      parse: parseDesktopPairingConfirmed,
      nonce: content.nonce,
      from: target,
      signal,
      timeoutMs,
    },
    () => sendEncryptedToSingleDevice(mx, DESKTOP_PAIRING_CONFIRM_EVENT, target, content)
  );
  return reply;
};

/** Asks the agent to forget the helper device it paired with for this account. */
export const disconnectAgentPairing = async (
  mx: MatrixClient,
  agentUserId: string,
  agentName: string,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<DesktopAgentStatus> => {
  const content = { v: 1, nonce: createPairingNonce(), agent_name: agentName };
  const { reply } = await askAgent(mx, agentUserId, DESKTOP_DISCONNECT_REQUEST_EVENT, content, {
    replyType: DESKTOP_DISCONNECT_CONFIRMED_EVENT,
    parse: parseDesktopDisconnectConfirmed,
    signal,
    timeoutMs,
  });
  return reply;
};
