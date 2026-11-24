import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Button, Text } from 'folds';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { subscribeRelativeTimeClock } from '../../i18n/useRelativeTime';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { MINDROOM_BACKGROUND_JOB_CANCEL_EVENT } from '../../matrix/protocol/backgroundJobsContract';
import { isLiveWorkflowRunStatus } from '../../matrix/protocol/workflowFrame';
import { sendWorkflowRunResume } from '../../matrix/protocol/workflowRunContent';
import { stopBackgroundJobs } from '../../matrix/send/cancelBackgroundJob';
import { useSentCancels } from '../../matrix/state/sentCancels';
import { ownDirectionLine } from '../../ui/directional';
import type { WorkflowRunView } from '../live/workflowRunStore';
import {
  formatWorkflowElapsed,
  workflowRunCostLine,
  workflowRunCountsLine,
  workflowRunStatusLabel,
} from './workflowRunLabels';
import * as css from './WorkflowRunCard.css';

const RESUME_TIMEOUT_MS = 15_000;

export const useLiveClock = (active: boolean): number => {
  const [now, setNow] = useState(Date.now);
  useEffect(
    () => (active ? subscribeRelativeTimeClock(1_000, () => setNow(Date.now())) : undefined),
    [active]
  );
  return now;
};

export const useCanCancelBackgroundJob = (room: Room, readOnly = false): boolean => {
  const viewerId = useMatrixClient().getUserId();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  return (
    !readOnly && !!viewerId && permissions.event(MINDROOM_BACKGROUND_JOB_CANCEL_EVENT, viewerId)
  );
};

export const useWorkflowRunActions = (
  room: Room | null,
  roomId: string,
  run: string,
  view: Pick<WorkflowRunView, 'status' | 'attempt' | 'requester'> | undefined,
  jobId: string | null,
  threadId: string | null,
  readOnly = false
) => {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const viewerId = mx.getUserId();
  const sentCancels = useSentCancels(roomId);
  const [resumingAt, setResumingAt] = useState<{ status: string; attempt: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const status = view?.status ?? 'starting';
  const attempt = view?.attempt ?? 1;
  const isLive = isLiveWorkflowRunStatus(status);
  const stopping = isLive && !!jobId && sentCancels.has(jobId);
  const resuming =
    resumingAt !== null && resumingAt.status === status && resumingAt.attempt === attempt;

  useEffect(() => {
    if (!resuming) return undefined;
    const timer = window.setTimeout(() => setResumingAt(null), RESUME_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [resuming]);

  const active = !readOnly && !!room && !!view;
  const canResume =
    active && !isLive && view.requester != null && !!viewerId && viewerId === view.requester;
  const showStop = active && isLive && !!jobId;
  const resumeMode = !canResume
    ? null
    : status === 'completed'
    ? 'runAgain'
    : status === 'failed' || status === 'cancelled' || status === 'interrupted'
    ? 'resume'
    : null;

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

  return {
    showStop,
    stopping,
    stop,
    resumeMode,
    hasActions: showStop || resumeMode !== null,
    resuming,
    resume,
    actionError,
  };
};

function StopButton({
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
        <StopButton room={room} stopping={actions.stopping} onStop={() => void actions.stop()} />
      )}
      {actions.resumeMode && (
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
              : actions.resumeMode === 'runAgain'
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
  view,
  showRunBadges = false,
  asHeading = false,
}: {
  heading: string;
  view?: Pick<WorkflowRunView, 'name' | 'title' | 'status' | 'attempt' | 'large'>;
  showRunBadges?: boolean;
  asHeading?: boolean;
}) {
  const { t } = useTranslation();
  const badges: [string, string][] = [
    ...(view?.name && view.title && view.name !== view.title
      ? [['name', view.name] as [string, string]]
      : []),
    ...(showRunBadges && view && view.attempt > 1
      ? [
          ['attempt', t('mindroomUi.workflowRun.attempt', { number: view.attempt })] as [
            string,
            string
          ],
        ]
      : []),
    ...(showRunBadges && view?.large
      ? [['large', t('mindroomUi.workflowRun.largeRun')] as [string, string]]
      : []),
  ];
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
      {badges.map(([key, badge]) => (
        <span key={key} className={css.Pill} {...ownDirectionLine}>
          {badge}
        </span>
      ))}
      {view && (
        <span className={css.StatusPill[view.status]}>
          {workflowRunStatusLabel(view.status, t)}
        </span>
      )}
    </>
  );
}

export function WorkflowRunMetrics({
  view,
  isLive,
  now,
  showFailed = false,
}: {
  view: Pick<WorkflowRunView, 'counts' | 'usage' | 'startedAt' | 'endedAt'>;
  isLive: boolean;
  now?: number;
  showFailed?: boolean;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const ticked = useLiveClock(isLive && now === undefined);
  const failedTotal = view.counts.failed + view.counts.indeterminate;
  const costText = workflowRunCostLine(view.usage, t, language);
  const elapsedText = formatWorkflowElapsed(
    view.startedAt,
    view.endedAt,
    isLive ? now ?? ticked : null,
    language
  );
  return (
    <div className={css.Row}>
      <Text as="span" size="T200" priority="300">
        {workflowRunCountsLine(view.counts, t)}
      </Text>
      {view.counts.cached > 0 && (
        <Text as="span" size="T200" priority="300">
          {t('mindroomUi.workflowRun.reused', { count: view.counts.cached })}
        </Text>
      )}
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
