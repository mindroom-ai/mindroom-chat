import type { CallMembership, MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc';

/** The devices of a call, as a room shows them before and while one takes part. */
export type CallMember = { userId: string; deviceId: string; createdTs: number };

/** A membership's media identity on LiveKit, `<user id>:<device id>` for state-event memberships. */
export const membershipIdentity = (membership: Pick<CallMember, 'userId' | 'deviceId'>) =>
  `${membership.userId}:${membership.deviceId}`;

/** The session's unexpired memberships, oldest first, as plain records. */
export const activeMemberships = (session: Pick<MatrixRTCSession, 'memberships'>): CallMember[] =>
  session.memberships
    .filter((membership: CallMembership) => !membership.isExpired())
    .map((membership: CallMembership) => ({
      userId: membership.userId,
      deviceId: membership.deviceId,
      createdTs: membership.createdTs(),
    }));

/** The people in a call, each once however many devices they joined from, in join order. */
export const callUserIds = (members: CallMember[]): string[] => [
  ...new Set(members.map((member) => member.userId)),
];
