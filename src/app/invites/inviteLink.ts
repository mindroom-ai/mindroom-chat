import { isUserId } from '../matrix/matrix';
import { stripBidiControls } from '../rich-text/linkDestination';
import { readInviteFragment } from '../../boot/inviteFragment';

/** What a mailed invitation link carries: the router to claim it from and the single-use code. */
export type InviteLink = { routerId: string; code: string };

/** Parses `#r=<router ID>&c=<code>`; undefined unless both are present and well formed. */
export const parseInviteFragment = (hash: string): InviteLink | undefined => {
  const { routerId, code } = readInviteFragment(hash);
  // A direction control could show the router's server name in another order than it is.
  const valid = !!routerId && isUserId(routerId) && stripBidiControls(routerId) === routerId;
  return valid && code && code.length <= 128 ? { routerId, code } : undefined;
};
