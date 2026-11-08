// `@mindroom/client-sdk/server`, the client SDK's subpath for plugins whose MindRoom plugin serves
// routes (docs/architecture.md "Client plugins"): the room's MindRoom server, which takes the
// plugin's requests and opens its websockets as the signed-in user. Like `/core` it only grows, and
// each addition raises CLIENT_PLUGIN_API_VERSION in scripts/client-plugins.mjs.
import { useMemo } from 'react';
import {
  MindroomServerError,
  clientSessions,
  type ClientSessions,
} from '../app/computer/clientSessions';
import { useRoomMindroomServer } from '../app/computer/useRoomMindroomServer';
import { useMatrixClient } from '../app/matrix/hooks/useMatrixClient';

export { MindroomServerError };

/** A room's MindRoom server, which `useMindroomServer` gives. */
export type MindroomServer = {
  /** The server's origin, such as `https://mindroom.example.org`. */
  origin: string;
  /**
   * Sends a request to `path` on the server, such as `/api/plugins/<name>/rooms/<room ID>/hello`,
   * with the signed-in user's session as bearer and no cookies, and resolves with the answer's
   * JSON, or undefined for an empty answer. Rejects with `MindroomServerError`: `status` 0 for no
   * answer or one that is not JSON, else the refusal's status and its parsed `body`. A path that
   * leads to another origin rejects with a `TypeError` before anything is sent.
   */
  request: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
  /**
   * Opens a websocket to `path` on the server (`wss:`, or `ws:` for an `http:` server) that signs
   * in as MindRoom's plugin websockets take it. Reconnecting is the plugin's: the server closes
   * with 4401 once the session ends, after which the next `openSocket` signs in again, and with
   * 1012 when the plugin reloads, 1008 once the user left the room, or 1013 while membership is
   * unavailable. A socket the server refused closes before it opens.
   */
  openSocket: (path: string) => Promise<WebSocket>;
};

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

/**
 * The MindRoom server of the room `roomId`, by the rule call transcripts use: the one the room's
 * agents published while the homeserver binds sign-in tokens to it, else the one `config.json`
 * names (`mindroom.computers.apiUrl`). Undefined in a room without a MindRoom agent, or without
 * either server. Every plugin and the app share one session with each server.
 */
export const useMindroomServer = (roomId: string): MindroomServer | undefined => {
  const mx = useMatrixClient();
  const { apiUrl, discovered } = useRoomMindroomServer(mx, roomId);
  return useMemo(() => {
    if (!apiUrl) return undefined;
    const sessions = clientSessions(mx, apiUrl, discovered);
    return {
      origin: apiUrl,
      request: <T>(path: string, init?: RequestInit) => request<T>(sessions, path, init),
      openSocket: (path) => sessions.openSocket(path),
    };
  }, [apiUrl, discovered, mx]);
};
