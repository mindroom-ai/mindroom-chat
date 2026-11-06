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
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useActiveSession } from '../../matrix/session/useSessionStore';
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

type UseRoomEventOptions = {
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
  const mx = useMatrixClient();

  const query = useQuery({
    queryKey: [room.roomId, eventId, threadId],
    queryFn: () => fetchEvent(eventId, threadId),
    enabled: !localEvent,
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    retry: (failureCount: number, error: unknown) => !isNotFound(error) && failureCount < 3,
  });

  // Events and their newest edits decrypt after they are found or loaded, and edits arrive later;
  // repaint when they do. A local copy may still be decrypting, such as a thread reply that
  // arrived with the first sync.
  const shownEvent = localEvent ?? query.data;
  const shownEdit = shownEvent?.replacingEvent() ?? undefined;
  const [, setRevision] = useState(0);
  useEffect(() => {
    if (!shownEvent) return undefined;
    // A held copy nothing has decrypted yet (one built from a cache or a bundle) is decrypted
    // here, as a loaded one is; the repaint follows its Decrypted event.
    void decryptLoadedEvent(mx, shownEvent);
    if (shownEdit) void decryptLoadedEvent(mx, shownEdit);
    const repaint = () => setRevision((revision) => revision + 1);
    shownEvent.on(MatrixEventEvent.Decrypted, repaint);
    shownEvent.on(MatrixEventEvent.Replaced, repaint);
    shownEdit?.on(MatrixEventEvent.Decrypted, repaint);
    return () => {
      shownEvent.removeListener(MatrixEventEvent.Decrypted, repaint);
      shownEvent.removeListener(MatrixEventEvent.Replaced, repaint);
      shownEdit?.removeListener(MatrixEventEvent.Decrypted, repaint);
    };
  }, [mx, shownEvent, shownEdit]);

  if (localEvent) return localEvent;
  if (query.isError) return null;
  return query.data;
};
