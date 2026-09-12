import React, { useId, useRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Button,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
} from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useThreadApprovals } from './ThreadApprovalProvider';
import {
  groupPendingApprovals,
  groupApprovalRecords,
  isPendingApproval,
  ThreadApprovalRecord,
} from './threadApprovalModel';
import { getToolApprovalOperationLabel, parseToolApprovalExpiryTimestamp } from './toolApproval';
import { ApprovalArguments } from './ApprovalArguments';
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
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            setReturnFocus: () => returnFocus.current ?? false,
            onDeactivate: onClose,
            clickOutsideDeactivates: true,
          }}
        >
          <Dialog
            variant="Surface"
            role="dialog"
            aria-modal="true"
            style={{ width: '40rem', maxWidth: 'calc(100vw - 24px)' }}
            aria-label={title}
          >
            <Header size="500" variant="Surface" style={{ padding: '0 12px' }}>
              <Box grow="Yes">
                <Text size="H4">{title}</Text>
              </Box>
              <IconButton size="300" aria-label="Close" onClick={onClose}>
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

export function ApprovalReviewGroup({ records }: { records: readonly ThreadApprovalRecord[] }) {
  const context = useThreadApprovals();
  const user = useMatrixClient().getUserId();
  const [reason, setReason] = useState('');
  const reasonId = useId();
  if (!context || records.length === 0) return null;
  const { approval } = records[0];
  const available = records.filter(
    (record) =>
      isPendingApproval(record, context.now) &&
      (!record.approval.approverUserId || record.approval.approverUserId === user) &&
      (!context.actions.has(record.eventId) ||
        context.actions.get(record.eventId)?.status === 'error')
  );
  const approvable = available.filter((record) => record.approval.approvable);
  const timed =
    approval.approverUserId === user && approval.scope && approvable.length === available.length
      ? approval.autoApproveOptions.filter((duration) =>
          approvable.every((record) => record.approval.autoApproveOptions.includes(duration))
        )
      : [];
  return (
    <section className={css.Group}>
      <b>
        {getToolApprovalOperationLabel(approval)} · {records.length}{' '}
        {records.length === 1 ? 'call' : 'calls'}
      </b>
      <small>
        {approval.agentName} · Requested by {approval.requesterId ?? 'unknown'}
      </small>
      {records.map((record, index) => {
        const action = context.actions.get(record.eventId);
        return (
          <div key={record.eventId} data-approval-id={record.eventId}>
            <small>
              Call {index + 1} ·{' '}
              {isPendingApproval(record, context.now)
                ? action?.status ?? 'pending'
                : record.approval.status}
            </small>
            <ApprovalArguments approval={record.approval} />
            {action?.error && (
              <p role="alert">{action.error} Retry this call using the buttons below.</p>
            )}
            {!record.approval.approvable && isPendingApproval(record, context.now) && (
              <p>This call cannot be approved here.</p>
            )}
          </div>
        );
      })}
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
          <Text size="B300">Approve {approvable.length || records.length} once</Text>
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
          <Text size="B300">Deny {available.length || records.length}</Text>
        </Button>
      </div>
      {available.length > 0 && (
        <label htmlFor={reasonId}>
          <small>Denial reason (optional)</small>
          <input
            id={reasonId}
            aria-label="Denial reason (optional)"
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            style={{ display: 'block', width: '100%', padding: 6 }}
          />
        </label>
      )}
      {timed.length > 0 && (
        <>
          <small>
            Allow this operation for this thread, requester, and agent. Arguments may differ between
            calls.
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
                <Text size="B300">Allow for {duration / 60} min</Text>
              </Button>
            ))}
          </div>
        </>
      )}
      {records.some(
        (record) =>
          context.actions.get(record.eventId)?.status === 'submitted' &&
          isPendingApproval(record, context.now)
      ) && <small role="status">Submitted. Waiting for room update.</small>}
    </section>
  );
}

