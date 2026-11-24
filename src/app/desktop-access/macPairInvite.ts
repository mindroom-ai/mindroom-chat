import { useEffect } from 'react';
import { atom, useSetAtom, type createStore } from 'jotai';
import { ClientEvent, type MatrixClient } from 'matrix-js-sdk';
import type { ReceivedToDeviceMessage } from 'matrix-js-sdk/lib/sync-accumulator';
import type { UiaRunner } from '../account/watch/connectWatch';
import type { DesktopAccessMode, DesktopAccessSnapshot } from '../lib/desktopBridge';
import { errorMessage } from '../lib/errorMessage';
import { desktopBridge, isDesktopAccessAvailable } from '../lib/nativeShell';
import { getImperativeJotaiStore } from '../lib/state/jotaiStore';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { registerThisMacDevice } from './browserPairRelay';
import {
  beginHelperSetup,
  finishHelperSetup,
  pairHelperWithController,
  requireOwnAccount,
  type DesktopAccessLimits,
} from './desktopAccessController';
import {
  exchangeOverOlm,
  sendEncryptedToSingleDevice,
  signedDeviceOfKey,
} from './desktopOlmTransport';
import {
  DESKTOP_PAIR_INVITE_CONFIRMED_EVENT,
  DESKTOP_PAIR_INVITE_EVENT,
  DESKTOP_PAIR_INVITE_RESULT_EVENT,
  derivePairInviteSas,
  parseDesktopPairInvite,
  parseDesktopPairInviteConfirmed,
  sameHomeserver,
  type DesktopPairInvite,
} from './desktopPairingProtocol';

type Store = ReturnType<typeof createStore>;

/** How long the Mac waits for the browser to report the agent's answer. */
const CONFIRM_TIMEOUT_MS = 60_000;

/** A verified invite from one of this account's browsers, waiting for consent on this Mac. */
export type IncomingPairInvite = {
  invite: DesktopPairInvite;
  senderDeviceId: string;
  senderEd25519: string;
  receivedAt: number;
};

/** The invite this Mac shows a consent sheet for, or `null`. */
export const incomingPairInviteAtom = atom<IncomingPairInvite | null>(null);

/** Answers the browser that sent the invite, and no other device. */
const answerInvite = async (
  mx: MatrixClient,
  { invite, senderDeviceId, senderEd25519 }: IncomingPairInvite,
  result: Record<string, unknown>
): Promise<void> =>
  sendEncryptedToSingleDevice(
    mx,
    DESKTOP_PAIR_INVITE_RESULT_EVENT,
    { userId: invite.user_id, deviceId: senderDeviceId, ed25519: senderEd25519 },
    { v: 1, nonce: invite.nonce, ...result }
  );

const forgetInvite = (store: Store, { invite }: IncomingPairInvite): void => {
  if (store.get(incomingPairInviteAtom)?.invite.nonce === invite.nonce)
    store.set(incomingPairInviteAtom, null);
};

/**
 * On the Mac, after the consent click: opens the setup authorization, signs the helper in, has it
 * claim the invite's code, tells the browser which helper device claimed it, and applies the
 * consented mode once the browser reports that the agent confirmed the pairing.
 */
