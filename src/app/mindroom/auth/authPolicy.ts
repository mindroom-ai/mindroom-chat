import type { ClientConfig } from '../../hooks/useClientConfig';

export const MINDROOM_HOMESERVER = 'mindroom.chat';
export const MINDROOM_TENANT_HOMESERVER_SUFFIX = '.matrix.mindroom.chat';

export const normalizeHomeserverName = (server: string): string =>
  server.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();

export const isMindroomHomeserver = (server: string): boolean => {
  const normalizedServer = normalizeHomeserverName(server);
  return (
    normalizedServer === MINDROOM_HOMESERVER ||
    normalizedServer.endsWith(MINDROOM_TENANT_HOMESERVER_SUFFIX)
  );
};

export const shouldDisablePasswordLogin = (
  server: string,
  authConfig: ClientConfig['auth'] | undefined
): boolean => authConfig?.disablePasswordLogin === true || isMindroomHomeserver(server);

export const shouldUseSsoOnlyRegistration = (server: string): boolean =>
  isMindroomHomeserver(server);
