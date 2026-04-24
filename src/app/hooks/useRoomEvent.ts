import { IEvent, MatrixEvent, Room } from 'matrix-js-sdk';
import { useCallback, useMemo } from 'react';
import to from 'await-to-js';
import { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { useQuery } from '@tanstack/react-query';
import { useMatrixClient } from './useMatrixClient';
import { useActiveSession } from './useSessionStore';
import {
  loadCachedRoomEvent,
  loadCachedThreadEvent,
} from '../mindroom/threads/eventRepository';

type UseRoomEventOptions = {
  threadId?: string;
};

const hydrateLoadedEvent = async (
  mx: ReturnType<typeof useMatrixClient>,
  evt: Partial<IEvent>
): Promise<MatrixEvent> => {
  const mEvent = new MatrixEvent(evt);

  if (evt.unsigned?.['m.relations'] && evt.unsigned?.['m.relations']['m.replace']) {
    const replaceEvt = evt.unsigned?.['m.relations']['m.replace'] as IEvent;
    const replaceEvent = new MatrixEvent(replaceEvt);
    mEvent.makeReplaced(replaceEvent);
  }

  if (mEvent.isEncrypted() && mx.getCrypto()) {
    await to(mEvent.attemptDecryption(mx.getCrypto() as CryptoBackend));
  }

  return mEvent;
};

const useFetchEvent = (room: Room, eventId: string, options?: UseRoomEventOptions) => {
  const mx = useMatrixClient();
  const activeSession = useActiveSession();

  const fetchEventCallback = useCallback(async () => {
    const sessionId = activeSession?.sessionId;
    if (sessionId && options?.threadId) {
      try {
        const cachedThreadEvent = await loadCachedThreadEvent(
          sessionId,
          room.roomId,
          options.threadId,
          eventId
        );
        if (cachedThreadEvent) {
          return hydrateLoadedEvent(mx, cachedThreadEvent);
        }
      } catch {
        // Ignore cache read failures and fall through to other sources.
      }
    }

    if (sessionId) {
      try {
        const cachedRoomEvent = await loadCachedRoomEvent(sessionId, room.roomId, eventId);
        if (cachedRoomEvent) {
          return hydrateLoadedEvent(mx, cachedRoomEvent);
        }
      } catch {
        // Ignore cache read failures and fall through to the network fetch.
      }
    }

    const evt = await mx.fetchRoomEvent(room.roomId, eventId);
    return hydrateLoadedEvent(mx, evt);
  }, [activeSession?.sessionId, eventId, mx, options?.threadId, room.roomId]);

  return fetchEventCallback;
};

/**
 *
 * @param room
 * @param eventId
 * @returns `MatrixEvent`, `undefined` means loading, `null` means failure
 */
export const useRoomEvent = (
  room: Room,
  eventId: string,
  getLocally?: () => MatrixEvent | undefined,
  options?: UseRoomEventOptions
) => {
  const event = useMemo(() => {
    if (getLocally) return getLocally();
    return room.findEventById(eventId);
  }, [room, eventId, getLocally]);

  const fetchEvent = useFetchEvent(room, eventId, options);

  const { data, error } = useQuery({
    enabled: event === undefined,
    queryKey: [room.roomId, eventId, options?.threadId],
    queryFn: fetchEvent,
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000, // 1hour
  });

  if (event) return event;
  if (data) return data;
  if (error) return null;

  return undefined;
};
