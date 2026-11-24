import type { CallMembership, MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc';

export const SCREEN_ONLY_MEMBER_KEY = 'chat.mindroom.screen_only';
export const SCREEN_PARENT_DEVICE_KEY = 'chat.mindroom.screen_parent_device_id';

/** The devices of a call, as a room shows them before and while one takes part. */
export type CallMember = {
  userId: string;
  deviceId: string;
  createdTs: number;
  screenOnly?: boolean;
  screenParentDeviceId?: string;
};

/** A membership's media identity on LiveKit, `<user id>:<device id>` for state-event memberships. */
export const membershipIdentity = (membership: Pick<CallMember, 'userId' | 'deviceId'>) =>
  `${membership.userId}:${membership.deviceId}`;

/** The session's unexpired memberships, oldest first, as plain records. */
export const activeMemberships = (session: Pick<MatrixRTCSession, 'memberships'>): CallMember[] =>
  session.memberships
    .filter((membership: CallMembership) => !membership.isExpired())
    .map((membership: CallMembership) => {
      const appData = membership.applicationData as Record<string, unknown> | undefined;
      const screenOnly = appData?.[SCREEN_ONLY_MEMBER_KEY] === true;
      const rawParent = appData?.[SCREEN_PARENT_DEVICE_KEY];
      const screenParentDeviceId =
        typeof rawParent === 'string' && rawParent ? rawParent : undefined;
      return {
        userId: membership.userId,
        deviceId: membership.deviceId,
        createdTs: membership.createdTs(),
        ...(screenOnly ? { screenOnly: true } : {}),
        ...(screenParentDeviceId ? { screenParentDeviceId } : {}),
      };
    });

/** The people in a call, each once however many devices they joined from, in join order. */
export const callUserIds = (members: CallMember[]): string[] => [
  ...new Set(members.map((member) => member.userId)),
];
