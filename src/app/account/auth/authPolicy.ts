import type { ClientConfig } from '../../config/useClientConfig';

const MINDROOM_HOMESERVER = 'mindroom.chat';

// Only the hostname identifies a server; a base URL's path, query or userinfo must not count.
export const normalizeHomeserverName = (server: string): string => {
  try {
    return new URL(/^https?:\/\//i.test(server) ? server : `https://${server}`).hostname;
  } catch {
    return '';
  }
};

const isPrimaryMindroomHomeserver = (server: string): boolean =>
  normalizeHomeserverName(server) === MINDROOM_HOMESERVER;

export const shouldDisablePasswordLogin = (
  server: string,
  authConfig: ClientConfig['auth'] | undefined
): boolean => authConfig?.disablePasswordLogin === true || isPrimaryMindroomHomeserver(server);

export const shouldUseSsoOnlyRegistration = (server: string): boolean =>
  isPrimaryMindroomHomeserver(server);

export const shouldRequireAppleProvider = (
  server: string,
  authConfig: ClientConfig['auth'] | undefined
): boolean => authConfig?.requireAppleProvider === true && isPrimaryMindroomHomeserver(server);
