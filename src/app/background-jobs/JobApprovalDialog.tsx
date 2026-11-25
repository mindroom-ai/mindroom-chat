import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import { Box, Button, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import {
  ApprovalDialog,
  ApprovalReviewDialog,
  HISTORY_ERROR_KEYS,
} from '../approvals/ApprovalReviewDialog';
import { ThreadApprovalProvider, useThreadApprovals } from '../approvals/ThreadApprovalProvider';
import { ToolApprovalCard } from '../approvals/ToolApprovalCard';
import * as approvalCss from '../approvals/ThreadApprovals.css';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { useIgnoredUsers } from '../matrix/hooks/useIgnoredUsers';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
import {
  collectThreadApprovals,
  isPendingApproval,
  type ThreadApprovalRecord,
} from '../matrix/protocol/threadApprovalModel';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { subscribeRoomSignals } from '../threads/cross-room/threadSignalsReader';
import type { BackgroundJobsBarItem } from './backgroundJobsPresentation';

type JobApprovalDialogProps = {
  room: Room;
  job: BackgroundJobsBarItem;
  viewThreadId: string | null;
  onClose: () => void;
  returnFocus: React.RefObject<HTMLElement | null>;
  focusConversation?: () => void;
  fallbackFocus?: () => void;
};

/**
 * Matches only pending approvals provably owned by this job: its own `jobId` (or any waiting
 * workflow node's `node.job`), its `toolCallId`, or a direct workflow `backgroundRunId`.
 */
export const matchJobApprovals = (
  pending: readonly ThreadApprovalRecord[],
  job: Pick<BackgroundJobsBarItem, 'jobId' | 'toolCallId' | 'workflow' | 'workflowRun'>
): ThreadApprovalRecord[] => {
  const jobIds = new Set<string>([job.jobId]);
  job.workflowRun?.graph.nodes.forEach((node) => {
    if (node.status === 'waiting' && node.waitingOn === 'approval' && node.job) {
      jobIds.add(node.job);
    }
  });
  const workflowRunId = job.workflow || undefined;
  return pending.filter(
    ({ approval }) =>
      (approval.jobId !== null && jobIds.has(approval.jobId)) ||
      (job.toolCallId !== undefined && approval.toolCallId === job.toolCallId) ||
      (workflowRunId !== undefined && approval.backgroundRunId === workflowRunId)
  );
};

export function useJobApprovalReview({
  room,
  threadId,
  readOnly,
  expanded,
  hide,
  toggle,
  bar,
  focusConversation,
}: {
  room: Room;
  threadId: string | null;
  readOnly: boolean;
  expanded: boolean;
  hide: () => void;
  toggle: React.RefObject<HTMLButtonElement | null>;
  bar: React.RefObject<HTMLDivElement | null>;
  focusConversation?: () => void;
}) {
  const [target, setTarget] = useState<BackgroundJobsBarItem>();
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(undefined);
  }, [room.roomId]);

  const reviewApproval = (item: BackgroundJobsBarItem) =>
    item.waiting && !item.stopping && !item.finished && !readOnly
      ? (trigger: HTMLElement) => {
          returnFocus.current = expanded ? (toggle.current ?? trigger) : trigger;
          setTarget(item);
          hide();
        }
      : undefined;

  const dialog = target && {
    key: `${room.roomId}:${target.jobId}:${target.threadId ?? ''}`,
    props: {
      room,
      job: target,
      viewThreadId: threadId,
      onClose: () => setTarget(undefined),
      returnFocus,
      focusConversation,
      fallbackFocus: () => {
        const fallback = toggle.current ?? bar.current;
        if (fallback?.isConnected) fallback.focus();
        else focusConversation?.();
      },
    } satisfies JobApprovalDialogProps,
  };

  return { dialog, reviewApproval };
}

function ThreadJobApprovalDialog({
  room,
  job,
  threadId,
  viewThreadId,
  onClose,
  returnFocus,
  fallbackFocus,
}: JobApprovalDialogProps & { threadId: string }) {
  const { t } = useTranslation();
  const context = useThreadApprovals();
  const { navigateRoomThread } = useRoomNavigate();
  const [eventIds, setEventIds] = useState<string[]>();

  const candidateEventIds = useMemo(() => {
    if (eventIds || !context) return undefined;
    const pending = context.records.filter((record) => context.pendingEventIds.has(record.eventId));
    const chosen = matchJobApprovals(pending, job);
    return chosen.length > 0 ? chosen.map((record) => record.eventId) : undefined;
  }, [eventIds, context, job]);

  useEffect(() => {
    if (!eventIds && candidateEventIds) setEventIds(candidateEventIds);
  }, [eventIds, candidateEventIds]);

  if (!context) return null;
  const activeEventIds = eventIds ?? candidateEventIds;
  const openThreadButton =
    threadId !== viewThreadId ? (
      <Button
        type="button"
        size="300"
        variant="Secondary"
        fill="Soft"
        outlined
        radii="300"
        onClick={() => {
          navigateRoomThread(room.roomId, threadId);
          onClose();
        }}
      >
        <Text size="B300">{t('roomSchedules.openThread')}</Text>
      </Button>
    ) : null;

  let pendingBody: React.ReactNode = null;
  if (!activeEventIds) {
    if (context.loading) {
      pendingBody = (
        <Box alignItems="Center" gap="300" role="status">
          <Spinner size="200" variant="Secondary" aria-hidden />
          <Text size="T300">{t('mindroomUi.backgroundJobs.checkingApproval')}</Text>
        </Box>
      );
    } else if (context.error) {
      pendingBody = (
        <>
          <Text as="p" size="T300">
            {t(HISTORY_ERROR_KEYS[context.error])}
          </Text>
          <div className={approvalCss.Actions}>
            <Button
              type="button"
              size="300"
              variant="Primary"
              fill="Soft"
              outlined
              radii="300"
              onClick={context.refresh}
            >
              <Text size="B300">
                {t('mindroomUi.messages.threadApprovalControls.retryHistory')}
              </Text>
            </Button>
            {openThreadButton}
          </div>
        </>
      );
    } else {
      pendingBody = (
        <>
          <Text as="p" size="T300">
            {t('mindroomUi.messages.threadApprovalControls.someRequestsAreNoLongerAvailable')}
          </Text>
          {openThreadButton && <div className={approvalCss.Actions}>{openThreadButton}</div>}
        </>
      );
    }
  }

  return (
    <ApprovalReviewDialog
      room={room}
      eventIds={activeEventIds}
      onClose={onClose}
      returnFocus={returnFocus}
      fallbackFocus={fallbackFocus}
    >
      {pendingBody}
    </ApprovalReviewDialog>
  );
}

