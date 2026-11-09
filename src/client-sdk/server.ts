// `@mindroom/client-sdk/server`, the client SDK's subpath for plugins whose MindRoom plugin serves
// routes (docs/architecture.md "Client plugins"): the room's MindRoom server, which takes the
// plugin's requests and opens its websockets as the signed-in user, and the computers of the room's
// agents. Like `/core` it only grows, and each addition raises CLIENT_PLUGIN_API_VERSION in
// scripts/client-plugins.mjs.
import { useMemo, useRef } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  ComputerApiError,
  createComputerSession,
  type ComputerSessionClient,
} from '../app/computer/api';
import {
  MindroomServerError,
  clientSessions,
  tokenError,
  untilAborted,
  type ClientSessions,
} from '../app/computer/clientSessions';
import { useRoomAgentServers } from '../app/computer/useAgentServers';
import { useRoomComputer } from '../app/computer/useRoomComputer';
import { useRoomMindroomServer } from '../app/computer/useRoomMindroomServer';
import { useMatrixClient } from '../app/matrix/hooks/useMatrixClient';
import { useRoomMembers } from '../app/matrix/hooks/useRoomMembers';
import { requestAudienceOpenIdToken } from '../app/matrix/openidAudience';

export { ComputerApiError, MindroomServerError };
export type { ComputerSessionClient };
export type { ComputerStatus, ComputerStreamConnection } from '../app/computer/types';

/** A MindRoom server: the room's, which `useMindroomServer` gives, or an agent's own. */
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
   * Sends a request to `path` on the server as `request` does, asking for JSON unless `init`'s
   * headers name an `Accept`, never from the HTTP cache, and resolves with the answer's `Response`
   * whatever its type or status, such as an image a route serves. A 401 signs in again and sends
   * once more. Rejects as `request` does when there is no answer or the sign-in fails, and with a
   * `TypeError` for a path that leads to another origin before anything is sent.
   */
  send: (path: string, init?: RequestInit) => Promise<Response>;
  /**
   * Opens a websocket to `path` on the server (`wss:`, or `ws:` for an `http:` server) that signs
   * in as MindRoom's plugin websockets take it. Reconnecting is the plugin's: the server closes
   * with 4401 once the session ends, after which the next `openSocket` signs in again, and with
   * 1012 when the plugin reloads, 1008 once the user left the room, or 1013 while membership is
   * unavailable. A socket the server refused closes before it opens. Rejects as `request` does
   * when the sign-in fails, and for a path that leads to another origin.
   */
  openSocket: (path: string) => Promise<WebSocket>;
  /**
   * The signed-in user's session token, for a request to the server that `send` cannot make, such
   * as an upload that reports its progress through `XMLHttpRequest`, sent with `Authorization:
   * Bearer <token>`. It signs in when there is no session or it is about to run out.
   * Ask again for each request and never keep it. After a 401, ask again with `refused`, the token
   * the server refused, which signs in again, and send once more. `signal` stops the wait for a
   * sign-in. Rejects as `request` does when the sign-in fails.
   */
  token: (options?: { signal?: AbortSignal; refused?: string }) => Promise<string>;
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

const knownServers = new WeakMap<ClientSessions, MindroomServer>();

/**
 * The `MindroomServer` at `apiUrl`, over the account's one session there: one object for each
 * account and server, so a plugin may key work on it.
 */
const serverAt = (mx: MatrixClient, apiUrl: string): MindroomServer => {
  const sessions = clientSessions(mx, apiUrl);
  const known = knownServers.get(sessions);
  if (known) return known;
  const server: MindroomServer = {
    origin: apiUrl,
    request: <T>(path: string, init?: RequestInit) => request<T>(sessions, path, init),
    send: (path, init) => sessions.send(path, init),
    openSocket: (path) => sessions.openSocket(path),
    token: (options) => sessions.token(options),
  };
  knownServers.set(sessions, server);
  return server;
};

/** The `MindroomServer` at `apiUrl`, or undefined without one. */
const serverOrNone = (mx: MatrixClient, apiUrl: string | undefined) =>
  apiUrl ? serverAt(mx, apiUrl) : undefined;

/**
 * The MindRoom server of the room `roomId`, by the rule call transcripts use: the one the room's
 * agents published while the homeserver binds sign-in tokens to it, else the one `config.json`
 * names (`mindroom.computers.apiUrl`). Undefined in a room without a MindRoom agent, or without
 * either server. Every plugin and the app share one session with each server. Until the room's
 * members and the homeserver's answer are in, it can be undefined or the configured server and
 * change after; a plugin that signs in at once or tells the person there is no server takes
 * `useMindroomServerStatus`.
 */
export const useMindroomServer = (roomId: string): MindroomServer | undefined => {
  const mx = useMatrixClient();
  const { apiUrl } = useRoomMindroomServer(mx, roomId);
  return serverOrNone(mx, apiUrl);
};

