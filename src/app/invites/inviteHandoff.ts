import { matchPath } from 'react-router-dom';
import { INVITE_PATH } from '../routes/paths';

// An invite link opened signed out waits in this tab, as `<expiry>#<fragment>`, while its visitor
// signs in; the return path that sign-in keeps in localStorage is `/invite/` alone.
const STORAGE_KEY = 'mindroom.invite_link';
const MAX_AGE_MS = 15 * 60 * 1000;
/** The return path to save for `path`, after holding an invite link's fragment in this tab. */
export const holdInviteFragment = (path: string): string => {
  const [route = '', fragment] = path.split('#', 2);
  if (!fragment || !matchPath(INVITE_PATH, route.split('?')[0] ?? '')) return path;
  try {
    sessionStorage.setItem(STORAGE_KEY, `${Date.now() + MAX_AGE_MS}#${fragment}`);
  } catch {
    // Without session storage the visitor opens the link from the mail again.
  }
  return route;
};
/** The held fragment, read once: removed on read, and empty when missing or expired. */
export const takeInviteFragment = (): string => {
  const [expiresAt, fragment] = (sessionStorage.getItem(STORAGE_KEY) ?? '').split('#', 2);
  sessionStorage.removeItem(STORAGE_KEY);
  return fragment && Number(expiresAt) > Date.now() ? `#${fragment}` : '';
};
