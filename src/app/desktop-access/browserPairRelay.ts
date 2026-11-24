import { useEffect, useState } from 'react';
import {
  ClientEvent,
  type AccountDataEvents,
  type MatrixClient,
  type MatrixEvent,
} from 'matrix-js-sdk';
import { errorMessage } from '../lib/errorMessage';
import { signedModelDevices } from '../matrix/runtimeDeviceTrust';
import {
  confirmAgentPairing,
  exchangeOverOlm,
  requestAgentSetupOffer,
  sendEncryptedToSingleDevice,
  type OlmTarget,
} from './desktopOlmTransport';
import {
  DESKTOP_MAC_DEVICES_ACCOUNT_DATA,
  DESKTOP_PAIR_INVITE_CONFIRMED_EVENT,
  DESKTOP_PAIR_INVITE_EVENT,
  DESKTOP_PAIR_INVITE_RESULT_EVENT,
  createPairingNonce,
  derivePairInviteSas,
  parseDesktopPairInviteResult,
  parseMacDevicesAccountData,
  type DesktopPairInvite,
  type MacDeviceEntry,
} from './desktopPairingProtocol';

/** The pairing code lives 15 minutes on the agent; the user gets most of it to answer on the Mac. */
const MAC_ANSWER_TIMEOUT_MS = 10 * 60_000;

export type RelayPairState =
  | { phase: 'requesting_offer' | 'confirming' | 'paired' }
  /** `sasCode`: the six digits the Mac shows too. */
  | { phase: 'awaiting_mac'; sasCode: string };

/** This session's device and the account's devices, as the homeserver lists them. */
const thisDevice = async (mx: MatrixClient) => {
  const userId = mx.getUserId();
  const deviceId = mx.getDeviceId();
  const devices = userId && (await mx.getCrypto()?.getUserDeviceInfo([userId], true))?.get(userId);
  if (!userId || !deviceId || !devices) throw new Error('This session has no encryption set up.');
  return { userId, deviceId, devices, name: devices.get(deviceId)?.displayName?.trim() };
};

const macDevicesOf = (mx: MatrixClient): MacDeviceEntry[] =>
  parseMacDevicesAccountData(
    mx.getAccountData(DESKTOP_MAC_DEVICES_ACCOUNT_DATA as keyof AccountDataEvents)?.getContent()
  )?.devices ?? [];

/**
 * In the Mac app: lists this device first among the account's Macs and drops the entries of
 * devices that are gone. The label defaults to the session's name.
 */
export const registerThisMacDevice = async (
  mx: MatrixClient,
  label?: string,
  now: () => number = Date.now
): Promise<void> => {
  const { deviceId, devices: known, name } = await thisDevice(mx);
  const entry = { device_id: deviceId, label: label ?? (name || 'Mac'), updated_at: now() };
  const listed = macDevicesOf(mx);
  const others = listed.filter((d) => d.device_id !== deviceId && known.has(d.device_id));
  const [first] = listed;
  const current = first?.device_id === deviceId && first.label === entry.label;
  if (current && listed.length === others.length + 1) return;
  const content = { v: 1, devices: [entry, ...others] };
  // The SDK types only the account data it knows.
  await mx.setAccountData(DESKTOP_MAC_DEVICES_ACCOUNT_DATA as never, content as never);
};

/** The account's other Macs that run MindRoom Chat and are still cross-signed devices of it. */
export const useRegisteredMacDevices = (mx: MatrixClient): MacDeviceEntry[] => {
  const [devices, setDevices] = useState<MacDeviceEntry[]>([]);
  useEffect(() => {
    let current = true;
    const load = async (): Promise<void> => {
      const userId = mx.getUserId();
      const signed = userId ? await signedModelDevices(mx, [userId]) : [];
      const listed = macDevicesOf(mx).filter(
        (d) => d.device_id !== mx.getDeviceId() && signed.some((s) => s.deviceId === d.device_id)
      );
      if (current) setDevices(listed);
    };
    const onAccountData = (event: MatrixEvent): void => {
      if (event.getType() === DESKTOP_MAC_DEVICES_ACCOUNT_DATA) void load().catch(() => undefined);
    };
    void load().catch(() => undefined);
    mx.on(ClientEvent.AccountData, onAccountData);
    return () => {
      current = false;
      mx.removeListener(ClientEvent.AccountData, onAccountData);
    };
  }, [mx]);
  return devices;
};

/**
 * In a browser: pairs an agent with the helper of one of the account's Macs. The browser asks the
 * agent for the offer and confirms the pairing, as the agent lets only the device that asked
 * confirm; the Mac, after consent there, claims the offer's code and reports its helper device.
 */
export const relayPairToMac = async (
  mx: MatrixClient,
  targetMacDevice: MacDeviceEntry,
  agentUserId: string,
  agentName: string,
  onState?: (state: RelayPairState) => void,
  signal?: AbortSignal
): Promise<{ deviceId: string; deviceEd25519: string }> => {
  const { userId, deviceId: ownDeviceId, name } = await thisDevice(mx);
  const mac: OlmTarget = { userId, deviceId: targetMacDevice.device_id };
  onState?.({ phase: 'requesting_offer' });
  const { offer, controller } = await requestAgentSetupOffer(mx, agentUserId, agentName, signal);
  if (!offer.eligible) throw new Error(offer.error);
  const nonce = createPairingNonce();
  const sasCode = await derivePairInviteSas(nonce, offer.code, ownDeviceId);
  const invite: DesktopPairInvite = {
    v: 1,
    nonce,
    agent_name: agentName,
    agent_user_id: agentUserId,
    controller,
    homeserver: offer.homeserver,
    user_id: offer.user_id,
    code: offer.code,
    cloudflare_access: offer.cloudflare_access,
    requester_label: name?.slice(0, 256) || 'Browser',
    sas_code: sasCode,
  };
  onState?.({ phase: 'awaiting_mac', sasCode });
  const { reply: result } = await exchangeOverOlm(
    mx,
    {
      replyType: DESKTOP_PAIR_INVITE_RESULT_EVENT,
      parse: parseDesktopPairInviteResult,
      nonce,
      from: mac,
      signal,
      timeoutMs: MAC_ANSWER_TIMEOUT_MS,
    },
    () => sendEncryptedToSingleDevice(mx, DESKTOP_PAIR_INVITE_EVENT, mac, invite)
  );
  if (!result.ok) throw new Error(result.error);
  onState?.({ phase: 'confirming' });
  const claimed = {
    token: offer.code,
    verification: result.verification,
    deviceId: result.device_id,
    deviceEd25519: result.device_ed25519,
  };
  const confirmed = await confirmAgentPairing(mx, controller, claimed, signal).catch(
    (error: unknown) => ({ ok: false as const, error: errorMessage(error).slice(0, 1024) })
  );
  // The Mac applies the consented mode only once it hears that the agent confirmed.
  await sendEncryptedToSingleDevice(mx, DESKTOP_PAIR_INVITE_CONFIRMED_EVENT, mac, {
    v: 1,
    nonce,
    ok: confirmed.ok,
    ...(confirmed.ok ? {} : { error: confirmed.error }),
  });
  if (!confirmed.ok) throw new Error(confirmed.error);
  onState?.({ phase: 'paired' });
  return { deviceId: result.device_id, deviceEd25519: result.device_ed25519 };
};
