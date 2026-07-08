import { describe, expect, it, vi } from 'vitest';
import { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';
import { allDevicesSignedByOwner, collectAgentDeviceSignatures } from './useAgentDeviceTrust';

const cryptoWithDevices = (
  userId: string,
  devices: Record<string, Record<string, unknown> | null>
): CryptoApi => {
  const deviceMap = new Map<string, Map<string, unknown>>([
    [userId, new Map(Object.keys(devices).map((deviceId) => [deviceId, {}]))],
  ]);
  return {
    getUserDeviceInfo: vi.fn(async () => deviceMap),
    getDeviceVerificationStatus: vi.fn(async (u: string, d: string) => devices[d]),
  } as unknown as CryptoApi;
};

describe('allDevicesSignedByOwner', () => {
  it('is true only when the list is non-empty and every device is signed', () => {
    expect(allDevicesSignedByOwner([true])).toBe(true);
    expect(allDevicesSignedByOwner([true, true])).toBe(true);
  });

  it('is false when any device is not signed (including a leaked rogue second device)', () => {
    expect(allDevicesSignedByOwner([true, false])).toBe(false);
    expect(allDevicesSignedByOwner([false, true])).toBe(false);
    expect(allDevicesSignedByOwner([false])).toBe(false);
  });

  it('treats an unreportable status (null) as not signed — fail safe', () => {
    expect(allDevicesSignedByOwner([null])).toBe(false);
    expect(allDevicesSignedByOwner([true, null])).toBe(false);
    expect(allDevicesSignedByOwner([null, true])).toBe(false);
  });

  it('is false when the user has no devices', () => {
    expect(allDevicesSignedByOwner([])).toBe(false);
  });
});

describe('collectAgentDeviceSignatures', () => {
  it('selects signedByOwner (not crossSigningVerified) — pinning the field choice', async () => {
    // A swap to `crossSigningVerified` would type-check and pass a classifier-
    // only suite while silently making the badge never show for bots the local
    // user has not verified. This test proves the pipeline reads the right
    // field: signedByOwner=true (bot bootstrapped cross-signing) counts as
    // signed even when crossSigningVerified=false (local user did no SAS).
    const crypto = cryptoWithDevices('@mindroom_code:example.org', {
      DEV1: { signedByOwner: true, crossSigningVerified: false },
    });

    const statuses = await collectAgentDeviceSignatures(crypto, '@mindroom_code:example.org');

    expect(statuses).toEqual([true]);
  });

  it('returns each device status independently, in device-id order', async () => {
    const crypto = cryptoWithDevices('@mindroom_code:example.org', {
      DEV1: { signedByOwner: true, crossSigningVerified: false },
      DEV2: { signedByOwner: false, crossSigningVerified: true },
    });

    const statuses = await collectAgentDeviceSignatures(crypto, '@mindroom_code:example.org');

    expect(statuses).toEqual([true, false]);
  });

  it('reports null for devices with no verification status', async () => {
    const crypto = cryptoWithDevices('@mindroom_code:example.org', {
      DEV1: null,
    });

    const statuses = await collectAgentDeviceSignatures(crypto, '@mindroom_code:example.org');

    expect(statuses).toEqual([null]);
  });

  it('returns an empty list when the user has no devices', async () => {
    const crypto = {
      getUserDeviceInfo: vi.fn(async () => new Map()),
      getDeviceVerificationStatus: vi.fn(),
    } as unknown as CryptoApi;

    const statuses = await collectAgentDeviceSignatures(crypto, '@mindroom_code:example.org');

    expect(statuses).toEqual([]);
  });

  it('propagates crypto errors so the caller can fail safe', async () => {
    const crypto = {
      getUserDeviceInfo: vi.fn(async () => {
        throw new Error('crypto down');
      }),
      getDeviceVerificationStatus: vi.fn(),
    } as unknown as CryptoApi;

    await expect(
      collectAgentDeviceSignatures(crypto, '@mindroom_code:example.org')
    ).rejects.toThrow('crypto down');
  });
});
