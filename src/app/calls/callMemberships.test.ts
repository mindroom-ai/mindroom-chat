import { describe, expect, it } from 'vitest';
import type { CallMembership, MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc';
import { activeMemberships, callUserIds, membershipIdentity } from './callMemberships';

const membership = (userId: string, deviceId: string, createdTs: number, expired = false) =>
  ({
    userId,
    deviceId,
    createdTs: () => createdTs,
    isExpired: () => expired,
  }) as unknown as CallMembership;

describe('call memberships', () => {
  const session = {
    memberships: [
      membership('@alice:example.org', 'PHONE', 10),
      membership('@bob:example.org', 'LAPTOP', 20, true),
      membership('@alice:example.org', 'LAPTOP', 30),
      membership('@carol:example.org', 'WEB', 40),
    ],
  } as unknown as MatrixRTCSession;

  it('keeps the unexpired devices in join order', () => {
    expect(activeMemberships(session)).toEqual([
      { userId: '@alice:example.org', deviceId: 'PHONE', createdTs: 10 },
      { userId: '@alice:example.org', deviceId: 'LAPTOP', createdTs: 30 },
      { userId: '@carol:example.org', deviceId: 'WEB', createdTs: 40 },
    ]);
  });

  it('counts each person once', () => {
    expect(callUserIds(activeMemberships(session))).toEqual([
      '@alice:example.org',
      '@carol:example.org',
    ]);
  });

  it('names a device by the LiveKit identity the authorization service gives it', () => {
    expect(membershipIdentity({ userId: '@alice:example.org', deviceId: 'PHONE' })).toBe(
      '@alice:example.org:PHONE'
    );
  });

  it('reads screen-only companion metadata from applicationData', () => {
    const companion = {
      userId: '@alice:example.com',
      deviceId: 'IPHONE-screen',
      createdTs: () => 50,
      isExpired: () => false,
      applicationData: {
        type: 'm.call',
        'chat.mindroom.screen_only': true,
        'chat.mindroom.screen_parent_device_id': 'IPHONE',
      },
    } as unknown as CallMembership;
    expect(activeMemberships({ memberships: [companion] })).toEqual([
      {
        userId: '@alice:example.com',
        deviceId: 'IPHONE-screen',
        createdTs: 50,
        screenOnly: true,
        screenParentDeviceId: 'IPHONE',
      },
    ]);
  });
});
