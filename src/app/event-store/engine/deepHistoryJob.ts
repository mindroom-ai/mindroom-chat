import { Direction, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import { persistRoomChunkWithPreferLive } from '../cache/eventRepository';
import {
  isCacheStoreWriteLeaseCurrent,
  loadRoomTailDiscontinuity,
  type CacheStoreWriteLease,
} from '../cache/db';
import { readRoomOfflineProgress, updateRoomOfflineProgress } from '../cache/db/cacheStoreMeta';
import type { BackfillScheduler } from './backfillScheduler';

export type ReserveHistoryPage = (
  roomId: string
) => { limit: number; settle: (committedCount: number) => void } | undefined;

export type HistoryPage = { events: MatrixEvent[]; exhausted: boolean };

/** One scheduler turn, one committed page. The controller queues continuation
 * only after this promise settles, leaving foreground jobs a free slot. */
export const enqueueRoomDeepHistoryJob = ({
  mx,
  sessionId,
  scheduler,
  roomId,
  writeLease,
  canRun,
  reservePage,
}: {
  mx: MatrixClient;
  sessionId: string;
  scheduler: BackfillScheduler;
  roomId: string;
  writeLease: CacheStoreWriteLease;
  canRun: () => boolean;
  reservePage: ReserveHistoryPage;
}): Promise<HistoryPage | undefined> =>
  scheduler.enqueue({
    roomId,
    kind: 'room-deep-history',
    priority: 4,
    execute: async (signal) => {
      const current = () =>
        !signal.aborted && isCacheStoreWriteLeaseCurrent(writeLease) && canRun();
      const room = mx.getRoom(roomId);
      if (!room || !current()) return undefined;
      const progress = await readRoomOfflineProgress(sessionId, roomId);
      if (progress.exhausted || !current()) return { events: [], exhausted: !!progress.exhausted };
      const reservation = reservePage(roomId);
      if (!reservation) return undefined;
      let committedCount = 0;
      try {
        // SDK room pagination can advance without retaining thread replies.
        // Only our own committed cursor proves independent offline coverage.
        const from = progress.nextToken ?? null;
        const response = await mx.createMessagesRequest(
          roomId,
          from,
          Math.min(200, reservation.limit),
          Direction.Backward
        );
        if (!current()) return undefined;
        const gap = await loadRoomTailDiscontinuity(sessionId, roomId);
        const saved = await persistRoomChunkWithPreferLive({
          mx,
          sessionId,
          room,
          chunk: response.chunk ?? [],
          writeLease,
          beforeTokenForEarliest: response.end ?? null,
          roomTailLoaded: !gap,
        });
        if (!current()) return undefined;
        const events = saved?.events ?? [];
        const next = response.end || null;
        if (next && (next === from || progress.recentTokens?.includes(next))) {
          throw new Error('History pagination did not advance');
        }
        const committed = await updateRoomOfflineProgress(
          sessionId,
          roomId,
          {
            opened: true,
            nextToken: next,
            exhausted: !next,
            savedEvents: (progress.savedEvents ?? 0) + (response.chunk?.length ?? 0),
            // Detect short server cursor cycles without growing every checkpoint.
            recentTokens: next ? [...(progress.recentTokens ?? []).slice(-7), next] : [],
          },
          writeLease
        );
        if (!committed) throw new Error('History progress did not commit');
        committedCount = response.chunk?.length ?? 0;
        return { events, exhausted: !next };
      } finally {
        reservation.settle(committedCount);
      }
    },
  });
