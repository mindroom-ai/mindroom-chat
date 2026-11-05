import { useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';

/** What the account's cross-signing says about its own sessions. */
export type OwnDeviceTrust = {
  /** The account has published cross-signing keys, so its sessions can be verified at all. */
  crossSigning: boolean;
  /** This session is signed by the account's self-signing key and that key is trusted here. */
  thisDeviceVerified: boolean;
  /**
   * The account's other sessions that have encryption keys, by device ID, and whether each is
   * verified. Only meaningful once this session is verified: before that, it trusts none of them.
   */
  otherDevices: ReadonlyMap<string, boolean>;
};

/** Crypto events after which any of the answers above may differ. */
const TRUST_EVENTS = [
  CryptoEvent.KeysChanged,
  CryptoEvent.UserTrustStatusChanged,
  CryptoEvent.DevicesUpdated,
] as const;

const readOwnDeviceTrust = async (client: MatrixClient): Promise<OwnDeviceTrust | undefined> => {
  const crypto = client.getCrypto();
  const userId = client.getUserId();
  const thisDeviceId = client.getDeviceId();
  if (!crypto || !userId || !thisDeviceId) return undefined;

  // Not `userHasCrossSigningKeys`: for our own account it queries the server on every call, and
  // its answer fires the device events this hook listens to, so it would never stop asking. It
  // would also race a cross-signing reset that is waiting for the password.
  const [status, thisStatus, deviceMap] = await Promise.all([
    crypto.getCrossSigningStatus(),
    crypto.getDeviceVerificationStatus(userId, thisDeviceId),
    crypto.getUserDeviceInfo([userId]),
  ]);
  const others = [...(deviceMap.get(userId)?.values() ?? [])].filter(
    (device) => device.deviceId !== thisDeviceId && !device.dehydrated
  );
  const statuses = await Promise.all(
    others.map((device) => crypto.getDeviceVerificationStatus(userId, device.deviceId))
  );
  const otherDevices = new Map(
    others.map((device, index) => [device.deviceId, statuses[index]?.crossSigningVerified === true])
  );
  return {
    crossSigning: status.publicKeysOnDevice,
    thisDeviceVerified: thisStatus?.crossSigningVerified === true,
    otherDevices,
  };
};

/**
 * The verification state of this account's sessions, read from the crypto store and read again
 * whenever keys, devices or trust change. `undefined` until the first answer, and without crypto.
 */
export const useOwnDeviceTrust = (): OwnDeviceTrust | undefined => {
  const client = useMatrixClient();
  const [trust, setTrust] = useState<OwnDeviceTrust>();

  useEffect(() => {
    setTrust(undefined);
    // Without crypto there is no trust to read and no event will ever change that.
    if (!client.getCrypto()) return undefined;
    let latest = 0;
    let mounted = true;
    const refresh = () => {
      latest += 1;
      const request = latest;
      readOwnDeviceTrust(client).then(
        (next) => {
          // A slower, older read must not overwrite a newer one.
          if (mounted && request === latest) setTrust(next);
        },
        () => undefined
      );
    };
    refresh();
    TRUST_EVENTS.forEach((event) => client.on(event, refresh));
    return () => {
      mounted = false;
      TRUST_EVENTS.forEach((event) => client.off(event, refresh));
    };
  }, [client]);

  return trust;
};

/** How many of the account's other sessions this verified session does not trust yet. */
export const countUnverifiedOtherDevices = (trust: OwnDeviceTrust | undefined): number => {
  if (!trust?.thisDeviceVerified) return 0;
  return [...trust.otherDevices.values()].filter((verified) => !verified).length;
};
