import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { resolveComputerApiUrl } from '../computer/api';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';

/** Each MindRoom agent's server in a room, as state keyed by the agent's own user ID. */
export const MINDROOM_SERVER_EVENT = 'io.mindroom.server';

/**
 * The homeserver binds OpenID tokens to the origin they were requested for, so a token sent to an origin
 * an agent published is useless anywhere else. Chat opens published origins only on such a homeserver.
 */
export const OPENID_AUDIENCE_FEATURE = 'io.mindroom.openid_audience';

export type MindroomServer = {
  agentUserId: string;
  apiUrl: string;
  computer: boolean;
  ts: number;
};

/** Read one agent's server; an agent may only describe itself, under its own user ID, on the viewer's homeserver. */
export const parseMindroomServer = (
  event: MatrixEvent,
  viewerUserId: string | undefined
): MindroomServer | undefined => {
  const sender = event.getSender();
  if (!sender || event.getStateKey() !== sender) return undefined;
  if (!isMindroomAgentUserIdForViewer(sender, viewerUserId)) return undefined;
  const { api_origin: origin, computer } = event.getContent();
  const apiUrl = typeof origin === 'string' ? resolveComputerApiUrl(origin) : undefined;
  if (!apiUrl) return undefined;
  return { agentUserId: sender, apiUrl, computer: computer === true, ts: event.getTs() };
};

/** The servers of a room's agents that are still in it, newest first. */
export const selectMindroomServers = (
  events: MatrixEvent[],
  viewerUserId: string | undefined,
  isJoined: (userId: string) => boolean
): MindroomServer[] =>
  events
    .flatMap((event) => parseMindroomServer(event, viewerUserId) ?? [])
    .filter((server) => isJoined(server.agentUserId))
    .sort((a, b) => b.ts - a.ts);

/** Each distinct server origin, newest first. */
export const distinctServerUrls = (servers: MindroomServer[]): string[] => [
  ...new Set([...servers].sort((a, b) => b.ts - a.ts).map((server) => server.apiUrl)),
];