function RoomJobApprovalDialog({
  room,
  job,
  onClose,
  returnFocus,
  fallbackFocus,
}: Omit<JobApprovalDialogProps, 'viewThreadId' | 'focusConversation'>) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const ignoredUsers = useIgnoredUsers();
  const [revision, setRevision] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>();

  useEffect(
    () => subscribeRoomSignals(mx, room.roomId, () => setRevision((value) => value + 1)),
    [mx, room.roomId]
  );

  const viewerId = mx.getUserId() ?? undefined;
  const records = useMemo(() => {
    void revision;
    return collectThreadApprovals(room.getLiveTimeline().getEvents(), room.roomId, null).filter(
      (record) =>
        isMindroomAgentUserIdForViewer(record.sender, viewerId) &&
        !ignoredUsers.includes(record.sender)
    );
  }, [revision, room, viewerId, ignoredUsers]);

  const candidateIds = useMemo(() => {
    if (selectedIds) return undefined;
    const pending = records.filter((record) => isPendingApproval(record));
    const chosen = matchJobApprovals(pending, job);
    return chosen.length > 0 ? chosen.map((record) => record.eventId) : undefined;
  }, [selectedIds, records, job]);

  useEffect(() => {
    if (!selectedIds && candidateIds) setSelectedIds(candidateIds);
  }, [selectedIds, candidateIds]);

  const activeIds = selectedIds ?? candidateIds;
  const shownRecords = activeIds
    ? activeIds.flatMap((id) => records.find((record) => record.eventId === id) ?? [])
    : [];

  return (
    <ApprovalDialog
      title={t('mindroomUi.messages.threadApprovalControls.reviewToolCalls')}
      onClose={onClose}
      returnFocus={returnFocus}
      fallbackFocus={fallbackFocus}
    >
      {shownRecords.map((record) => (
        <ToolApprovalCard
          key={record.eventId}
          approval={record.approval}
          roomId={room.roomId}
          eventId={record.eventId}
        />
      ))}
      {(!activeIds || shownRecords.length < activeIds.length) && (
        <Text as="p" size="T300">
          {t('mindroomUi.messages.threadApprovalControls.someRequestsAreNoLongerAvailable')}
        </Text>
      )}
    </ApprovalDialog>
  );
}

function UnavailableJobApprovalDialog({
  onClose,
  returnFocus,
  fallbackFocus,
}: Pick<JobApprovalDialogProps, 'onClose' | 'returnFocus' | 'fallbackFocus'>) {
  const { t } = useTranslation();
  return (
    <ApprovalDialog
      title={t('mindroomUi.messages.threadApprovalControls.reviewToolCalls')}
      onClose={onClose}
      returnFocus={returnFocus}
      fallbackFocus={fallbackFocus}
    >
      <Text as="p" size="T300">
        {t('mindroomUi.messages.threadApprovalControls.someRequestsAreNoLongerAvailable')}
      </Text>
    </ApprovalDialog>
  );
}

export function JobApprovalDialog({
  room,
  job,
  viewThreadId,
  onClose,
  returnFocus,
  focusConversation,
  fallbackFocus,
}: JobApprovalDialogProps) {
  const existing = useThreadApprovals();
  const resolveFallback = fallbackFocus ?? focusConversation;
  if (job.threadId === null) {
    return (
      <RoomJobApprovalDialog
        room={room}
        job={job}
        onClose={onClose}
        returnFocus={returnFocus}
        fallbackFocus={resolveFallback}
      />
    );
  }
  if (!isConfirmedMatrixEventId(job.threadId)) {
    return (
      <UnavailableJobApprovalDialog
        onClose={onClose}
        returnFocus={returnFocus}
        fallbackFocus={resolveFallback}
      />
    );
  }
  const threadId = job.threadId;
  const content = (
    <ThreadJobApprovalDialog
      room={room}
      job={job}
      threadId={threadId}
      viewThreadId={viewThreadId}
      onClose={onClose}
      returnFocus={returnFocus}
      fallbackFocus={resolveFallback}
    />
  );
  if (existing && existing.roomId === room.roomId && existing.threadId === threadId) {
    return content;
  }
  return (
    <ThreadApprovalProvider room={room} threadId={threadId} focusConversation={focusConversation}>
      {content}
    </ThreadApprovalProvider>
  );
}
