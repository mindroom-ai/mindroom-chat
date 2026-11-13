import { describe, expect, it } from 'vitest';
import { canRenderRoutedRoom, isJoinedRoom, shouldDeferRoomRouteFallback } from './routeVisibility';
import { Membership } from '../matrix/types/room';

const makeRoom = (
  {
    roomId = '!room:example.org',
    membership = Membership.Join,
  }: {
    roomId?: string;
    membership?: Membership;
  } = {}
) =>
  ({
    roomId,
    getMyMembership: () => membership,
  }) as const;

describe('routeVisibility', () => {
  it('treats SDK-joined rooms as renderable even before route lists catch up', () => {
    expect(canRenderRoutedRoom(makeRoom({ membership: Membership.Join }), [])).toBe(true);
  });

  it('does not treat invited rooms as renderable without route membership', () => {
    expect(canRenderRoutedRoom(makeRoom({ membership: Membership.Invite }), [])).toBe(false);
  });

  it('detects joined membership from the SDK room object', () => {
    expect(isJoinedRoom(makeRoom({ membership: Membership.Join }))).toBe(true);
    expect(isJoinedRoom(makeRoom({ membership: Membership.Leave }))).toBe(false);
    expect(isJoinedRoom(undefined)).toBe(false);
  });

  it('defers room fallbacks until initial sync has completed', () => {
    expect(
      shouldDeferRoomRouteFallback({
        hasCompletedInitialSync: false,
        isResolvingAlias: false,
        room: undefined,
        routedRoomIds: [],
      })
    ).toBe(true);

    expect(
      shouldDeferRoomRouteFallback({
        hasCompletedInitialSync: true,
        isResolvingAlias: false,
        room: undefined,
        routedRoomIds: [],
      })
    ).toBe(false);
  });
});
