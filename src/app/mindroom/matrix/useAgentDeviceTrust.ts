import { useCallback, useEffect, useRef, useState } from 'react';
import { deviceSignedByOwner } from '../../utils/matrix-crypto';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAlive } from '../../hooks/useAlive';
import { useDeviceListChange } from '../../hooks/useDeviceList';
import { isMindroomAgentUserIdForViewer } from './agentIdentity';

/**
 * Pure classifier: a MindRoom agent presents a trustworthy device identity when
 * at least one of its devices is signed by the account's own self-signing key.
 * `null` entries (crypto could not report a status) are treated as not-signed.
 */
export const anyDeviceSignedByOwner = (statuses: Array<boolean | null>): boolean =>
  statuses.some((status) => status === true);

/**
 * Whether a MindRoom agent presents a cross-signed device identity.
 *
 * Returns true only for agent users on the viewer's own homeserver (per the
 * platform username convention plus a same-server check) that have at least
 * one device signed by the account's own self-signing key. This is the signal
 * that survives MSC4153 key-sharing: it does not require the local user to
 * have verified the agent (a deliberate non-goal), only that the agent
 * bootstrapped cross-signing (mindroom-nio D2). Non-agents, cross-homeserver
 * users, agents without cross-signing, and clients without crypto all resolve
 * to false.
 */
export const useAgentDeviceCrossSigned = (userId: string): boolean => {
  const mx = useMatrixClient();
  const alive = useAlive();
  const generationRef = useRef(0);
  const [crossSigned, setCrossSigned] = useState(false);

  const update = useCallback(async () => {
    // Bump a generation per invocation so that when several device-list events
    // fire in quick succession, only the latest run's result is committed —
    // an earlier run resolving late must not overwrite a newer one.
    generationRef.current += 1;
    const generation = generationRef.current;
    const commit = (value: boolean) => {
      if (alive() && generation === generationRef.current) setCrossSigned(value);
    };

    const crypto = mx.getCrypto();
    if (!crypto || !isMindroomAgentUserIdForViewer(userId, mx.getUserId() ?? undefined)) {
      commit(false);
      return;
    }

    try {
      const deviceMap = await crypto.getUserDeviceInfo([userId]);
      const deviceIds = Array.from(deviceMap.get(userId)?.keys() ?? []);
      const statuses = await Promise.all(
        deviceIds.map((deviceId) => deviceSignedByOwner(crypto, userId, deviceId))
      );
      commit(anyDeviceSignedByOwner(statuses));
    } catch {
      // Fail safe: hide the affordance if crypto cannot report device trust.
      commit(false);
    }
  }, [mx, userId, alive]);

  useEffect(() => {
    update();
  }, [update]);

  useDeviceListChange(
    useCallback(
      (userIds) => {
        if (userIds.includes(userId)) update();
      },
      [userId, update]
    )
  );

  return crossSigned;
};
