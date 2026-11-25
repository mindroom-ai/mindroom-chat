import React, { useEffect, useMemo, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import { Box, Button, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import {
  ApprovalDialog,
  ApprovalReviewDialog,
  HISTORY_ERROR_KEYS,
} from '../approvals/ThreadApprovalControls';
import { ThreadApprovalProvider, useThreadApprovals } from '../approvals/ThreadApprovalProvider';
import { ToolApprovalCard } from '../approvals/ToolApprovalCard';
import * as approvalCss from '../approvals/ThreadApprovals.css';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { useIgnoredUsers } from '../matrix/hooks/useIgnoredUsers';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
import {
  collectThreadApprovals,
  groupApprovalRecords,
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
};

const matchesJob = (record: ThreadApprovalRecord, job: BackgroundJobsBarItem): boolean =>
  record.approval.jobId === job.jobId ||
  (job.toolCallId !== undefined && record.approval.toolCallId === job.toolCallId);

function ThreadJobApprovalDialog({
  room,
  job,
  threadId,
  viewThreadId,
  onClose,
  returnFocus,
}: JobApprovalDialogProps & { threadId: string }) {
  const { t } = useTranslation();
  const context = useThreadApprovals();
  const { navigateRoomThread } = useRoomNavigate();
  const [selection, setSelection] = useState<string[][]>();

  const candidateSelection = useMemo(() => {
    if (selection || !context) return undefined;
    const pending = context.records.filter((record) => context.pendingEventIds.has(record.eventId));
    const matched = pending.filter((record) => matchesJob(record, job));
    // Wait for history backfill before falling back to an unrelated approval in the same thread.
    const chosen = matched.length > 0 ? matched : !context.loading ? pending : [];
    return chosen.length > 0
      ? groupApprovalRecords(chosen).map((group) => group.map((record) => record.eventId))
      : undefined;
  }, [selection, context, job]);

  useEffect(() => {
    if (!selection && candidateSelection) setSelection(candidateSelection);
  }, [selection, candidateSelection]);

  if (!context) return null;
  const activeSelection = selection ?? candidateSelection;
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
  if (!activeSelection) {
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
      selection={activeSelection}
      onClose={onClose}
      returnFocus={returnFocus}
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
}: Omit<JobApprovalDialogProps, 'viewThreadId'>) {
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
    const matched = pending.filter((record) => matchesJob(record, job));
    const chosen = matched.length > 0 ? matched : pending;
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

export function JobApprovalDialog({
  room,
  job,
  viewThreadId,
  onClose,
  returnFocus,
}: JobApprovalDialogProps) {
  const existing = useThreadApprovals();
  if (!isConfirmedMatrixEventId(job.threadId)) {
    return (
      <RoomJobApprovalDialog room={room} job={job} onClose={onClose} returnFocus={returnFocus} />
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
    />
  );
  if (existing && existing.roomId === room.roomId && existing.threadId === threadId) {
    return content;
  }
  return (
    <ThreadApprovalProvider room={room} threadId={threadId}>
      {content}
    </ThreadApprovalProvider>
  );
}
