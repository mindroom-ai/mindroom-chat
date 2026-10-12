import { useTranslation } from 'react-i18next';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Input,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
} from 'folds';
import { PageScroll } from '../../components/page';
import { Dialog, Header } from '../../components/glass/GlassPrimitives';
import { useGlassHighlight } from '../../components/glass/liquid/useLiquidGlass';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { glassOverBackdrop } from '../../styles/Glass.css';
import { useThreadApprovals } from './ThreadApprovalProvider';
import { groupApprovalRecords, ThreadApprovalRecord } from './threadApprovalModel';
import { getToolApprovalOperationLabel } from './toolApproval';
import { ApprovalReviewCall } from './ApprovalReviewCall';
import { getApprovalCapabilities, getApprovalGrantState } from './approvalActions';
import { ApprovalGrantStatus } from './ApprovalGrantStatus';
import { ApprovalReceipt } from './ApprovalReceipt';
import { describeApprovalHistory, describeWaitingApprovals } from './approvalLabels';
import { agentDisplayName, useApprovalRoom, userDisplayName } from './approvalPeople';
import { ApprovalDurations, ApprovalMeta, ApprovalSectionHeader } from './ApprovalSection';
import * as css from './ThreadApprovals.css';

function ApprovalDialog({
  title,
  onClose,
  children,
  returnFocus,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  returnFocus: React.RefObject<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const context = useThreadApprovals();
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            setReturnFocus: () => returnFocus.current ?? false,
            onDeactivate: onClose,
            onPostDeactivate: () => {
              if (!returnFocus.current?.isConnected) context?.focusConversation?.();
            },
            clickOutsideDeactivates: true,
          }}
        >
          <Dialog
            className={glassOverBackdrop}
            variant="Background"
            role="dialog"
            aria-modal="true"
            style={{ width: '40rem', maxWidth: 'calc(100vw - 24px)' }}
            aria-label={title}
          >
            <PageScroll
              className={css.DialogScroll}
              header={
                <Header size="500" variant="Surface" style={{ padding: '0 12px' }}>
                  <Box grow="Yes">
                    <Text size="H4">{title}</Text>
                  </Box>
                  <IconButton
                    size="300"
                    aria-label={t('mindroomUi.messages.threadApprovalControls.close')}
                    onClick={onClose}
                  >
                    <Icon src={Icons.Cross} />
                  </IconButton>
                </Header>
              }
            >
              <div className={css.DialogBody}>{children}</div>
            </PageScroll>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export function ApprovalGroup({
  children,
  flat = false,
}: {
  children: React.ReactNode;
  flat?: boolean;
}) {
  const glassRef = useGlassHighlight<HTMLElement>(undefined, !flat);
  return (
    <section ref={glassRef} className={flat ? css.Section : css.Group}>
      {children}
    </section>
  );
}

