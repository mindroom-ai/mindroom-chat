import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { Button, Icon, Icons, Text } from 'folds';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { groupApprovalRecords, ThreadApprovalRecord } from '../matrix/protocol/threadApprovalModel';
import {
  getToolApprovalOperationLabel,
  parseToolApprovalExpiryTimestamp,
} from '../matrix/protocol/toolApproval';
import { IsolatedText } from '../ui/directional';
import { ActivityIcon, ThreadActivity } from '../ui/ThreadActivity';
import { getApprovalCapabilities, getApprovalGrantState } from './approvalActions';
import { ApprovalGrantStatus } from './ApprovalGrantStatus';
import { describeApprovalHistory, describeWaitingApprovals } from './approvalLabels';
import { agentDisplayName, useApprovalRoom, userDisplayName } from './approvalPeople';
import { ApprovalReceipt } from './ApprovalReceipt';
import {
  ApprovalDialog,
  ApprovalGroup,
  ApprovalReviewDialog,
  ApprovalReviewGroup,
  HISTORY_ERROR_KEYS,
} from './ApprovalReviewDialog';
import { ApprovalAgentAvatar } from './ApprovalSection';
import { summarizeArguments } from './argumentFields';
import { useThreadApprovals } from './ThreadApprovalProvider';
import * as css from './ThreadApprovals.css';

export { ApprovalDialog, ApprovalGroup, ApprovalReviewGroup };