export function ThreadApprovalQueue() {
  const context = useThreadApprovals();
  const [selection, setSelection] = useState<string[][]>();
  const trigger = useRef<HTMLButtonElement>(null);
  if (!context) return null;
  const groups = groupPendingApprovals(context.records, context.now);
  const pendingCount = groups.reduce((sum, group) => sum + group.length, 0);
  return (
    <>
      {(pendingCount > 0 || context.loading || context.error) && (
        <div className={css.Bar} role="region" aria-label="Thread approvals">
          <small>
            {pendingCount > 0
              ? `${pendingCount} ${pendingCount === 1 ? 'call needs' : 'calls need'} approval`
              : context.error ?? 'Checking approvals…'}
            {context.loading && pendingCount > 0 ? ' · Checking history…' : ''}
          </small>
          {pendingCount > 0 && (
            <Button
              ref={trigger}
              size="300"
              onClick={() =>
                setSelection(groups.map((group) => group.map((record) => record.eventId)))
              }
            >
              <Text size="B300">Review {pendingCount}</Text>
            </Button>
          )}
          {context.error && (
            <button type="button" className={css.Chip} onClick={context.refresh}>
              Retry history
            </button>
          )}
        </div>
      )}
      {selection && (
        <ApprovalDialog
          title="Review tool calls"
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
            <p>Some requests are no longer available.</p>
          )}
        </ApprovalDialog>
      )}
    </>
  );
}

export function ApprovalGrantStatus({ record }: { record: ThreadApprovalRecord }) {
  const context = useThreadApprovals();
  const user = useMatrixClient().getUserId();
  const grant = record.approval.autoApproval;
  if (!context || !grant) return null;
  const expiry = parseToolApprovalExpiryTimestamp(grant.expiresAt) ?? 0;
  const active = !grant.revokedAt && expiry > context.now;
  const action = context.actions.get(record.eventId);
  return (
    <>
      <p>
        {active
          ? 'Expires in ' + Math.max(1, Math.ceil((expiry - context.now) / 60_000)) + ' min'
          : grant.revokedAt
          ? 'Auto-approval stopped'
          : 'Auto-approval expired'}
        <br />
        Fixed expiry: {new Date(grant.expiresAt).toLocaleString()}
      </p>
      <small>Arguments may differ between calls.</small>
      {active && user === record.approval.approverUserId && (
        <Button
          size="300"
          variant="Critical"
          outlined
          disabled={!!action && action.status !== 'error'}
          onClick={() => {
            void context.submit(record, { revoke: true });
          }}
        >
          <Text size="B300">
            {action?.status === 'submitted' ? 'Stopping…' : 'Stop auto-approval'}
          </Text>
        </Button>
      )}
      {action?.error && <p role="alert">{action.error}</p>}
    </>
  );
}

export function ThreadApprovalPermissions() {
  const context = useThreadApprovals();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!context) return null;
  const grants = context.records.filter(
    ({ approval }) =>
      approval.status === 'approved' &&
      approval.autoApproval &&
      !approval.autoApproval.revokedAt &&
      (parseToolApprovalExpiryTimestamp(approval.autoApproval.expiresAt) ?? 0) > context.now
  );
  if (!open && grants.length === 0) return null;
  return (
    <>
      <button ref={trigger} className={css.Chip} type="button" onClick={() => setOpen(true)}>
        {grants.length} active {grants.length === 1 ? 'permission' : 'permissions'}
      </button>
      {open && (
        <ApprovalDialog
          title="Active permissions"
          onClose={() => setOpen(false)}
          returnFocus={trigger}
        >
          {grants.length === 0 && <p>No active timed permissions.</p>}
          {grants.map((record) => {
            const { approval, eventId } = record;
            return (
              <section key={eventId} className={css.Group}>
                <b>{getToolApprovalOperationLabel(approval)}</b>
                <small>
                  {approval.agentName} · {approval.requesterId} · This thread
                </small>
                <ApprovalGrantStatus record={record} />
              </section>
            );
          })}
        </ApprovalDialog>
      )}
    </>
  );
}

export function ApprovalHistory({ records }: { records: readonly ThreadApprovalRecord[] }) {
  const [open, setOpen] = useState(false);
  if (records.length === 0) return null;
  const approved = records.filter((record) => record.approval.status === 'approved').length;
  return (
    <details className={css.Receipt} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>
          {records.length} tool {records.length === 1 ? 'approval' : 'approvals'}
        </span>
        <span>{approved} approved</span>
      </summary>
      {open && (
        <div className={css.Stack}>
          {records.map((record) => (
            <ApprovalReceipt key={record.eventId} approval={record.approval} />
          ))}
        </div>
      )}
    </details>
  );
}
