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
  Input,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
} from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
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
    <section className={css.Group}>
      <b>
        {getToolApprovalOperationLabel(approval)} · {records.length}{' '}
        {records.length === 1 ? 'call' : 'calls'}
      </b>
      <small>
        {approval.agentName} · Requested by {approval.requesterId ?? 'unknown'}
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
          <Text size="B300">Approve all {approvable.length || records.length} once</Text>
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
          <Text size="B300">Deny all {available.length || records.length}</Text>
        </Button>
      </div>
      {available.length > 0 && (
        <div>
          <small id={reasonId}>Reason for denying all (optional)</small>
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
          context.pendingEventIds.has(record.eventId)
      ) && <small role="status">Submitted. Waiting for room update.</small>}
    </section>
  );
}

export function ThreadApprovalQueue() {
  const context = useThreadApprovals();
  const [selection, setSelection] = useState<string[][]>();
  const trigger = useRef<HTMLButtonElement>(null);
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
  return (
    <>
      {(pendingCount > 0 || context.loading || context.error) && (
        <div className={css.Bar} role="region" aria-label="Thread approvals">
          <small>
            {pendingCount > 0
              ? awaitingOnly
                ? `${pendingCount} ${pendingCount === 1 ? 'call' : 'calls'} awaiting confirmation`
                : `${pendingCount} ${pendingCount === 1 ? 'call needs' : 'calls need'} approval`
              : context.error ?? 'Checking approvals…'}
            {context.loading && pendingCount > 0 ? ' · Checking history…' : ''}
            {context.error && pendingCount > 0 ? ' · History incomplete' : ''}
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

export function ThreadApprovalPermissions() {
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
                <ApprovalGrantStatus
                  record={record}
                  userId={user}
                  action={context.actions.get(record.eventId)}
                  now={context.now}
                  submit={context.submit}
                />
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
        <Icon src={Icons.Terminal} size="50" aria-hidden />
        <span>
          {records.length} tool {records.length === 1 ? 'approval' : 'approvals'}
        </span>
        <span>{approved} approved</span>
      </summary>
      {open && (
        <div className={css.HistoryBody}>
          {records.map((record) => (
            <ApprovalReceipt key={record.eventId} approval={record.approval} />
          ))}
        </div>
      )}
    </details>
  );
}
