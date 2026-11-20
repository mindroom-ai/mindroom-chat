import { useEffect, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import { clientSessions } from '../../computer/clientSessions';
import { useAgentMindroomServer } from '../../computer/useAgentMindroomServer';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { parseAgentProfile, type AgentProfile } from './agentProfile';

/** `loading` until the agent's server answers; `none` when there is no profile to show. */
export type AgentProfileState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; profile: AgentProfile };

/** How long a card waits for the profile before it shows what the room says instead. */
const TIMEOUT_MS = 8000;

export const agentProfilePath = (roomId: string, agentUserId: string): string =>
  `/api/rooms/${encodeURIComponent(roomId)}/agents/${encodeURIComponent(agentUserId)}/profile`;

/**
 * An agent's profile (model and tools) as it was when its card opened, asked once per open of the
 * MindRoom server Chat trusts for the agent; the ask stops when the card closes or after
 * `TIMEOUT_MS`. `none` while either side is not joined, while Chat may ask no server, and when
 * the server refuses or does not answer: the card then shows what the room says about the agent.
 */
export const useAgentProfile = (room: Room, agentUserId: string): AgentProfileState => {
  const mx = useMatrixClient();
  const { apiUrl, pending } = useAgentMindroomServer(mx, room.roomId, agentUserId);
  const joined =
    room.getMyMembership() === 'join' && room.getMember(agentUserId)?.membership === 'join';
  const path = agentProfilePath(room.roomId, agentUserId);
  // The answer belongs to the server, room and agent asked; any other shows none of it.
  const key = joined && !pending && apiUrl ? `${apiUrl}${path}` : undefined;
  const [answer, setAnswer] = useState<{ key: string; profile?: AgentProfile }>();
  // Once the key changes, even back to what was asked, only a fresh answer shows.
  if (answer && answer.key !== key) setAnswer(undefined);

  useEffect(() => {
    if (!key || !apiUrl) return undefined;
    let open = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    void clientSessions(mx, apiUrl)
      // An older backend has no such route (404), and an agent the person may not use is refused (403).
      .send(path, { signal: controller.signal, redirect: 'error' })
      .then(async (response) =>
        response.ok ? parseAgentProfile(await response.json()) : undefined
      )
      .catch(() => undefined)
      .then((profile) => open && setAnswer({ key, profile }))
      .finally(() => clearTimeout(timer));
    return () => {
      open = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [mx, apiUrl, path, key]);

  if (!joined || (!pending && !apiUrl)) return { status: 'none' };
  if (!key || !answer || answer.key !== key) return { status: 'loading' };
  return answer.profile ? { status: 'ready', profile: answer.profile } : { status: 'none' };
};
