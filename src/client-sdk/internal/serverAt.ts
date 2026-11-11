// The `MindroomServer` of an account at a server URL, which `/server`'s hooks give plugins and
// `/fixtures` gives fixture pages. Not a subpath: only the SDK's own modules import it.
import type { MatrixClient } from 'matrix-js-sdk';
import {
  MindroomServerError,
  clientSessions,
  type ClientSessions,
} from '../../app/computer/clientSessions';
import type { MindroomServer } from '../server';

const request = async <T>(sessions: ClientSessions, path: string, init?: RequestInit) => {
  const response = await sessions.send(path, init);
  let body: unknown;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    if (response.ok) throw new MindroomServerError(`MindRoom answered ${path} without JSON.`, 0);
  }
  if (!response.ok) {
    throw new MindroomServerError(
      `MindRoom answered ${response.status} to ${path}.`,
      response.status,
      body
    );
  }
  return body as T;
};

const knownServers = new WeakMap<ClientSessions, MindroomServer>();

/**
 * The `MindroomServer` at `apiUrl`, over the account's one session there: one object for each
 * account and server, so a plugin may key work on it.
 */
export const serverAt = (mx: MatrixClient, apiUrl: string): MindroomServer => {
  const sessions = clientSessions(mx, apiUrl);
  const server: MindroomServer = knownServers.get(sessions) ?? {
    origin: apiUrl,
    request: <T>(path: string, init?: RequestInit) => request<T>(sessions, path, init),
    send: (path, init) => sessions.send(path, init),
    openSocket: (path) => sessions.openSocket(path),
    token: (options) => sessions.token(options),
  };
  knownServers.set(sessions, server);
  return server;
};
