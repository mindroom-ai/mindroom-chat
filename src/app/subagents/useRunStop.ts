import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { usePowerLevels } from '../matrix/hooks/usePowerLevels';
import { useRoomBackgroundJobs } from '../matrix/hooks/useRoomBackgroundJobs';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
import { MINDROOM_BACKGROUND_JOB_CANCEL_EVENT } from '../matrix/protocol/backgroundJobsContract';
import { cancelBackgroundJob } from '../matrix/send/cancelBackgroundJob';
import { forgetCancel, markCancelSent, useSentCancels } from '../matrix/state/sentCancels';
import { type SubagentRun, useRoomSubagentRuns } from '../messages/live/subagentRunStore';
import { jobOfRun } from './runJob';

export type RunStop = {
  // The run's Stop: a cancel of its job, as the jobs bar's Stop sends it; none without a live job
  // the viewer may cancel, or while one is on its way.
  stop?: () => void;
  // Its cancel was sent from this client, or requested anywhere else.
  stopping: boolean;
  // Why the last Stop failed, while its job is still there to stop.
  failure?: string;
};

/**
 * The open run's Stop, the jobs bar's for the same job: one cancel event for its job, "Stopping…"
 * until the job leaves, and the bar's error when the event did not go out.
 */
export const useRunStop = (room: Room, run: SubagentRun, name: string): RunStop => {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { jobs } = useRoomBackgroundJobs(room);
  const runs = useRoomSubagentRuns(room.roomId);
  const sent = useSentCancels(room.roomId);
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const canCancel = permissions.event(MINDROOM_BACKGROUND_JOB_CANCEL_EVENT, mx.getSafeUserId());
  const job = jobOfRun(jobs, runs, run);
  const [failedJob, setFailedJob] = useState<string>();
  const stopping = !!job && (job.status === 'cancel_requested' || sent.has(job.jobId));
  const send = useCallback(async () => {
    if (!job) return;
    setFailedJob(undefined);
    const marked = markCancelSent(room.roomId, [job.jobId]);
    try {
      await cancelBackgroundJob(mx, room, job.threadId, { jobId: job.jobId });
    } catch {
      forgetCancel(room.roomId, marked);
      setFailedJob(job.jobId);
    }
  }, [job, mx, room]);
  return {
    ...(job && canCancel && !stopping ? { stop: () => void send() } : {}),
    stopping,
    ...(job && !stopping && failedJob === job.jobId
      ? { failure: t('mindroomUi.backgroundJobs.stopFailed', { tool: name }) }
      : {}),
  };
};
