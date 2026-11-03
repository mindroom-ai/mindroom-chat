import { generatePath, matchPath } from 'react-router-dom';
import { LOGIN_PATH, REGISTER_PATH, RESET_PASSWORD_PATH } from '../paths';

type AuthRoutePathOptions = {
  /** Pathname of the auth route being shown, such as `/login/` or `/register/matrix.org/`. */
  pathname: string;
  search?: string;
  hash?: string;
  /** Whether the server allows registration; register routes fall back to login otherwise. */
  registrationAllowed: boolean;
  /** Homeserver the route should point at. */
  server: string;
};

const AUTH_PATHS = [LOGIN_PATH, REGISTER_PATH, RESET_PASSWORD_PATH];

const resolveAuthPattern = (pathname: string, registrationAllowed: boolean): string => {
  const pattern =
    AUTH_PATHS.find((path) => matchPath({ path, end: true }, pathname) !== null) ?? LOGIN_PATH;
  if (pattern === REGISTER_PATH && !registrationAllowed) return LOGIN_PATH;
  return pattern;
};

/**
 * Builds the auth route for `server` while keeping the current auth page,
 * its search parameters (such as add-account), and its hash.
 */
export const buildAuthRoutePath = ({
  pathname,
  search = '',
  hash = '',
  registrationAllowed,
  server,
}: AuthRoutePathOptions): string => {
  const pattern = resolveAuthPattern(pathname, registrationAllowed);
  const path = generatePath(pattern, { server: encodeURIComponent(server) });
  return `${path}${search}${hash}`;
};
