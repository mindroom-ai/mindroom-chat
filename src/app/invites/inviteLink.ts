import { isUserId } from '../matrix/matrix';
import { stripBidiControls } from '../rich-text/linkDestination';

/** What a mailed invitation link carries: the router to claim it from and the single-use code. */
export type InviteLink = { routerId: string; code: string };

/** Parses `#r=<router ID>&c=<code>`; undefined unless both are present and well formed. */
export const parseInviteFragment = (hash: string): InviteLink | undefined => {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const routerId = params.get('r');
  const code = params.get('c');
  // A direction control could show the router's server name in another order than it is.
  if (!routerId || !isUserId(routerId) || stripBidiControls(routerId) !== routerId)
    return undefined;
  if (!code || code.length > 128) return undefined;
  return { routerId, code };
};
