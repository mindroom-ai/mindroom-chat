import { useCallback, useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { AuthenticationCancelled } from '../account/uia/useAuthenticatedAction';
import type { UiaRunner } from '../account/watch/connectWatch';
import type {
  DesktopAccessBridge,
  DesktopAccessFinishSetupRequest,
  DesktopAccessMode,
  DesktopAccessPairResult,
  DesktopAccessSnapshot,
  DesktopResult,
} from '../lib/desktopBridge';
import { errorMessage } from '../lib/errorMessage';
import { desktopBridge } from '../lib/nativeShell';
import {
  confirmAgentPairing,
  disconnectAgentPairing,
  requestAgentSetupOffer,
} from './desktopOlmTransport';
import { sameHomeserver, type PinnedDevice } from './desktopPairingProtocol';
import { mintDesktopLoginToken } from './mintDesktopLoginToken';

const ACCESSIBILITY_POLL_MS = 1000;
/** How long a disconnect waits for an agent that may be offline. */
const DISCONNECT_TIMEOUT_MS = 8000;

export type DesktopPairingStep =
  'requesting_offer' | 'signing_in' | 'pairing' | 'confirming' | 'finishing';

/** What Choose limits sets for a restricted agent. */
export type DesktopAccessLimits = Omit<
  DesktopAccessFinishSetupRequest,
  'controllerKey' | 'agentName' | 'mode'
>;

export type PairAgentParams = {
  agentUserId: string;
  agentName: string;
  mode: DesktopAccessMode;
  limits?: DesktopAccessLimits;
};

/** Where the helper signs in and what it claims: an eligible setup offer, or a relayed invite. */
export type HelperPairingTarget = {
  controller: PinnedDevice;
  agentName: string;
  homeserver: string;
  userId: string;
  code: string;
  cloudflareAccess: boolean;
};

/** The Mac Computer Access bridge of the desktop app; throws in a browser. */
export const requireDesktopAccess = (): DesktopAccessBridge => {
  const bridge = desktopBridge()?.desktopAccess;
  if (!bridge) throw new Error('Mac Computer Access needs the MindRoom Chat app for Mac.');
  return bridge;
};

/** The value of a bridge call, or its failure as an error. */
export const unwrapDesktopResult = <T>(result: DesktopResult<T>): T => {
  if (result.ok) return result.value;
  throw new Error(result.message ?? result.code);
};

/**
 * The live Mac Computer Access state: loaded once, again on every status event of the shell, and
 * every second while Accessibility is not granted (with `pollAccessibility`), so the row turns
 * green the moment the user allows it in System Settings.
 */
export const useDesktopAccessSnapshot = ({ pollAccessibility = false, enabled = true } = {}) => {
  const bridge = desktopBridge();
  const access = bridge?.desktopAccess;
  const active = enabled && access !== undefined;
  const [snapshot, setSnapshot] = useState<DesktopAccessSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(active);

  const refresh = useCallback(async (): Promise<void> => {
    if (!active || !access) return;
    try {
      setSnapshot(unwrapDesktopResult(await access.status()));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [access, active]);

  useEffect(() => {
    if (!active) return undefined;
    void refresh();
    return bridge?.onShellEvent((event) => {
      if (event.type === 'desktop-access-status') void refresh();
    });
  }, [active, bridge, refresh]);

  const polling =
    active &&
    pollAccessibility &&
    snapshot !== null &&
    snapshot.permissions.accessibility !== 'granted';
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setInterval(() => void refresh(), ACCESSIBILITY_POLL_MS);
    return () => clearInterval(timer);
  }, [polling, refresh]);

  return { snapshot, loading, error, refresh };
};

/**
 * Refuses a setup offer or relayed invite that names another homeserver or account than this
 * session's. The agent supplies both, and the helper would open its sign-in at whatever they name.
 */
export const requireOwnAccount = (mx: MatrixClient, homeserver: string, userId: string): void => {
  if (!sameHomeserver(homeserver, mx.getHomeserverUrl()))
    throw new Error('This pairing offer names another homeserver than the one you signed in to.');
  if (userId !== mx.getUserId()) throw new Error('This pairing offer is for another account.');
};

/**
 * Opens the setup authorization of the desktop app from the consent click. It has to come before
 * any waiting: a click counts for a few seconds only, and an agent may take longer to answer.
 */
export const beginHelperSetup = async (): Promise<void> =>
  unwrapDesktopResult(await requireDesktopAccess().beginSetup());

/**
 * Signs the helper in as this account unless it already is: silently with a one-time login token
 * where the homeserver mints one, else through the helper's browser sign-in.
 */
const ensureHelperSession = async (
  mx: MatrixClient,
  access: DesktopAccessBridge,
  target: HelperPairingTarget,
  runUia: UiaRunner,
  onSignIn: () => void
): Promise<void> => {
  const helperStatus = unwrapDesktopResult(await access.status()).status;
  const session = helperStatus?.pairing;
  const { homeserver, userId, cloudflareAccess } = target;
  const signedIn =
    session?.session_state === 'ready' &&
    session.user_id === userId &&
    session.homeserver !== null &&
    sameHomeserver(session.homeserver, homeserver);
  if (signedIn) return;
  if (session?.session_state === 'ready' && (helperStatus?.config.controllers.length ?? 0) > 0) {
    throw new Error(
      'Another Matrix account still has paired agents on this Mac. Revoke All Access in Settings -> This Mac before switching accounts.'
    );
  }
  onSignIn();
  const minted = await mintDesktopLoginToken(mx, runUia, {
    homeserverUrl: homeserver,
    cloudflareAccess,
  });
  if (minted.kind === 'cancelled') throw new AuthenticationCancelled();
  if (minted.kind === 'failed') throw new Error(minted.reason);
  unwrapDesktopResult(
    await access.login({
      homeserver,
      userId,
      method: 'sso',
      ...(minted.kind === 'token' ? { loginToken: minted.loginToken } : {}),
      cloudflareAccess,
      // The helper refuses to sign in over a saved session, even an unreadable one.
      replace: session !== undefined && session.session_state !== 'missing',
    })
  );
};

/**
 * Signs the helper in if needed and has it claim the pairing code from the controller. The agent
 * may ask only on behalf of this account, so a pairing never serves another user.
 */
export const pairHelperWithController = async (
  mx: MatrixClient,
  target: HelperPairingTarget,
  runUia: UiaRunner,
  onStep?: (step: 'signing_in' | 'pairing') => void
): Promise<DesktopAccessPairResult> => {
  const access = requireDesktopAccess();
  const { controller, userId } = target;
  requireOwnAccount(mx, target.homeserver, userId);
  await ensureHelperSession(mx, access, target, runUia, () => onStep?.('signing_in'));
  onStep?.('pairing');
  return unwrapDesktopResult(
    await access.pair({
      controller: {
        userId: controller.user_id,
        deviceId: controller.device_id,
        ed25519: controller.ed25519,
      },
      allowedRequesterIds: [userId],
      allowedAgentNames: [target.agentName],
      code: target.code,
      cloudflareAccess: target.cloudflareAccess,
    })
  );
};

/** Applies the mode the user consented to, the last step of a pairing. */
export const finishHelperSetup = async (
  controllerKey: string,
  { agentName, mode, limits }: Pick<PairAgentParams, 'agentName' | 'mode' | 'limits'>
): Promise<DesktopAccessSnapshot> =>
  unwrapDesktopResult(
    await requireDesktopAccess().finishSetup({ controllerKey, agentName, mode, ...limits })
  );

/**
 * Gives one agent access to this Mac after the user's consent click: opens the setup authorization,
 * asks the agent for a setup offer over Olm, signs the helper in, has it claim the offer's code,
 * confirms the claimed helper device to the agent, and applies the consented mode. A second agent
 * pairs while the bridge runs.
 */
export const pairAgentOnThisMac = async (
  mx: MatrixClient,
  { agentUserId, agentName, mode, limits }: PairAgentParams,
  runUia: UiaRunner,
  onStep?: (step: DesktopPairingStep) => void,
  signal?: AbortSignal
): Promise<DesktopAccessSnapshot> => {
  await beginHelperSetup();
  onStep?.('requesting_offer');
  const { offer, controller } = await requestAgentSetupOffer(mx, agentUserId, agentName, signal);
  if (!offer.eligible) throw new Error(offer.error);
  requireOwnAccount(mx, offer.homeserver, offer.user_id);
  const resolvedAgentName = offer.agent_name;
  const target: HelperPairingTarget = {
    controller,
    agentName: resolvedAgentName,
    homeserver: offer.homeserver,
    userId: offer.user_id,
    code: offer.code,
    cloudflareAccess: offer.cloudflare_access,
  };
  const paired = await pairHelperWithController(mx, target, runUia, onStep);
  try {
    onStep?.('confirming');
    const claimed = {
      token: offer.code,
      verification: paired.verification,
      deviceId: paired.deviceId,
      deviceEd25519: paired.deviceEd25519,
    };
    const confirmed = await confirmAgentPairing(mx, controller, claimed, signal);
    if (!confirmed.ok) throw new Error(confirmed.error);
  } catch (error) {
    await requireDesktopAccess()
      .abortSetup(paired.controllerKey)
      .catch(() => undefined);
    throw error;
  }
  onStep?.('finishing');
  return finishHelperSetup(paired.controllerKey, {
    agentName: resolvedAgentName,
    mode,
    limits,
  });
};

/**
 * Takes an agent's access to this Mac away. The helper drops the controller first, which is what
 * ends the access; telling the agent to forget the helper is a courtesy an offline agent may miss.
 */
export const disconnectAgentFromThisMac = async (
  mx: MatrixClient,
  controllerKey: string,
  agentUserId: string,
  agentName: string
): Promise<DesktopAccessSnapshot> => {
  const snapshot = unwrapDesktopResult(
    await requireDesktopAccess().removeController(controllerKey)
  );
  await disconnectAgentPairing(mx, agentUserId, agentName, undefined, DISCONNECT_TIMEOUT_MS).catch(
    () => undefined
  );
  return snapshot;
};