export function ThreadApprovalQueue() {
  const { t } = useTranslation();
  const context = useThreadApprovals();
  const mx = useMatrixClient();
  const user = mx.getUserId();
  const room = useApprovalRoom();
  const [selection, setSelection] = useState<string[]>();
  const trigger = useRef<HTMLButtonElement>(null);
  const noticed = useRef(new Set<string>());
  const [pulse, setPulse] = useState(0);
  const actionableIds = useMemo(
    () =>
      context?.records
        .filter(
          (record) =>
            context.pendingEventIds.has(record.eventId) &&
            getApprovalCapabilities(record, user, context.actions.get(record.eventId), context.now)
              .deny
        )
        .map((record) => record.eventId) ?? [],
    [context, user]
  );
  const needsAttention = actionableIds.length > 0;
  useEffect(() => {
    const hasNewRequest = actionableIds.some((id) => !noticed.current.has(id));
    actionableIds.forEach((id) => noticed.current.add(id));
    if (selection || actionableIds.length === 0) setPulse(0);
    else if (hasNewRequest) setPulse((previous) => previous + 1);
  }, [actionableIds, selection]);
  if (!context) return null;
  const groups = groupApprovalRecords(
    context.records.filter((record) => context.pendingEventIds.has(record.eventId))
  );
  const awaitingOnly = groups
    .flat()
    .every(
      (record) =>
        context.actions.get(record.eventId)?.status === 'submitted' ||
        context.actions.get(record.eventId)?.status === 'sending'
    );
  const pendingCount = groups.reduce((sum, group) => sum + group.length, 0);
  const waiting =
    needsAttention && !awaitingOnly
      ? describeWaitingApprovals(
          groups.map((group) => group.filter((record) => actionableIds.includes(record.eventId)))
        )
      : undefined;
  const waitingText = waiting
    ? waiting.agents.length === 1
      ? t('mindroomUi.messages.threadApprovalControls.agentWaitingForYou', {
          agent: agentDisplayName(room, waiting.agents[0]!),
        })
      : t('mindroomUi.messages.threadApprovalControls.agentsWaitingForYou', {
          count: waiting.agents.length,
        })
    : undefined;
  const waitingTools = waiting?.tools
    .map(({ operation, count }) => (count > 1 ? `${count}× ${operation}` : operation))
    .join(', ');
  let statusText =
    pendingCount > 0
      ? awaitingOnly
        ? t('mindroomUi.messages.threadApprovalControls.awaitingConfirmation', {
            count: pendingCount,
          })
        : (waitingText ??
          t('mindroomUi.messages.threadApprovalControls.pausedForApproval', {
            count: pendingCount,
          }))
      : context.error
        ? t(HISTORY_ERROR_KEYS[context.error])
        : '';
  if (context.loading && pendingCount > 0) {
    statusText = t('mindroomUi.messages.threadApprovalControls.statusCheckingHistory', {
      status: statusText,
    });
  }
  if (context.error && pendingCount > 0) {
    statusText = t('mindroomUi.messages.threadApprovalControls.statusHistoryIncomplete', {
      status: statusText,
    });
  }
  return (
    <>
      {(pendingCount > 0 || context.error) && (
        <div
          className={css.Bar}
          role="region"
          aria-label={t('mindroomUi.messages.threadApprovalControls.threadApprovals')}
          data-approvals-bar=""
        >
          <small className={css.BarStatus} role="status">
            {waiting?.agents.length === 1 ? (
              <ApprovalAgentAvatar room={room} agentName={waiting.agents[0]!} />
            ) : (
              pendingCount > 0 && !awaitingOnly && <Icon src={Icons.Pause} size="50" aria-hidden />
            )}
            <span className={classNames(waiting && css.BarTitle)}>
              <IsolatedText text={statusText} />
            </span>
            {waitingTools && <span className={css.BarDetail}>{` · ${waitingTools}`}</span>}
          </small>
          {pendingCount > 0 && (
            <Button
              ref={trigger}
              size="300"
              variant={needsAttention ? 'Warning' : 'Primary'}
              fill="Soft"
              className={classNames(css.ReviewButton, needsAttention && css.ReviewButtonPending)}
              onClick={() => {
                setPulse(0);
                setSelection(groups.flatMap((group) => group.map((record) => record.eventId)));
              }}
              // ReviewButtonPending draws its own warning ring.
              outlined={!needsAttention}
              radii="300"
            >
              <Text size="B300">
                {t('mindroomUi.messages.threadApprovalControls.reviewCount', {
                  count: pendingCount,
                })}
              </Text>
              {needsAttention && !selection && pulse > 0 && (
                <span
                  key={pulse}
                  aria-hidden
                  className={css.ReviewPulse}
                  onAnimationEnd={() => setPulse(0)}
                />
              )}
            </Button>
          )}
          {context.error && (
            <button type="button" className={css.Chip} onClick={context.refresh}>
              {t('mindroomUi.messages.threadApprovalControls.retryHistory')}
            </button>
          )}
        </div>
      )}
      {selection && (
        <ApprovalReviewDialog
          room={room}
          eventIds={selection}
          onClose={() => setSelection(undefined)}
          returnFocus={trigger}
        />
      )}
    </>
  );
}

export function ThreadApprovalPermissions() {
  const { t } = useTranslation();
  const user = useMatrixClient().getUserId();
  const context = useThreadApprovals();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!context) return null;
  const grants = context.records.filter(
    ({ approval }) => getApprovalGrantState(approval, context.now) === 'active'
  );
  if (!open && grants.length === 0) return null;
  return (
    <>
      <button
        ref={trigger}
        className={css.HeaderChip}
        type="button"
        data-thread-status-chip=""
        onClick={() => setOpen(true)}
      >
        {t('mindroomUi.messages.threadApprovalControls.activePermissionCount', {
          count: grants.length,
        })}
      </button>
      {open && (
        <ApprovalDialog
          title={t('mindroomUi.messages.threadApprovalControls.activePermissions')}
          onClose={() => setOpen(false)}
          returnFocus={trigger}
        >
          {grants.length === 0 && (
            <p>{t('mindroomUi.messages.threadApprovalControls.noActiveTimedPermissions')}</p>
          )}
          {grants.map((record) => {
            const { approval, eventId } = record;
            return (
              <ApprovalGroup key={eventId}>
                <b>{getToolApprovalOperationLabel(approval)}</b>
                <small>
                  {t('mindroomUi.messages.threadApprovalControls.permissionScope', {
                    agent: approval.agentName,
                    requester: approval.requesterId,
                  })}
                </small>
                <ApprovalGrantStatus
                  record={record}
                  userId={user}
                  action={context.actions.get(record.eventId)}
                  now={context.now}
                  submit={context.submit}
                />
              </ApprovalGroup>
            );
          })}
        </ApprovalDialog>
      )}
    </>
  );
}

