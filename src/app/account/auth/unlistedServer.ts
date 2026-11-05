import { createContext, useContext } from 'react';
import type { ClientConfig } from '../../config/useClientConfig';

// Single sign-on puts this tab's nonce in the address it hands the homeserver. A server the
// deployment does not list may be anyone's: it can read that nonce, send the browser on to the
// person's real homeserver with it, and receive the real login token when the client exchanges
// it at the server the sign-in started on. So a sign-in button for such a server first asks
// whether the person trusts it. Listed servers, and the default, start at once.

/** The server the sign-in pages start on when the deployment lists none. */
const FALLBACK_SERVER = 'mindroom.chat';

type ServerListConfig = Pick<ClientConfig, 'homeserverList' | 'defaultHomeserver'>;

/** The server the sign-in pages preselect: the configured default, else the first listed. */
export const deploymentDefaultServer = ({
  homeserverList,
  defaultHomeserver,
}: ServerListConfig): string =>
  homeserverList?.[defaultHomeserver ?? 0] ?? homeserverList?.[0] ?? FALLBACK_SERVER;

const sameServerName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether the deployment itself offers `server`: it is listed in `config.json`, or the default. */
export const isDeploymentServer = (config: ServerListConfig, server: string): boolean =>
  [...(config.homeserverList ?? []), deploymentDefaultServer(config)].some((listed) =>
    sameServerName(listed, server)
  );

/** The host a sign-in goes to, as the confirmation names it (IDN hosts in their xn-- form). */
export const signInHost = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
};

/**
 * Runs `start`, which leaves for the homeserver's single sign-on, once the person agrees; a
 * refusal drops it. Absent for a server the deployment offers, where buttons start at once.
 */
export type SsoStartCheck = (start: () => void) => void;

const ssoStartCheckContext = createContext<SsoStartCheck | undefined>(undefined);
ssoStartCheckContext.displayName = 'SsoStartCheck';

export const SsoStartCheckProvider = ssoStartCheckContext.Provider;

/** The check the sign-in layout sets for the server on screen. */
export const useSsoStartCheck = (): SsoStartCheck | undefined => useContext(ssoStartCheckContext);
