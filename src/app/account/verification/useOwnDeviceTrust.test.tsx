// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import { countUnverifiedOtherDevices, useOwnDeviceTrust } from './useOwnDeviceTrust';

const client = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client.current }));

const USER = '@alice:example.org';

type Fixture = {
  crossSigning: boolean;
  verified: Record<string, boolean>;
  devices: { deviceId: string; dehydrated?: boolean }[];
};

const fakeClient = (fixture: Fixture) => {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    getUserId: () => USER,
    getDeviceId: () => 'LAPTOP',
    getCrypto: () => ({
      getCrossSigningStatus: async () => ({ publicKeysOnDevice: fixture.crossSigning }),
      getDeviceVerificationStatus: async (_user: string, deviceId: string) =>
        deviceId in fixture.verified ? { crossSigningVerified: fixture.verified[deviceId] } : null,
      getUserDeviceInfo: async () =>
        new Map([
          [
            USER,
            new Map(
              fixture.devices.map((device) => [device.deviceId, { dehydrated: false, ...device }])
            ),
          ],
        ]),
    }),
  });
};

const settle = () => act(async () => undefined);

describe('useOwnDeviceTrust', () => {
  it('reports this session and the other sessions with keys', async () => {
    client.current = fakeClient({
      crossSigning: true,
      verified: { LAPTOP: true, PHONE: false, TABLET: true },
      devices: [
        { deviceId: 'LAPTOP' },
        { deviceId: 'PHONE' },
        { deviceId: 'TABLET' },
        { deviceId: 'DEHYDRATED', dehydrated: true },
      ],
    });
    const { result } = renderHook(() => useOwnDeviceTrust());
    await settle();

    expect(result.current?.crossSigning).toBe(true);
    expect(result.current?.thisDeviceVerified).toBe(true);
    expect([...(result.current?.otherDevices ?? [])]).toEqual([
      ['PHONE', false],
      ['TABLET', true],
    ]);
    expect(countUnverifiedOtherDevices(result.current)).toBe(1);
  });

  it('reads again when crypto reports a trust change', async () => {
    const fixture: Fixture = {
      crossSigning: true,
      verified: { LAPTOP: false },
      devices: [{ deviceId: 'LAPTOP' }],
    };
    const fake = fakeClient(fixture);
    client.current = fake;
    const { result } = renderHook(() => useOwnDeviceTrust());
    await settle();
    expect(result.current?.thisDeviceVerified).toBe(false);

    fixture.verified.LAPTOP = true;
    await act(async () => {
      fake.emit(CryptoEvent.UserTrustStatusChanged, USER);
    });
    expect(result.current?.thisDeviceVerified).toBe(true);
  });

  it('counts no unverified sessions while this session is itself unverified', () => {
    expect(
      countUnverifiedOtherDevices({
        crossSigning: true,
        thisDeviceVerified: false,
        otherDevices: new Map([['PHONE', false]]),
      })
    ).toBe(0);
    expect(countUnverifiedOtherDevices(undefined)).toBe(0);
  });
});