export function ApprovalReviewGroup({
  records,
  flat = false,
}: {
  records: readonly ThreadApprovalRecord[];
  flat?: boolean;
}) {
  const { t } = useTranslation();
  const context = useThreadApprovals();
  const user = useMatrixClient().getUserId();
  const room = useApprovalRoom();
  const [reason, setReason] = useState('');
  const [denyingAll, setDenyingAll] = useState(false);
  const reasonInput = useRef<HTMLInputElement>(null);
  const callsId = useId();
  const records0 = records[0];
  const availableCount = context
    ? records.filter(
        (record) =>
          getApprovalCapabilities(record, user, context.actions.get(record.eventId), context.now)
            .deny && record.approval.approvable
      ).length
    : 0;
  // Bulk approval stands in for the calls; without it, each call needs its own controls.
  const [showCalls, setShowCalls] = useState(availableCount <= 1);
  useEffect(() => {
    if (denyingAll) reasonInput.current?.focus();
  }, [denyingAll]);
  if (!context || !records0) return null;
  const { approval } = records0;
  const available = records.filter(
    (record) =>
      getApprovalCapabilities(record, user, context.actions.get(record.eventId), context.now).deny
  );
  const approvable = available.filter((record) => record.approval.approvable);
  const timed =
    approval.approverUserId === user && approval.scope && approvable.length === available.length
      ? approval.autoApproveOptions.filter((duration) =>
          approvable.every((record) =>
            getApprovalCapabilities(
              record,
              user,
              context.actions.get(record.eventId),
              context.now
            ).durations.includes(duration)
          )
        )
      : [];
  const states = records.map((record) => context.actions.get(record.eventId)?.status);
  const chip = states.every((status) => status === 'submitted')
    ? {
        label: t('mindroomUi.messages.threadApprovalControls.chipSubmitted'),
        tone: 'done' as const,
      }
    : states.some((status) => status === 'sending')
    ? {
        label: t('mindroomUi.messages.threadApprovalControls.chipSending'),
        tone: 'neutral' as const,
      }
    : available.length > 0
    ? {
        label: t('mindroomUi.messages.threadApprovalControls.waitingForYou'),
        tone: 'attention' as const,
      }
    : {
        label: t('mindroomUi.messages.threadApprovalControls.waitingForApproval'),
        tone: 'neutral' as const,
      };
  const single = records.length === 1;
  const calls = records.map((record, index) => (
    <ApprovalReviewCall
      key={record.eventId}
      record={record}
      index={index}
      single={single}
      offersDurations={timed.length > 0}
      userId={user}
      action={context.actions.get(record.eventId)}
      now={context.now}
      submit={context.submit}
    />
  ));
  return (
    <ApprovalGroup flat={flat}>
      <ApprovalSectionHeader
        operation={getToolApprovalOperationLabel(approval)}
        count={records.length}
        chip={chip}
      />
      <ApprovalMeta approval={approval} room={room} viewerId={user} />
      {single ? (
        calls
      ) : (
        <>
          <Button
            type="button"
            size="300"
            variant="Secondary"
            fill="Soft"
            radii="300"
            className={css.CallsToggle}
            aria-expanded={showCalls}
            aria-controls={callsId}
            onClick={() => setShowCalls((value) => !value)}
            before={<Icon size="50" src={showCalls ? Icons.ChevronTop : Icons.ChevronBottom} />}
          >
            <Text size="B300">
              {showCalls
                ? t('mindroomUi.messages.threadApprovalControls.hideCalls')
                : t('mindroomUi.messages.threadApprovalControls.showCalls', {
                    count: records.length,
                  })}
            </Text>
          </Button>
          {showCalls && <div id={callsId}>{calls}</div>}
        </>
      )}
      {available.length > 1 && !denyingAll && (
        <div className={css.Actions}>
          {approvable.length > 1 && (
            <Button
              size="300"
              variant="Primary"
              fill="Solid"
              onClick={() => {
                approvable.forEach((record) => {
                  void context.submit(record, { status: 'approved' });
                });
              }}
            >
              <Text size="B300">
                {t('mindroomUi.messages.threadApprovalControls.approveAllOnce', {
                  count: approvable.length,
                })}
              </Text>
            </Button>
          )}
          <Button
            size="300"
            variant="Secondary"
            fill="None"
            outlined
            onClick={() => setDenyingAll(true)}
          >
            <Text size="B300">
              {t('mindroomUi.messages.threadApprovalControls.denyAll', {
                count: available.length,
              })}
            </Text>
          </Button>
        </div>
      )}
      {available.length > 1 && denyingAll && (
        <form
          className={css.DenyRow}
          onSubmit={(event) => {
            event.preventDefault();
            available.forEach((record) => {
              void context.submit(record, { status: 'denied', reason });
            });
            setDenyingAll(false);
            setReason('');
          }}
        >
          <Input
            ref={reasonInput}
            aria-label={t('mindroomUi.messages.threadApprovalControls.reasonForDenyingAllOptional')}
            placeholder={t('mindroomUi.messages.approvalDecisionControls.denialReasonOptional')}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          <div className={css.Actions}>
            <Button type="submit" size="300" variant="Critical" fill="Soft" outlined>
              <Text size="B300">
                {t('mindroomUi.messages.threadApprovalControls.confirmDenyAll', {
                  count: available.length,
                })}
              </Text>
            </Button>
            <Button
              type="button"
              size="300"
              variant="Secondary"
              fill="Soft"
              outlined
              onClick={() => {
                setDenyingAll(false);
                setReason('');
              }}
            >
              <Text size="B300">{t('mindroomUi.messages.approvalDecisionControls.cancel')}</Text>
            </Button>
          </div>
        </form>
      )}
      <ApprovalDurations
        durations={denyingAll ? [] : timed}
        disabled={approvable.length === 0}
        onPick={(duration) => {
          if (approvable[0]) void context.submit(approvable[0], { status: 'approved', duration });
        }}
        accessibleLabel={(duration) =>
          t('mindroomUi.messages.threadApprovalControls.allowForMinutes', { count: duration / 60 })
        }
        explanation={t(
          'mindroomUi.messages.threadApprovalControls.allowThisOperationForThisThreadRequesterAndAgentArguments'
        )}
      />
      {records.some(
        (record) =>
          context.actions.get(record.eventId)?.status === 'submitted' &&
          context.pendingEventIds.has(record.eventId)
      ) && (
        <small role="status">
          {t('mindroomUi.messages.threadApprovalControls.submittedWaitingForRoomUpdate')}
        </small>
      )}
    </ApprovalGroup>
  );
}