type HistoryStatus = 'approved' | 'denied' | 'expired';
const HISTORY_LABEL_KEYS = {
  you: {
    approved: 'mindroomUi.messages.threadApprovalControls.historyYouApproved',
    denied: 'mindroomUi.messages.threadApprovalControls.historyYouDenied',
    expired: 'mindroomUi.messages.threadApprovalControls.historyYouExpired',
  },
  user: {
    approved: 'mindroomUi.messages.threadApprovalControls.historyUserApproved',
    denied: 'mindroomUi.messages.threadApprovalControls.historyUserDenied',
    expired: 'mindroomUi.messages.threadApprovalControls.historyUserExpired',
  },
  nobody: {
    approved: 'mindroomUi.messages.threadApprovalControls.historyApproved',
    denied: 'mindroomUi.messages.threadApprovalControls.historyDenied',
    expired: 'mindroomUi.messages.threadApprovalControls.historyExpired',
  },
} as const;
const isHistoryStatus = (status: string): status is HistoryStatus =>
  status === 'approved' || status === 'denied' || status === 'expired';

export function ApprovalHistory({ records }: { records: readonly ThreadApprovalRecord[] }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const room = useApprovalRoom();
  const language = useAppLanguageCode();
  const [first] = records;
  if (!first) return null;
  const approved = records.filter((record) => record.approval.status === 'approved').length;
  const summary = describeApprovalHistory(records, mx.getUserId());
  const single =
    summary.kind === 'single' && isHistoryStatus(summary.status)
      ? { ...summary, status: summary.status }
      : undefined;
  let singleLabel: string | undefined;
  if (single?.actor === 'you') {
    singleLabel = t(HISTORY_LABEL_KEYS.you[single.status], { operation: single.operation });
  } else if (single?.actor) {
    singleLabel = t(HISTORY_LABEL_KEYS.user[single.status], {
      user: userDisplayName(room, single.actor.userId),
      operation: single.operation,
    });
  } else if (single) {
    singleLabel = t(HISTORY_LABEL_KEYS.nobody[single.status], { operation: single.operation });
  }
  const resolvedTs = single
    ? parseToolApprovalExpiryTimestamp(first.approval.resolvedAt ?? '')
    : undefined;
  const detail = single
    ? [
        summarizeArguments(first.approval.arguments),
        resolvedTs !== undefined &&
          new Date(resolvedTs).toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' }),
      ]
        .filter(Boolean)
        .join(' · ')
    : t('mindroomUi.messages.threadApprovalControls.approvedCount', { count: approved });
  return (
    <ThreadActivity
      icon={
        <ActivityIcon
          src={
            single?.status === 'approved'
              ? Icons.Check
              : single?.status === 'denied'
                ? Icons.Cross
                : Icons.Terminal
          }
          tone={
            single?.status === 'approved'
              ? 'success'
              : single?.status === 'denied'
                ? 'critical'
                : 'neutral'
          }
        />
      }
      title={
        singleLabel ??
        t('mindroomUi.messages.threadApprovalControls.toolApprovalCount', {
          count: records.length,
        })
      }
      detail={detail || undefined}
    >
      <div className={css.HistoryBody}>
        {records.map((record) => (
          <ApprovalReceipt key={record.eventId} approval={record.approval} nested />
        ))}
      </div>
    </ThreadActivity>
  );
}
