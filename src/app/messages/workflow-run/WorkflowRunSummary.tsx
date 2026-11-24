import { type ReactNode, useEffect, useState } from 'react';
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
import * as questionCss from '../question/QuestionCard.css';
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

/** Stop and Resume/Run again controls shared by the workflow run card and side panel. */
export function WorkflowRunControls({
  room,
  run,
  view,
  jobId,
  threadId,
  readOnly = false,
  leading,
  onError,
}: {
  room: Room;
  run: string;
  view?: Pick<WorkflowRunView, 'status' | 'attempt' | 'requester'>;
  jobId: string | null;
  threadId: string | null;
  readOnly?: boolean;
  leading?: ReactNode;
  onError?: (error: string | null) => void;
}) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const viewerId = mx.getUserId();
  const canCancel = useCanCancelBackgroundJob(room, readOnly);
  const sentCancels = useSentCancels(room.roomId);
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

  const setError = (message: string | null) => {
    if (onError) onError(message);
    else setActionError(message);
  };

  const active = !readOnly && !!view;
  const showStop = active && isLive && !!jobId && canCancel;
  const canResume =
    active && !isLive && view.requester != null && !!viewerId && viewerId === view.requester;
  const resumeMode = !canResume
    ? null
    : status === 'completed'
    ? 'runAgain'
    : status === 'failed' || status === 'cancelled' || status === 'interrupted'
    ? 'resume'
    : null;

  const stop = async () => {
    if (!jobId || stopping) return;
    setError(null);
    if (!(await stopBackgroundJobs(mx, room, threadId, { jobId }, [jobId])))
      setError(t('activity.actions.failed'));
  };
  const resume = async () => {
    if (resuming) return;
    setError(null);
    setResumingAt({ status, attempt });
    try {
      await sendWorkflowRunResume(mx, room, threadId, run);
    } catch {
      setResumingAt(null);
      setError(t('activity.actions.failed'));
    }
  };

  const buttons = (
    <>
      {leading}
      {showStop && (
        <Button
          type="button"
          size="300"
          variant="Critical"
          fill="Soft"
          disabled={stopping}
          onClick={() => void stop()}
        >
          <Text size="B300">
            {stopping ? t('mindroomUi.workflowRun.stopping') : t('mindroomUi.workflowRun.stop')}
          </Text>
        </Button>
      )}
      {resumeMode && (
        <Button
          type="button"
          size="300"
          variant="Primary"
          fill="Soft"
          disabled={resuming}
          onClick={() => void resume()}
        >
          <Text size="B300">
            {resuming
              ? t('mindroomUi.workflowRun.starting')
              : resumeMode === 'runAgain'
              ? t('mindroomUi.workflowRun.runAgain')
              : t('mindroomUi.workflowRun.resume')}
          </Text>
        </Button>
      )}
    </>
  );

  if (onError) return buttons;
  return (
    <>
      {(leading || showStop || resumeMode) && <div className={css.Row}>{buttons}</div>}
      {actionError && (
        <Text role="alert" size="T200" className={questionCss.Failed}>
          {actionError}
        </Text>
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
      {view?.name && view.title && view.name !== view.title && (
        <span className={css.Pill} {...ownDirectionLine}>
          {view.name}
        </span>
      )}
      {showRunBadges && view && view.attempt > 1 && (
        <span className={css.Pill}>
          {t('mindroomUi.workflowRun.attempt', { number: view.attempt })}
        </span>
      )}
      {showRunBadges && view?.large && (
        <span className={css.Pill}>{t('mindroomUi.workflowRun.largeRun')}</span>
      )}
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