export function ThreadApprovalQueue() {
  const { t } = useTranslation();
  const context = useThreadApprovals();
  const mx = useMatrixClient();
  const user = mx.getUserId();
  const room = useApprovalRoom();
  const [selection, setSelection] = useState<string[][]>();
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
          agent: agentDisplayName(room, waiting.agents[0]),
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
        : waitingText ??
          t('mindroomUi.messages.threadApprovalControls.pausedForApproval', {
            count: pendingCount,
          })
      : context.error ?? '';
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
        >
          <small className={css.BarStatus} role="status">
            {pendingCount > 0 && !awaitingOnly && <Icon src={Icons.Pause} size="50" aria-hidden />}
            <span>{statusText}</span>
            {waitingTools && <span className={css.BarDetail}>{` · ${waitingTools}`}</span>}
          </small>
          {pendingCount > 0 && (
            <Button
              ref={trigger}
              size="300"
              variant={needsAttention ? 'Warning' : 'Primary'}
              fill={needsAttention ? 'Soft' : 'Solid'}
              className={classNames(css.ReviewButton, needsAttention && css.ReviewButtonPending)}
              onClick={() => {
                setPulse(0);
                setSelection(groups.map((group) => group.map((record) => record.eventId)));
              }}
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
        <ApprovalDialog
          title={t('mindroomUi.messages.threadApprovalControls.reviewToolCalls')}
          onClose={() => setSelection(undefined)}
          returnFocus={trigger}
        >
          {groupApprovalRecords(
            selection
              .flat()
              .flatMap((id) => context.records.find((record) => record.eventId === id) ?? [])
          ).map((records) => (
            <ApprovalReviewGroup key={records[0].eventId} records={records} flat />
          ))}
          {selection
            .flat()
            .some((id) => !context.records.some((record) => record.eventId === id)) && (
            <p>
              {t('mindroomUi.messages.threadApprovalControls.someRequestsAreNoLongerAvailable')}
            </p>
          )}
        </ApprovalDialog>
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
      <button ref={trigger} className={css.Chip} type="button" onClick={() => setOpen(true)}>
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
  const glassRef = useGlassHighlight<HTMLDetailsElement>();
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const room = useApprovalRoom();
  const [open, setOpen] = useState(false);
  if (records.length === 0) return null;
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
  return (
    <details
      ref={glassRef}
      className={css.Receipt}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={css.ReceiptHeader}>
        <Icon
          src={
            single?.status === 'approved'
              ? Icons.Check
              : single?.status === 'denied'
              ? Icons.Cross
              : Icons.Terminal
          }
          size="50"
          aria-hidden
        />
        <span className={css.ReceiptLabel}>
          {singleLabel ??
            t('mindroomUi.messages.threadApprovalControls.toolApprovalCount', {
              count: records.length,
            })}
        </span>
        {!single && (
          <span className={css.ReceiptMeta}>
            {t('mindroomUi.messages.threadApprovalControls.approvedCount', { count: approved })}
          </span>
        )}
        <Icon src={Icons.ChevronBottom} size="50" className={css.ReceiptChevron} aria-hidden />
      </summary>
      {open && (
        <div className={css.HistoryBody}>
          {records.map((record) => (
            <ApprovalReceipt key={record.eventId} approval={record.approval} nested />
          ))}
        </div>
      )}
    </details>
  );
}
