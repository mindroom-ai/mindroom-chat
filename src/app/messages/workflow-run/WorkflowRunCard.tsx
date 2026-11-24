import { useEffect, useState } from 'react';
import { useStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'folds';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { subscribeRelativeTimeClock } from '../../i18n/useRelativeTime';
import { formatWorkDuration } from '../../lib/time';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { MINDROOM_BACKGROUND_JOB_CANCEL_EVENT } from '../../matrix/protocol/backgroundJobsContract';
import { isLiveWorkflowRunStatus } from '../../matrix/protocol/workflowFrame';
import {
  sendWorkflowRunResume,
  type WorkflowRunCard as WorkflowRunCardData,
} from '../../matrix/protocol/workflowRunContent';
import { cancelBackgroundJob } from '../../matrix/send/cancelBackgroundJob';
import { ownDirectionBlock, ownDirectionLine } from '../../ui/directional';
import { openWorkflowRunPanel } from '../../navigation/workflowPanel';
import {
  getWorkflowRunStore,
  useWorkflowRun,
  type WorkflowRunEntry,
} from '../live/workflowRunStore';
import {
  workflowRunCostLine,
  workflowRunCountsLine,
  workflowRunHeading,
  workflowRunStatusLabel,
} from './workflowRunLabels';
import * as css from './WorkflowRunCard.css';

const RESUME_TIMEOUT_MS = 15_000;

const isLiveEntryNewer = (live: WorkflowRunEntry | undefined, card: WorkflowRunCardData): boolean => {
  if (!live || live.fromCard) return false;
  if (live.meta.attempt > card.attempt) return true;
  if (live.meta.attempt < card.attempt) return false;
  return isLiveWorkflowRunStatus(card.status) || !isLiveWorkflowRunStatus(live.meta.status);
};

export type WorkflowRunCardProps = {
  card: WorkflowRunCardData;
  roomId: string;
  threadId?: string | null;
  eventId?: string;
  sender?: string;
  readOnly?: boolean;
};

/**
 * Renders a workflow run's durable notice card, overlaid with live ephemeral frames when newer.
 */
function StopWorkflowButton({
  room,
  jobId,
  threadId,
  stopping,
  onStop,
}: {
  room: Room;
  jobId: string;
  threadId: string | null;
  stopping: boolean;
  onStop: (room: Room, jobId: string, threadId: string | null) => void;
}) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const viewerId = mx.getUserId();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const canCancel =
    !!viewerId && permissions.event(MINDROOM_BACKGROUND_JOB_CANCEL_EVENT, viewerId);
  if (!canCancel) return null;
  return (
    <Button
      type="button"
      size="300"
      variant="Critical"
      fill="Soft"
      disabled={stopping}
      onClick={() => onStop(room, jobId, threadId)}
    >
      <Text size="B300">
        {stopping ? t('mindroomUi.workflowRun.stopping') : t('mindroomUi.workflowRun.stop')}
      </Text>
    </Button>
  );
}

/**
 * Renders a workflow run's durable notice card, overlaid with live ephemeral frames when newer.
 */
