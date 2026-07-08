import { useCallback, useEffect, useState } from 'react';
import { deviceSignedByOwner } from '../../utils/matrix-crypto';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAlive } from '../../hooks/useAlive';
import { useDeviceListChange } from '../../hooks/useDeviceList';
import { isMindroomAgentUserId } from './agentIdentity';

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
 * Returns true only for agent users (per the platform username convention) that
 * have at least one device signed by the account's own self-signing key. This is
 * the signal that survives MSC4153 key-sharing: it does not require the local
 * user to have verified the agent (a deliberate non-goal), only that the agent
 * bootstrapped cross-signing (mindroom-nio D2). Non-agents, agents without
 * cross-signing, and clients without crypto all resolve to false.
 */
export const useAgentDeviceCrossSigned = (userId: string): boolean => {
  const mx = useMatrixClient();
  const alive = useAlive();
  const [crossSigned, setCrossSigned] = useState(false);

  const update = useCallback(async () => {
    const crypto = mx.getCrypto();
    if (!crypto || !isMindroomAgentUserId(userId)) {
      if (alive()) setCrossSigned(false);
      return;
    }

    try {
      const deviceMap = await crypto.getUserDeviceInfo([userId]);
      const deviceIds = Array.from(deviceMap.get(userId)?.keys() ?? []);
      const statuses = await Promise.all(
        deviceIds.map((deviceId) => deviceSignedByOwner(crypto, userId, deviceId))
      );
      if (alive()) setCrossSigned(anyDeviceSignedByOwner(statuses));
    } catch {
      // Fail safe: hide the affordance if crypto cannot report device trust.
      if (alive()) setCrossSigned(false);
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
