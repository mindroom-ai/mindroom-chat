import { useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { clientSessions } from '../../computer/clientSessions';
import { useAgentMindroomServer } from '../../computer/useAgentMindroomServer';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { parseAgentProfile, type AgentProfile } from './agentProfile';

/** `loading` until the agent's server answers; `none` when it has no profile to give. */
export type AgentProfileState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; profile: AgentProfile };

// A card opened again soon after shows the answer it had; a config reload shows after this.
const FRESH_MS = 60_000;

type Cached = { at: number; answer: Promise<AgentProfile | undefined> };
const cache = new WeakMap<MatrixClient, Map<string, Cached>>();

export const agentProfilePath = (roomId: string, agentUserId: string): string =>
  `/api/rooms/${encodeURIComponent(roomId)}/agents/${encodeURIComponent(agentUserId)}/profile`;

const fetchProfile = async (
  mx: MatrixClient,
  apiUrl: string,
  path: string
): Promise<AgentProfile | undefined> => {
  const response = await clientSessions(mx, apiUrl).send(path, { redirect: 'error' });
  // An older backend has no such route (404), and an agent the person may not use is refused (403).
  if (!response.ok) return undefined;
  return parseAgentProfile(await response.json());
};

/**
 * The profile of an agent in a room (model and tools), from the MindRoom server Chat trusts for that
 * agent, asked once per minute at most. A server that has none, refuses, or cannot be reached gives
 * `none`, so the card keeps what the room itself says about the agent.
 */
export const useAgentProfile = (roomId: string, agentUserId: string): AgentProfileState => {
  const mx = useMatrixClient();
  const { apiUrl, pending } = useAgentMindroomServer(mx, roomId, agentUserId);
  const [state, setState] = useState<AgentProfileState>({ status: 'loading' });

  useEffect(() => {
    if (pending) return undefined;
    if (!apiUrl) {
      setState({ status: 'none' });
      return undefined;
    }
    const entries = cache.get(mx) ?? new Map<string, Cached>();
    cache.set(mx, entries);
    const path = agentProfilePath(roomId, agentUserId);
    const key = `${apiUrl}${path}`;
    let entry = entries.get(key);
    if (!entry || Date.now() - entry.at > FRESH_MS) {
      const asked: Cached = {
        at: Date.now(),
        answer: fetchProfile(mx, apiUrl, path).catch(() => undefined),
      };
      entries.set(key, asked);
      // A failed ask is not kept, so the next card asks again.
      void asked.answer.then((profile) => {
        if (!profile && entries.get(key) === asked) entries.delete(key);
      });
      entry = asked;
    }
    let current = true;
    void entry.answer.then((profile) => {
      if (current) setState(profile ? { status: 'ready', profile } : { status: 'none' });
    });
    return () => {
      current = false;
    };
  }, [mx, apiUrl, pending, roomId, agentUserId]);

  return state;
};
