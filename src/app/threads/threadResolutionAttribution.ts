import type { Room } from 'matrix-js-sdk/lib/models/room';
import { getMxIdLocalPart } from '../matrix/matrix';
import { getMemberDisplayName } from '../matrix/room';

export const getThreadResolverDisplayName = (
  room: Room,
  userId: string | undefined
): string | undefined => {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId) return undefined;

  const memberDisplayName = getMemberDisplayName(room, normalizedUserId);
  return memberDisplayName?.trim()
    ? memberDisplayName
    : getMxIdLocalPart(normalizedUserId) ?? normalizedUserId;
};
