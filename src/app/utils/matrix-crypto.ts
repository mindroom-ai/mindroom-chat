import type { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';

/**
 * Whether the device is signed by its owner's self-signing key, which is how a MindRoom agent
 * vouches for its own devices. This is not verification by the local user. `null` when crypto
 * has no status for the device (unknown device or no crypto).
 */
export const deviceSignedByOwner = async (
  crypto: Pick<CryptoApi, 'getDeviceVerificationStatus'>,
  userId: string,
  deviceId: string
): Promise<boolean | null> => {
  const status = await crypto.getDeviceVerificationStatus(userId, deviceId);
  if (!status) return null;
  return status.signedByOwner === true;
};
