import type { ClientConfig } from '../../hooks/useClientConfig';

export const MINDROOM_HOMESERVER = 'mindroom.chat';

export const normalizeHomeserverName = (server: string): string =>
  server.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();

export const isMindroomHomeserver = (server: string): boolean =>
  normalizeHomeserverName(server) === MINDROOM_HOMESERVER;

export const shouldDisablePasswordLogin = (
  server: string,
  authConfig: ClientConfig['auth'] | undefined
): boolean => authConfig?.disablePasswordLogin === true || isMindroomHomeserver(server);

export const shouldUseSsoOnlyRegistration = (server: string): boolean =>
  isMindroomHomeserver(server);

