import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Button, Text } from 'folds';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { subscribeRelativeTimeClock } from '../../i18n/useRelativeTime';
import { formatWorkDuration } from '../../lib/time';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { MINDROOM_BACKGROUND_JOB_CANCEL_EVENT } from '../../matrix/protocol/backgroundJobsContract';
import {
  isLiveWorkflowRunStatus,
  type WorkflowRunCounts,
  type WorkflowRunStatus,
  type WorkflowRunUsage,
} from '../../matrix/protocol/workflowFrame';
import { sendWorkflowRunResume } from '../../matrix/protocol/workflowRunContent';
import { stopBackgroundJobs } from '../../matrix/send/cancelBackgroundJob';
import { useSentCancels } from '../../matrix/state/sentCancels';
import { ownDirectionLine } from '../../ui/directional';
import {
  workflowRunCostLine,
  workflowRunCountsLine,
  workflowRunStatusLabel,
} from './workflowRunLabels';
import * as css from './WorkflowRunCard.css';

const RESUME_TIMEOUT_MS = 15_000;

export const useCanCancelBackgroundJob = (room: Room, readOnly = false): boolean => {
  const viewerId = useMatrixClient().getUserId();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  return (
    !readOnly && !!viewerId && permissions.event(MINDROOM_BACKGROUND_JOB_CANCEL_EVENT, viewerId)
  );
};

export const useWorkflowRunActions = (params: {
  room: Room | null;
  roomId: string;
  run: string;
  jobId: string | null;
  requester: string | null | undefined;
  status: WorkflowRunStatus;
  attempt: number;
  threadId: string | null;
  readOnly?: boolean;
}) => {
  const {
    room,
    roomId,
    run,
    jobId,
    requester,
    status,
    attempt,
    threadId,
    readOnly = false,
  } = params;
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const viewerId = mx.getUserId();
  const sentCancels = useSentCancels(roomId);
  const [resumingAt, setResumingAt] = useState<{ status: string; attempt: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isLive = isLiveWorkflowRunStatus(status);
  const stopping = isLive && !!jobId && sentCancels.has(jobId);
  const resuming =
    resumingAt !== null && resumingAt.status === status && resumingAt.attempt === attempt;

  useEffect(() => {
    if (!resuming) return undefined;
    const timer = window.setTimeout(() => setResumingAt(null), RESUME_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [resuming]);

  const canResume =
    !readOnly && !!room && !isLive && requester != null && !!viewerId && viewerId === requester;
  const showStop = isLive && !readOnly && !!room && !!jobId;
  const showResume =
    canResume && (status === 'failed' || status === 'cancelled' || status === 'interrupted');
  const showRunAgain = canResume && status === 'completed';

  const stop = async () => {
    if (!room || !jobId || stopping) return;
    setActionError(null);
    if (!(await stopBackgroundJobs(mx, room, threadId, { jobId }, [jobId])))
      setActionError(t('activity.actions.failed'));
  };

  const resume = async () => {
    if (!room || resuming) return;
    setActionError(null);
    setResumingAt({ status, attempt });
    try {
      await sendWorkflowRunResume(mx, room, threadId, run);
    } catch {
      setResumingAt(null);
      setActionError(t('activity.actions.failed'));
    }
  };

  return { showStop, stopping, stop, showResume, showRunAgain, resuming, resume, actionError };
};

function StopWorkflowButton({
  room,
  stopping,
  onStop,
}: {
  room: Room;
  stopping: boolean;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  if (!useCanCancelBackgroundJob(room)) return null;
  return (
    <Button
      type="button"
      size="300"
      variant="Critical"
      fill="Soft"
      disabled={stopping}
      onClick={onStop}
    >
      <Text size="B300">
        {stopping ? t('mindroomUi.workflowRun.stopping') : t('mindroomUi.workflowRun.stop')}
      </Text>
    </Button>
  );
}

export function WorkflowRunActionButtons({
  room,
  actions,
}: {
  room: Room | null;
  actions: ReturnType<typeof useWorkflowRunActions>;
}) {
  const { t } = useTranslation();
  return (
    <>
      {actions.showStop && room && (
        <StopWorkflowButton
          room={room}
          stopping={actions.stopping}
          onStop={() => void actions.stop()}
        />
      )}
      {(actions.showResume || actions.showRunAgain) && (
        <Button
          type="button"
          size="300"
          variant="Primary"
          fill="Soft"
          disabled={actions.resuming}
          onClick={() => void actions.resume()}
        >
          <Text size="B300">
            {actions.resuming
              ? t('mindroomUi.workflowRun.starting')
              : actions.showRunAgain
              ? t('mindroomUi.workflowRun.runAgain')
              : t('mindroomUi.workflowRun.resume')}
          </Text>
        </Button>
      )}
    </>
  );
}

export function WorkflowRunTitleBadges({
  heading,
  name,
  title,
  status,
  attempt,
  large,
  asHeading = false,
}: {
  heading: string;
  name?: string | null;
  title?: string | null;
  status?: WorkflowRunStatus;
  attempt?: number;
  large?: boolean;
  asHeading?: boolean;
}) {
  const { t } = useTranslation();
  const showSavedName = !!name && !!title && name !== title;
  return (
    <>
      {asHeading ? (
        <Text as="h2" size="H4" truncate {...ownDirectionLine}>
          {heading}
        </Text>
      ) : (
        <Text as="span" size="T400" className={css.Title} {...ownDirectionLine}>
          {heading}
        </Text>
      )}
      {showSavedName && name && (
        <span className={css.Pill} {...ownDirectionLine}>
          {name}
        </span>
      )}
      {attempt !== undefined && attempt > 1 && (
        <span className={css.Pill}>{t('mindroomUi.workflowRun.attempt', { number: attempt })}</span>
      )}
      {large && <span className={css.Pill}>{t('mindroomUi.workflowRun.largeRun')}</span>}
      {status && (
        <span className={css.StatusPill[status]}>{workflowRunStatusLabel(status, t)}</span>
      )}
    </>
  );
}

export function WorkflowRunMetrics({
  counts,
  usage,
  startedAt,
  endedAt,
  isLive,
  showFailed = false,
}: {
  counts: WorkflowRunCounts;
  usage: WorkflowRunUsage;
  startedAt: number | null;
  endedAt: number | null;
  isLive: boolean;
  showFailed?: boolean;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const [now, setNow] = useState(Date.now);
  useEffect(
    () => (isLive ? subscribeRelativeTimeClock(1_000, () => setNow(Date.now())) : undefined),
    [isLive]
  );
  const failedTotal = counts.failed + counts.indeterminate;
  const costText = workflowRunCostLine(usage, t, language);
  const elapsedText =
    startedAt === null
      ? undefined
      : isLive
      ? formatWorkDuration(Math.max(0, now - startedAt * 1000), language)
      : endedAt !== null
      ? formatWorkDuration(Math.max(0, (endedAt - startedAt) * 1000), language)
      : undefined;
  return (
    <div className={css.Row}>
      <Text as="span" size="T200" priority="300">
        {workflowRunCountsLine(counts, t)}
      </Text>
      {showFailed && failedTotal > 0 && (
        <Text as="span" size="T200" className={css.CriticalText}>
          {t('mindroomUi.workflowRun.failedCount', { count: failedTotal })}
        </Text>
      )}
      {costText && (
        <Text as="span" size="T200" priority="300">
          {costText}
        </Text>
      )}
      {elapsedText && (
        <Text as="span" size="T200" priority="300">
          {elapsedText}
        </Text>
      )}
    </div>
  );
}