export const approveIncomingPairInvite = async (
  mx: MatrixClient,
  incoming: IncomingPairInvite,
  runUia: UiaRunner,
  mode: DesktopAccessMode,
  limits?: DesktopAccessLimits,
  { confirmTimeoutMs = CONFIRM_TIMEOUT_MS }: { confirmTimeoutMs?: number } = {},
  store: Store = getImperativeJotaiStore()
): Promise<DesktopAccessSnapshot> => {
  const { invite, senderDeviceId, senderEd25519 } = incoming;
  const target = {
    controller: invite.controller,
    agentName: invite.agent_name,
    homeserver: invite.homeserver,
    userId: invite.user_id,
    code: invite.code,
    cloudflareAccess: invite.cloudflare_access,
  };
  try {
    // Checked before the click is spent: an invite for another server or account opens no setup.
    requireOwnAccount(mx, invite.homeserver, invite.user_id);
    await beginHelperSetup();
    const paired = await pairHelperWithController(mx, target, runUia).catch(
      async (error: unknown) => {
        // The browser waits for an answer; a failure here is one.
        const failure = { ok: false, error: errorMessage(error).slice(0, 1024) };
        await answerInvite(mx, incoming, failure).catch(() => undefined);
        throw error;
      }
    );
    const claimed = {
      ok: true,
      device_id: paired.deviceId,
      device_ed25519: paired.deviceEd25519,
      verification: paired.verification,
    };
    const { reply: confirmed } = await exchangeOverOlm(
      mx,
      {
        replyType: DESKTOP_PAIR_INVITE_CONFIRMED_EVENT,
        parse: parseDesktopPairInviteConfirmed,
        nonce: invite.nonce,
        from: { userId: invite.user_id, deviceId: senderDeviceId, ed25519: senderEd25519 },
        timeoutMs: confirmTimeoutMs,
      },
      () => answerInvite(mx, incoming, claimed)
    );
    if (!confirmed.ok) throw new Error(confirmed.error);
    const { agent_name: agentName } = invite;
    return await finishHelperSetup(paired.controllerKey, { agentName, mode, limits });
  } finally {
    // The code is spent once the helper tried to claim it; a retry starts from the browser.
    forgetInvite(store, incoming);
  }
};

/** On the Mac: refuses the invite and tells the browser so. */
export const declineIncomingPairInvite = async (
  mx: MatrixClient,
  incoming: IncomingPairInvite,
  store: Store = getImperativeJotaiStore()
): Promise<void> => {
  forgetInvite(store, incoming);
  await answerInvite(mx, incoming, { ok: false, error: 'Declined on Mac.' });
};

/**
 * In the Mac app: lists this device among the account's Macs and takes the pairing invites of the
 * account's browsers. An invite reaches the consent sheet only if it came Olm-encrypted from
 * another cross-signed device of this account and its six digits bind it to that device.
 */
export function DesktopMacRelayFeature(): null {
  const mx = useMatrixClient();
  const setInvite = useSetAtom(incomingPairInviteAtom);
  useEffect(() => {
    const userId = mx.getUserId();
    if (!isDesktopAccessAvailable() || !userId) return undefined;
    let mounted = true;
    const receive = async (invite: DesktopPairInvite, curveKey: string): Promise<void> => {
      const sender = await signedDeviceOfKey(mx, userId, curveKey);
      if (!sender || sender.device_id === mx.getDeviceId()) return;
      const sasCode = await derivePairInviteSas(invite.nonce, invite.code, sender.device_id);
      if (!mounted || sasCode !== invite.sas_code) return;
      const { device_id: senderDeviceId, ed25519: senderEd25519 } = sender;
      setInvite({ invite, senderDeviceId, senderEd25519, receivedAt: Date.now() });
      // The consent sheet is of no use in a hidden window.
      await desktopBridge()?.showMainWindow();
    };
    const onMessage = ({ message, encryptionInfo }: ReceivedToDeviceMessage): void => {
      if (message.type !== DESKTOP_PAIR_INVITE_EVENT || !encryptionInfo) return;
      if (encryptionInfo.sender !== userId || message.sender !== userId) return;
      const invite = parseDesktopPairInvite(message.content);
      if (!invite || invite.controller.user_id !== invite.agent_user_id) return;
      // No consent sheet for an invite that would sign the helper in elsewhere or as someone else.
      if (invite.user_id !== userId || !sameHomeserver(invite.homeserver, mx.getHomeserverUrl()))
        return;
      void receive(invite, encryptionInfo.senderCurve25519KeyBase64).catch(() => undefined);
    };
    mx.on(ClientEvent.ReceivedToDeviceMessage, onMessage);
    void registerThisMacDevice(mx).catch(() => undefined);
    return () => {
      mounted = false;
      mx.removeListener(ClientEvent.ReceivedToDeviceMessage, onMessage);
    };
  }, [mx, setInvite]);
  return null;
}
