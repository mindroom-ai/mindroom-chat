/**
 * CINNY-207 P3.1: engine gap tracker (Commit 1 stub).
 *
 * Commit 4 (P3.2) will make this a real limited-sync gap detector
 * (RoomEvent.TimelineReset on the unfiltered timelineSet →
 * markRoomTailDiscontinuity + enqueue GapFillJob). For Commit 1 the
 * tracker is a no-op that exists so the engine's `stop()` can call
 * a matching teardown regardless of which commit is in play.
 */

export type EngineGapTracker = {
  handleTimelineReset(): void;
  handleSyncPrepared(): void;
  stop(): void;
};

export const createEngineGapTracker = (): EngineGapTracker => {
  return {
    handleTimelineReset: () => {
      // Commit 4 (P3.2) fills this in.
    },
    handleSyncPrepared: () => {
      // Commit 4 (P3.2) enqueues reason:'startup' jobs here.
    },
    stop: () => {
      // No pending timers in the stub.
    },
  };
};
