import { useCallback, useEffect, useRef, useState } from 'react';
import { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';
import { deviceSignedByOwner } from '../../utils/matrix-crypto';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAlive } from '../../hooks/useAlive';
import { useDeviceListChange } from '../../hooks/useDeviceList';
import { isMindroomAgentUserIdForViewer } from './agentIdentity';

/**
 * Pure classifier: a MindRoom agent presents a trustworthy device identity when
 * it has at least one device AND every device is signed by the account's own
 * self-signing key. `null` entries (crypto could not report a status) count as
 * NOT signed — fail-safe — so a rogue second device on a leaked-password
 * session cannot ride behind a green shield while MSC4153 key-sharing
 * exclusion is not yet active in this client (FORK_CHANGES.md D7.5).
 */
export const allDevicesSignedByOwner = (statuses: Array<boolean | null>): boolean =>
  statuses.length > 0 && statuses.every((status) => status === true);

/**
 * Enumerate a user's devices via the crypto API and return each device's
 * `signedByOwner` status (`null` when crypto cannot report). Exported so the
 * per-device field choice can be pinned in tests: a swap to
 * `crossSigningVerified` would type-check and slip through a classifier-only
 * suite while silently breaking the affordance for un-verified agents.
 */
export const collectAgentDeviceSignatures = async (
  crypto: CryptoApi,
  userId: string
): Promise<Array<boolean | null>> => {
  const deviceMap = await crypto.getUserDeviceInfo([userId]);
  const deviceIds = Array.from(deviceMap.get(userId)?.keys() ?? []);
  return Promise.all(deviceIds.map((deviceId) => deviceSignedByOwner(crypto, userId, deviceId)));
};

/**
 * Module-level trust cache shared across every mounted
 * `useAgentDeviceCrossSigned`. Each agent userId is looked up once (a member
 * row and its profile card, or a drawer scroll re-mount, all reuse the same
 * in-flight promise), and invalidation on `DevicesUpdated` still triggers a
 * fresh fetch. Entries hold either the resolved boolean or the in-flight
 * promise so concurrent callers coalesce; a resolved value only commits to
 * the cache while the entry still points at the promise that produced it,
 * so an invalidation racing a fetch does not leak stale data.
 */
type CacheEntry = { value: boolean } | Promise<boolean>;
const agentTrustCache = new Map<string, CacheEntry>();

const isPromise = (entry: CacheEntry): entry is Promise<boolean> => 'then' in entry;

/**
 * Drop the cached trust result for a userId so the next lookup re-fetches.
 * Exported for tests; the hook itself invalidates from its `DevicesUpdated`
 * listener before scheduling a re-fetch.
 */
export const invalidateAgentDeviceTrust = (userId: string): void => {
  agentTrustCache.delete(userId);
};

export const getOrFetchAgentTrust = (
  userId: string,
  fetcher: () => Promise<boolean>
): Promise<boolean> => {
  const existing = agentTrustCache.get(userId);
  if (existing) return isPromise(existing) ? existing : Promise.resolve(existing.value);

  const promise = fetcher().then(
    (value) => {
      // Only commit if invalidation (or a newer fetch) has not raced past us.
      if (agentTrustCache.get(userId) === promise) agentTrustCache.set(userId, { value });
      return value;
    },
    (error) => {
      if (agentTrustCache.get(userId) === promise) agentTrustCache.delete(userId);
      throw error;
    }
  );
  agentTrustCache.set(userId, promise);
  return promise;
};

/**
 * Whether a MindRoom agent presents a cross-signed device identity.
 *
 * Returns true only for agent users on the viewer's own homeserver (per the
 * platform username convention plus a same-server check) whose devices are ALL
 * signed by the account's own self-signing key. This is the signal that
 * survives MSC4153 key-sharing: it does not require the local user to have
 * verified the agent (a deliberate non-goal), only that the agent bootstrapped
 * cross-signing (mindroom-nio D2). Non-agents, cross-homeserver users, agents
 * with any un-cross-signed device, and clients without crypto all resolve to
 * false.
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
      const trusted = await getOrFetchAgentTrust(userId, async () =>
        allDevicesSignedByOwner(await collectAgentDeviceSignatures(crypto, userId))
      );
      commit(trusted);
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
        if (userIds.includes(userId)) {
          // Drop the shared cache entry BEFORE scheduling the re-fetch so
          // this and every sibling hook coalesce onto a single fresh lookup.
          invalidateAgentDeviceTrust(userId);
          update();
        }
      },
      [userId, update]
    )
  );

  return crossSigned;
};