export function WorkflowRunCard({
  card,
  roomId,
  threadId = null,
  sender,
  readOnly = false,
}: WorkflowRunCardProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const mx = useMatrixClient();
  const jotaiStore = useStore();
  const room = mx.getRoom(roomId);
  const viewerId = mx.getUserId();
  const live = useWorkflowRun(roomId, card.run);
  const useLive = isLiveEntryNewer(live, card);

  const status = useLive ? live!.meta.status : card.status;
  const counts = useLive ? live!.meta.counts : card.counts;
  const usage = useLive ? live!.meta.usage : card.usage;
  const title = useLive ? live!.meta.title : card.title;
  const name = useLive ? live!.meta.name ?? card.name : card.name;
  const attempt = useLive ? live!.meta.attempt : card.attempt;
  const startedAt = useLive ? live!.meta.startedAt : card.startedAt;
  const endedAt = useLive ? live!.meta.endedAt : card.endedAt;
  const large = useLive ? live!.meta.large : card.large;
  const phases = useLive && live!.graph.phases.length > 0 ? live!.graph.phases : card.phases;
  const isLiveStatus = isLiveWorkflowRunStatus(status);

  const [now, setNow] = useState(Date.now);
  useEffect(
    () => (isLiveStatus ? subscribeRelativeTimeClock(1_000, () => setNow(Date.now())) : undefined),
    [isLiveStatus]
  );

  const [stoppingFor, setStoppingFor] = useState<string | null>(null);
  const [resumingAt, setResumingAt] = useState<{ status: string; attempt: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const stopping = stoppingFor !== null && isLiveStatus && stoppingFor === card.jobId;
  const resuming =
    resumingAt !== null && resumingAt.status === status && resumingAt.attempt === attempt;

  useEffect(() => {
    if (!resuming) return undefined;
    const timer = window.setTimeout(() => setResumingAt(null), RESUME_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [resuming]);

  const heading = workflowRunHeading({ title, name }, t);
  const showSavedName = !!name && !!title && name !== title;
  const countsText = workflowRunCountsLine(counts, t);
  const costText = workflowRunCostLine(usage, t, language);
  const failedTotal = counts.failed + counts.indeterminate;

  let elapsedText: string | undefined;
  if (startedAt !== null) {
    if (isLiveStatus) {
      elapsedText = formatWorkDuration(Math.max(0, now - startedAt * 1000), language);
    } else if (endedAt !== null) {
      elapsedText = formatWorkDuration(Math.max(0, (endedAt - startedAt) * 1000), language);
    }
  }

  const showGraph = !!live || !!card.graph;
  const showStop = isLiveStatus && !readOnly && !!room && !!card.jobId;
  const isRequester = !readOnly && !!room && card.requester !== null && viewerId === card.requester;
  const showResume =
    isRequester &&
    (status === 'failed' || status === 'cancelled' || status === 'interrupted');
  const showRunAgain = isRequester && status === 'completed';

  const handleOpenGraph = () => {
    getWorkflowRunStore(mx).showCard(roomId, sender ?? '', card, Date.now(), threadId);
    openWorkflowRunPanel(jotaiStore, roomId, card.run, threadId);
  };

  const handleStop = async (targetRoom: Room, jobId: string, targetThreadId: string | null) => {
    if (stopping) return;
    setActionError(null);
    setStoppingFor(jobId);
    try {
      await cancelBackgroundJob(mx, targetRoom, targetThreadId, { jobId });
    } catch {
      setStoppingFor(null);
      setActionError(t('activity.actions.failed'));
    }
  };

  const handleResume = async () => {
    if (!room || resuming) return;
    setActionError(null);
    setResumingAt({ status, attempt });
    try {
      await sendWorkflowRunResume(mx, room, threadId, card.run);
    } catch {
      setResumingAt(null);
      setActionError(t('activity.actions.failed'));
    }
  };

  return (
    <section
      className={css.Card}
      aria-label={heading}
      data-workflow-run-card={card.run}
      data-workflow-run-status={status}
    >
      <div className={css.Header}>
        <div className={css.TitleGroup}>
          <Text as="span" size="T400" className={css.Title} {...ownDirectionLine}>
            {heading}
          </Text>
          {showSavedName && (
            <span className={css.MetaBadge} {...ownDirectionLine}>
              {name}
            </span>
          )}
          {attempt > 1 && (
            <span className={css.MetaBadge}>
              {t('mindroomUi.workflowRun.attempt', { number: attempt })}
            </span>
          )}
          {large && <span className={css.MetaBadge}>{t('mindroomUi.workflowRun.largeRun')}</span>}
        </div>
        <span className={css.StatusPill[status]}>{workflowRunStatusLabel(status, t)}</span>
      </div>

      {phases.length > 0 && (
        <ul className={css.Phases} aria-label={t('mindroomUi.workflowRun.title')}>
          {phases.map((phase) => (
            <li key={phase} className={css.PhaseChip} {...ownDirectionLine}>
              {phase}
            </li>
          ))}
        </ul>
      )}

      <div className={css.Metrics}>
        <Text as="span" size="T300">
          {countsText}
        </Text>
        {counts.cached > 0 && (
          <Text as="span" size="T200" priority="300">
            {t('mindroomUi.workflowRun.reused', { count: counts.cached })}
          </Text>
        )}
        {!isLiveStatus && failedTotal > 0 && (
          <Text as="span" size="T200" className={css.FailedBadge}>
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

      {!isLiveStatus && card.error && (
        <Text size="T200" className={css.ErrorLine} {...ownDirectionBlock}>
          {card.error}
        </Text>
      )}

      {(showGraph || showStop || showResume || showRunAgain) && (
        <div className={css.Actions}>
          {showGraph && (
            <Button
              type="button"
              size="300"
              variant="Secondary"
              fill="Soft"
              onClick={handleOpenGraph}
            >
              <Text size="B300">{t('mindroomUi.workflowRun.graph')}</Text>
            </Button>
          )}
          {showStop && room && card.jobId && (
            <StopWorkflowButton
              room={room}
              jobId={card.jobId}
              threadId={threadId}
              stopping={stopping}
              onStop={(targetRoom, jobId, targetThreadId) =>
                void handleStop(targetRoom, jobId, targetThreadId)
              }
            />
          )}
          {(showResume || showRunAgain) && (
            <Button
              type="button"
              size="300"
              variant="Primary"
              fill="Soft"
              disabled={resuming}
              onClick={() => void handleResume()}
            >
              <Text size="B300">
                {resuming
                  ? t('mindroomUi.workflowRun.starting')
                  : showRunAgain
                  ? t('mindroomUi.workflowRun.runAgain')
                  : t('mindroomUi.workflowRun.resume')}
              </Text>
            </Button>
          )}
        </div>
      )}

      {actionError && (
        <Text role="alert" size="T200" className={css.Alert}>
          {actionError}
        </Text>
      )}
    </section>
  );
}