/**
 * The room's MindRoom server as `useMindroomServer` gives it, `pending` with no `server` while the
 * room's members or the homeserver's answer on binding sign-in tokens are not in yet. Once both
 * are in, the server can still change, as when an agent that just joined publishes its own. A
 * check that could not reach the homeserver counts as an answer that it does not bind them, and a
 * member list that could not load as the members the client has. A room the client does not know
 * has no member list to wait for: once the homeserver answered, it has no server, and once the
 * client learns of the room, as by a join or an invite, it is `pending` again until the room's
 * members are in.
 */
export const useMindroomServerStatus = (
  roomId: string
): { server: MindroomServer | undefined; pending: boolean } => {
  const mx = useMatrixClient();
  const { apiUrl, pending } = useRoomMindroomServer(mx, roomId);
  return { server: serverOrNone(mx, pending ? undefined : apiUrl), pending };
};

/** An agent of the room with a computer, as `useRoomComputers` gives it. */
export type RoomComputer = {
  /** The agent's user ID. */
  userId: string;
  /** The agent's name in the room, or its user ID without one. */
  name: string;
  /**
   * The agent's own MindRoom server, the one `openSession` signs in to: with a computer server set
   * for every agent (the person's in Settings, else `mindroom.computers.apiUrl`), that one;
   * without one, the server the agent published, with a session for a token bound to it. In a
   * room whose agents publish different servers, it is the one for this agent's routes and
   * websockets, where `useMindroomServer` gives one server for the whole room. It shares the
   * account's session with that server with every caller that signs in there. It stays the same
   * object while the agent's server does, so a plugin may key work on it.
   */
  server: MindroomServer;
  /**
   * Opens a session on the agent's computer as the room's computer panel does, once: a sign-in
   * token for the computer's server, then a session for this room and agent, which starts in
   * `view` mode. Resolves with the session: its `status` (`state` `starting`, `ready` or
   * `stopped`, `mode` `view` or `control`), `refreshStatus()`, `createStream()` (the URL and
   * subprotocols of the screen's RFB websocket, which `control('take')` needs open), `control()`
   * with `take`, `release` or `stop`, and `dispose()`, which ends it on the server; each method
   * takes a `signal`. Rejects with `ComputerApiError`, `status` 0 when the homeserver could not
   * give a sign-in token, the server gave no answer or `signal` aborted, 403 when the homeserver
   * will not sign in there (it binds no tokens to a server the agent published), else the server's
   * refusal. Retrying, reconnecting a stream and ending a session the plugin no longer shows are
   * the plugin's. It stays the same function while the agent's server and the token's binding do.
   */
  openSession: (signal?: AbortSignal) => Promise<ComputerSessionClient>;
};

/**
 * A session on the computer of `agentUserId` at `serverUrl`, with a token bound to that server when
 * the agent published it (`discovered`).
 */
const openSession = async (
  mx: MatrixClient,
  roomId: string,
  agentUserId: string,
  serverUrl: string,
  discovered: boolean,
  signal?: AbortSignal
) => {
  if (signal?.aborted) throw new ComputerApiError('Computer request cancelled.', 0);
  const token = requestAudienceOpenIdToken(mx, serverUrl, { requireBinding: discovered });
  const openIdToken = await untilAborted(token, signal).catch((error: unknown) => {
    const refusal = tokenError(error);
    throw new ComputerApiError(refusal.message, refusal.status);
  });
  return createComputerSession({ apiUrl: serverUrl, agentUserId, openIdToken, roomId, signal });
};

/**
 * The agents of the room `roomId` with a computer, by the rule of the room's own computer button:
 * with a computer server set (the person's in Settings, else `mindroom.computers.apiUrl`), every
 * agent that joined but one whose MindRoom says it has none; without one, each agent that
 * published a computer, while the homeserver binds sign-in tokens. None once the person turned
 * computers off, and none in a room the client does not know.
 */
export const useRoomComputers = (roomId: string): RoomComputer[] => {
  const mx = useMatrixClient();
  const members = useRoomMembers(mx, roomId);
  const servers = useRoomAgentServers(mx.getRoom(roomId));
  const { agents, apiUrl } = useRoomComputer(members, servers, mx.getSafeUserId());
  // The last list's computers, by room, agent and binding, kept while their server is the same.
  const known = useRef(new Map<string, RoomComputer>());
  return useMemo(() => {
    const before = known.current;
    known.current = new Map();
    // An agent the room lists always has a server: its own, or the one set for every agent.
    if (!apiUrl) return [];
    return agents.map(({ userId, name, serverUrl }) => {
      const discovered = serverUrl !== undefined;
      const url = serverUrl ?? apiUrl;
      const server = serverAt(mx, url);
      const key = JSON.stringify([roomId, userId, discovered]);
      const kept = before.get(key);
      const computer =
        kept?.server !== server
          ? {
              userId,
              name,
              server,
              openSession: (signal?: AbortSignal) =>
                openSession(mx, roomId, userId, url, discovered, signal),
            }
          : kept.name === name
          ? kept
          : { ...kept, name };
      known.current.set(key, computer);
      return computer;
    });
  }, [agents, apiUrl, mx, roomId]);
};
