import { useMemo } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useRoomActiveRuns } from '../matrix/hooks/useRoomActiveRuns';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';

/**
 * Whether any job's agent has an active reply run in that job's thread (or room timeline when
 * `threadId` is `null`), read from `io.mindroom.active_runs`.
 */
export const useJobRepliesStreaming = (room: Room | undefined, jobs: BackgroundJob[]): boolean => {
  const { runs } = useRoomActiveRuns(room ?? null);
  return useMemo(
    () =>
      jobs.some((job) =>
        runs.some((run) => run.agentId === job.agentId && run.threadId === (job.threadId ?? null))
      ),
    [jobs, runs]
  );
};
