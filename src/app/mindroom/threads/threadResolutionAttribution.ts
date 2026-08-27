import type { Room } from 'matrix-js-sdk/lib/models/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import { getMemberDisplayName } from '../../utils/room';

export const getThreadResolverDisplayName = (
  room: Room,
  userId: string | undefined
): string | undefined =>
  userId ? getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId : undefined;
