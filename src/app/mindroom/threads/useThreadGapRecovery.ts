import { useEffect } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import type { MindroomSyncEngine } from '../engine';
import { hydrateThreadFromCache } from './threadOpenCacheController';

export type ThreadGapRecoveryOptions = {
  engine: MindroomSyncEngine;
  room: Room;
  threadId?: string;
  append: (threadId: string, events: MatrixEvent[]) => void;
};

export const useThreadGapRecovery = ({
  engine,
  room,
  threadId,
  append,
}: ThreadGapRecoveryOptions): void => {
  useEffect(() => {
    if (!threadId) return undefined;
    let active = true;
    let reading = false;
    let dirty = false;
    const refresh = async () => {
      dirty = true;
      if (reading) return;
      reading = true;
      try {
        // Coalesce pages committed during a read, then read again so a late
        // commit cannot be hidden by the earlier IndexedDB snapshot.
        while (active && dirty) {
          dirty = false;
          // eslint-disable-next-line no-await-in-loop
          const page = await hydrateThreadFromCache(
            {
              mx: engine.mx,
              sessionId: engine.sessionId,
              room,
              isCurrentThread: () => active,
            },
            threadId
          ).catch(() => undefined);
          if (active && page?.hydratedEvents?.length) append(threadId, page.hydratedEvents);
        }
      } finally {
        reading = false;
      }
    };
    const unsubscribe = engine.subscribeRoomRecovery(room.roomId, () => {
      void refresh().catch(() => undefined);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [engine, room, threadId, append]);
};
