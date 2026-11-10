import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { resolveComputerApiUrl } from './api';

/** Each MindRoom agent's server in a room, as state keyed by the agent's own user ID. */
export const MINDROOM_SERVER_EVENT = 'io.mindroom.server';

export type AgentServer = {
  agentUserId: string;
  apiUrl: string;
  computer: boolean;
  ts: number;
};

/** Read one agent's server from state `agentRoomState` already checked the agent published about itself. */
export const parseAgentServer = (event: MatrixEvent): AgentServer | undefined => {
  const { api_origin: origin, computer } = event.getContent();
  const apiUrl = typeof origin === 'string' ? resolveComputerApiUrl(origin) : undefined;
  if (!apiUrl) return undefined;
  return {
    agentUserId: event.getSender()!,
    apiUrl,
    computer: computer === true,
    ts: event.getTs(),
  };
};

/** The servers the agents' state names, newest first. */
export const selectAgentServers = (events: MatrixEvent[]): AgentServer[] =>
  events.flatMap((event) => parseAgentServer(event) ?? []).sort((a, b) => b.ts - a.ts);

/** Whether an origin is this device itself, which a published server must not be for a phone. */
export const isLoopbackOrigin = (origin: string): boolean => {
  // A trailing dot names the same host, as in localhost.
  const hostname = new URL(origin).hostname.replace(/\.$/, '');
  // URL parsing writes an IPv4-mapped loopback such as [::ffff:127.0.0.1] as [::ffff:7f..].
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname.startsWith('[::ffff:7f') ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
};

/** Each distinct server origin, newest first. */
export const distinctServerUrls = (servers: AgentServer[]): string[] => [
  ...new Set([...servers].sort((a, b) => b.ts - a.ts).map((server) => server.apiUrl)),
];

/**
 * The origins a published server must be on to count as one: the configured server
 * (`mindroom.computers.apiUrl`) and those `mindroom.computers.trustedApiUrls` lists, since any
 * account on the homeserver named like an agent can publish one. Undefined while neither is set,
 * as in a client for any deployment, which has nothing to check a published origin against.
 */
export const trustedServerOrigins = (
  computers: { apiUrl?: string; trustedApiUrls?: string[] } | undefined
): Set<string> | undefined => {
  const listed = computers?.trustedApiUrls;
  const apiUrl = resolveComputerApiUrl(computers?.apiUrl);
  if (!apiUrl && !Array.isArray(listed)) return undefined;
  const urls: unknown[] = [apiUrl, ...(Array.isArray(listed) ? listed : [])];
  return new Set(
    urls.flatMap((url) => (typeof url === 'string' && resolveComputerApiUrl(url)) || [])
  );
};

let warnedUnchecked = false;

/** The published servers on the trusted list; all of them, with a warning, without a list. */
export const trustedServers = (
  servers: AgentServer[],
  trusted: Set<string> | undefined
): AgentServer[] => {
  if (trusted) return servers.filter((server) => trusted.has(server.apiUrl));
  if (servers.length > 0 && !warnedUnchecked) {
    warnedUnchecked = true;
    console.warn(
      'MindRoom servers that agents publish are used unchecked: config.json sets neither mindroom.computers.apiUrl nor mindroom.computers.trustedApiUrls.'
    );
  }
  return servers;
};
