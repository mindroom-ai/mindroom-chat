import { useEffect, useMemo, useState } from 'react';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { clientSessions, type ClientSessions } from '../../computer/clientSessions';
import { useRoomMindroomServer } from '../../computer/useRoomMindroomServer';
import { useComputerApiUrls } from '../../computer/useComputerApiUrl';
import { probeDictationAvailability, readCachedDictationAvailability } from './api';

export type DictationServerInfo = {
  available: boolean;
  apiUrl: string | undefined;
  roomId: string | undefined;
  sessions: ClientSessions | undefined;
};

/**
 * Resolves the MindRoom server for dictation (the room's server first, falling back to any
 * configured/discovered server so dictation works in human DMs and fork drafts too) and probes
 * `/api/dictation/v1/status` using the shared 5-minute TTL cache.
 */
export const useDictationServer = (roomId?: string): DictationServerInfo => {
  const mx = useMatrixClient();
  const roomServer = useRoomMindroomServer(mx, roomId ?? '');
  const computerUrls = useComputerApiUrls();
  const apiUrl = roomServer.apiUrl ?? computerUrls.urls[0];

  const sessions = useMemo(() => (apiUrl ? clientSessions(mx, apiUrl) : undefined), [apiUrl, mx]);

  const cached = sessions ? readCachedDictationAvailability(sessions, roomId) : false;
  const [probed, setProbed] = useState<{
    sessions: ClientSessions | undefined;
    roomId: string | undefined;
    value: boolean;
  }>(() => ({ sessions, roomId, value: cached ?? false }));

  useEffect(() => {
    if (!sessions) return undefined;
    const hit = readCachedDictationAvailability(sessions, roomId);
    if (hit !== undefined) {
      setProbed({ sessions, roomId, value: hit });
      return undefined;
    }

    const controller = new AbortController();
    void probeDictationAvailability(sessions, roomId, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setProbed({ sessions, roomId, value });
      },
      () => undefined
    );
    return () => controller.abort();
  }, [roomId, sessions]);

  const available =
    sessions !== undefined &&
    (cached ?? (probed.sessions === sessions && probed.roomId === roomId ? probed.value : false));

  return { available, apiUrl, roomId, sessions };
};
