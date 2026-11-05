import { generatePath, matchPath } from 'react-router-dom';
import { LOGIN_PATH, REGISTER_PATH, RESET_PASSWORD_PATH } from '../../routes/paths';

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

/**
 * The homeserver to sign in to. A server named in the URL is used only when
 * the user could have picked it: on a locked deployment only listed servers
 * are accepted, so a crafted link cannot send credentials elsewhere.
 */
export const resolveAuthServer = (
  requested: string | undefined,
  defaultServer: string,
  locked: boolean,
  homeserverList: readonly string[] | undefined
): string => {
  const server = requested?.trim();
  if (!server) return defaultServer;
  if (!locked) return server;
  const normalized = server.toLowerCase();
  return homeserverList?.find((item) => item.toLowerCase() === normalized) ?? defaultServer;
};

type ServerChoiceConfig = {
  homeserverList?: readonly string[];
  allowCustomHomeservers?: boolean;
  auth?: { hideServerPickerWhenSingle?: boolean };
};

/**
 * Whether the deployment pins sign-in to its configured homeservers: custom servers are off, or
 * the picker is hidden because only one server is listed.
 */
export const isServerChoiceLocked = ({
  homeserverList,
  allowCustomHomeservers,
  auth,
}: ServerChoiceConfig): boolean =>
  allowCustomHomeservers === false ||
  (auth?.hideServerPickerWhenSingle === true && (homeserverList?.length ?? 0) === 1);

/** Whether a sign-in may go to `server`: any server, or one of the listed ones when locked. */
export const isServerChoiceAllowed = (config: ServerChoiceConfig, server: string): boolean =>
  !isServerChoiceLocked(config) ||
  (config.homeserverList ?? []).some((item) => item.toLowerCase() === server.toLowerCase());
