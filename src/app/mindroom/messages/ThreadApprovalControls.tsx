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
            <div className={css.DialogBody}>{children}</div>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export function ApprovalGroup({ children }: { children: React.ReactNode }) {
  const glassRef = useGlassHighlight<HTMLElement>();
  return (
    <section ref={glassRef} className={css.Group}>
      {children}
    </section>
  );
}

export function ApprovalReviewGroup({ records }: { records: readonly ThreadApprovalRecord[] }) {
  const { t } = useTranslation();
  const context = useThreadApprovals();
  const user = useMatrixClient().getUserId();
  const [reason, setReason] = useState('');
  const reasonId = useId();
  if (!context || records.length === 0) return null;
  const { approval } = records[0];
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
  return (
    <ApprovalGroup>
      <b>
        {t('mindroomUi.messages.threadApprovalControls.operationCallCount', {
          operation: getToolApprovalOperationLabel(approval),
          count: records.length,
        })}
      </b>
      <small>
        {t('mindroomUi.messages.threadApprovalControls.requestedBy', {
          agent: approval.agentName,
          requester:
            approval.requesterId ?? t('mindroomUi.messages.threadApprovalControls.unknown'),
        })}
      </small>
      {records.map((record, index) => (
        <ApprovalReviewCall
          key={record.eventId}
          record={record}
          index={index}
          userId={user}
          action={context.actions.get(record.eventId)}
          now={context.now}
          submit={context.submit}
        />
      ))}
      <div className={css.Actions}>
        <Button
          size="300"
          variant="Success"
          onClick={() => {
            approvable.forEach((record) => {
              void context.submit(record, { status: 'approved' });
            });
          }}
          disabled={approvable.length === 0}
        >
          <Text size="B300">
            {t('mindroomUi.messages.threadApprovalControls.approveAllOnce', {
              count: approvable.length || records.length,
            })}
          </Text>
        </Button>
        <Button
          size="300"
          variant="Critical"
          outlined
          disabled={available.length === 0}
          onClick={() => {
            available.forEach((record) => {
              void context.submit(record, { status: 'denied', reason });
            });
          }}
        >
          <Text size="B300">
            {t('mindroomUi.messages.threadApprovalControls.denyAll', {
              count: available.length || records.length,
            })}
          </Text>
        </Button>
      </div>
      {available.length > 0 && (
        <div>
          <small id={reasonId}>
            {t('mindroomUi.messages.threadApprovalControls.reasonForDenyingAllOptional')}
          </small>
          <Input
            aria-labelledby={reasonId}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            style={{ display: 'block', width: '100%', padding: 6 }}
          />
        </div>
      )}
      {timed.length > 0 && (
        <>
          <small>
            {t(
              'mindroomUi.messages.threadApprovalControls.allowThisOperationForThisThreadRequesterAndAgentArguments'
            )}
          </small>
          <div className={css.Actions}>
            {timed.map((duration) => (
              <Button
                key={duration}
                size="300"
                outlined
                disabled={approvable.length === 0}
                onClick={() => {
                  if (approvable[0])
                    void context.submit(approvable[0], { status: 'approved', duration });
                }}
              >
                <Text size="B300">
                  {t('mindroomUi.messages.threadApprovalControls.allowForMinutes', {
                    count: duration / 60,
                  })}
                </Text>
              </Button>
            ))}
          </div>
        </>
      )}
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
  const user = useMatrixClient().getUserId();
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
  let statusText =
    pendingCount > 0
      ? awaitingOnly
        ? t('mindroomUi.messages.threadApprovalControls.awaitingConfirmation', {
            count: pendingCount,
          })
        : t('mindroomUi.messages.threadApprovalControls.pausedForApproval', {
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
            <ApprovalReviewGroup key={records[0].eventId} records={records} />
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

export function ApprovalHistory({ records }: { records: readonly ThreadApprovalRecord[] }) {
  const glassRef = useGlassHighlight<HTMLDetailsElement>();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (records.length === 0) return null;
  const approved = records.filter((record) => record.approval.status === 'approved').length;
  return (
    <details
      ref={glassRef}
      className={css.Receipt}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={css.ReceiptHeader}>
        <Icon src={Icons.Terminal} size="50" aria-hidden />
        <span className={css.ReceiptLabel}>
          {t('mindroomUi.messages.threadApprovalControls.toolApprovalCount', {
            count: records.length,
          })}
        </span>
        <span className={css.ReceiptMeta}>
          {t('mindroomUi.messages.threadApprovalControls.approvedCount', { count: approved })}
        </span>
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
