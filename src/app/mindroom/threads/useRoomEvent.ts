import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  MatrixEventEvent,
  type IEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import type { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useActiveSession } from '../../hooks/useSessionStore';
import { loadCachedRoomEvent, loadCachedThreadEvent } from './eventRepository';

const decryptLoadedEvent = async (mx: MatrixClient, event: MatrixEvent): Promise<void> => {
  if (!event.shouldAttemptDecryption()) return;
  const crypto = mx.getCrypto();
  if (!crypto) return;
  try {
    // The Rust crypto object the client exposes is also its decryption backend.
    await event.attemptDecryption(crypto as unknown as CryptoBackend);
  } catch {
    // A failed decryption leaves the event marked as such; a later key retries it.
  }
};

/**
 * Turn a raw event loaded outside the timeline (network or cache) into a `MatrixEvent`: the
 * client's mapper applies a bundled edit, then the event and its edit are decrypted when needed.
 */
export const hydrateLoadedEvent = async (
  mx: MatrixClient,
  raw: Partial<IEvent>
): Promise<MatrixEvent> => {
  const event = mx.getEventMapper({ decrypt: false })(raw);
  await decryptLoadedEvent(mx, event);
  const replacement = event.replacingEvent();
  if (replacement) await decryptLoadedEvent(mx, replacement);
  return event;
};

type FetchRoomEvent = (eventId: string, threadId?: string) => Promise<MatrixEvent>;

const readCache = async <T>(read: () => Promise<T | undefined>): Promise<T | undefined> => {
  try {
    return await read();
  } catch {
    return undefined;
  }
};

/**
 * Load an event that is not in the room timeline: the thread cache first (when the event is
 * known to sit in a thread), then the room cache, then the homeserver.
 */
export const useFetchRoomEvent = (room: Room): FetchRoomEvent => {
  const mx = useMatrixClient();
  const sessionId = useActiveSession()?.sessionId;
  const { roomId } = room;

  return useCallback(
    async (eventId: string, threadId?: string) => {
      if (sessionId) {
        const cached =
          (threadId
            ? await readCache(() => loadCachedThreadEvent(sessionId, roomId, threadId, eventId))
            : undefined) ??
          (await readCache(() => loadCachedRoomEvent(sessionId, roomId, eventId)));
        if (cached) return hydrateLoadedEvent(mx, { room_id: roomId, ...cached });
      }
      return hydrateLoadedEvent(mx, await mx.fetchRoomEvent(roomId, eventId));
    },
    [mx, roomId, sessionId]
  );
};

const isNotFound = (error: unknown): boolean =>
  (error as { errcode?: string } | null)?.errcode === 'M_NOT_FOUND';

export type UseRoomEventOptions = {
  /** Thread the event belongs to, so the thread cache is tried first. */
  threadId?: string;
};

/**
 * An event by id: the local copy when there is one, otherwise loaded once and kept.
 * `undefined` while loading, `null` when it could not be loaded.
 */
export const useRoomEvent = (
  room: Room,
  eventId: string,
  getLocally?: () => MatrixEvent | undefined,
  options?: UseRoomEventOptions
): MatrixEvent | null | undefined => {
  const threadId = options?.threadId;
  const localEvent = getLocally?.() ?? room.findEventById(eventId);
  const fetchEvent = useFetchRoomEvent(room);

  const query = useQuery({
    queryKey: [room.roomId, eventId, threadId],
    queryFn: () => fetchEvent(eventId, threadId),
    enabled: !localEvent,
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    retry: (failureCount: number, error: unknown) => !isNotFound(error) && failureCount < 3,
  });

  // Loaded events decrypt and get edited after the query settles; repaint when they do.
  const loadedEvent = localEvent ? undefined : query.data;
  const [, setRevision] = useState(0);
  useEffect(() => {
    if (!loadedEvent) return undefined;
    const repaint = () => setRevision((revision) => revision + 1);
    loadedEvent.on(MatrixEventEvent.Decrypted, repaint);
    loadedEvent.on(MatrixEventEvent.Replaced, repaint);
    return () => {
      loadedEvent.removeListener(MatrixEventEvent.Decrypted, repaint);
      loadedEvent.removeListener(MatrixEventEvent.Replaced, repaint);
    };
  }, [loadedEvent]);

  if (localEvent) return localEvent;
  if (query.isError) return null;
  return query.data;
};
