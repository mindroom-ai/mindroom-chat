import { approvalGroupKey, isPendingApproval, ThreadApprovalRecord } from './threadApprovalModel';
import {
  buildToolApprovalResponseContent,
  buildToolApprovalRevocationContent,
  parseToolApprovalExpiryTimestamp,
  ToolApprovalDuration,
} from './toolApproval';

export type ApprovalActionState = {
  kind: 'decision' | 'revoke';
  status: 'sending' | 'submitted' | 'error';
  error?: string;
};
export type ApprovalAction =
  | { status: 'approved'; duration?: ToolApprovalDuration; reason?: string }
  | { status: 'denied'; reason?: string; duration?: never }
  | { revoke: true };

export const canSubmitApprovalDecision = (
  record: ThreadApprovalRecord,
  userId: string | null,
  state: ApprovalActionState | undefined,
  now = Date.now()
): boolean =>
  isPendingApproval(record, now) &&
  (!record.approval.approverUserId || record.approval.approverUserId === userId) &&
  (!state || state.status === 'error');
type ResponseContent =
  | ReturnType<typeof buildToolApprovalResponseContent>
  | ReturnType<typeof buildToolApprovalRevocationContent>;

export const createApprovalActions = ({
  getRecords,
  getUserId,
  threadId,
  send,
}: {
  getRecords: () => readonly ThreadApprovalRecord[];
  getUserId: () => string | null;
  threadId: string;
  send: (content: ResponseContent) => Promise<unknown>;
}) => {
  let states = new Map<string, ApprovalActionState>();
  const attempts = new Map<string, symbol>();
  const listeners = new Set<() => void>();
  const publish = () => {
    states = new Map(states);
    listeners.forEach((listener) => listener());
  };
  const relevant = (record: ThreadApprovalRecord, kind: ApprovalActionState['kind']) =>
    kind === 'decision'
      ? record.wireStatus === 'pending'
      : record.approval.autoApproval &&
        !record.approval.autoApproval.revokedAt &&
        (parseToolApprovalExpiryTimestamp(record.approval.autoApproval.expiresAt) ?? 0) >
          Date.now();
  const reconcile = () => {
    let changed = false;
    states.forEach((state, id) => {
      const record = getRecords().find((item) => item.eventId === id);
      if (!record || !relevant(record, state.kind)) {
        states.delete(id);
        attempts.delete(id);
        changed = true;
      }
    });
    if (changed) publish();
  };
  const submit = async (offered: ThreadApprovalRecord, action: ApprovalAction): Promise<void> => {
    reconcile();
    const records = getRecords();
    const record = records.find((item) => item.eventId === offered.eventId);
    if (!record) return;
    const { approval, eventId } = record;
    const previous = states.get(eventId);
    if (previous && previous.status !== 'error') return;
    const user = getUserId();
    if (approval.approverUserId && approval.approverUserId !== user) return;
    const grant = approval.autoApproval;
    const kind = 'revoke' in action ? 'revoke' : 'decision';
    if (!relevant(record, kind)) return;
    if ('revoke' in action) {
      if (!grant || user !== approval.approverUserId) return;
    } else {
      if (!canSubmitApprovalDecision(record, user, previous)) return;
      if (action.status === 'approved' && !approval.approvable) return;
      if (
        action.duration &&
        (user !== approval.approverUserId || !approval.autoApproveOptions.includes(action.duration))
      )
        return;
    }
    const affected =
      'status' in action && action.status === 'approved' && action.duration && approval.scope
        ? records.filter(
            (item) =>
              approvalGroupKey(item) === approvalGroupKey(record) &&
              isPendingApproval(item) &&
              item.approval.approvable &&
              (!states.has(item.eventId) || states.get(item.eventId)?.status === 'error')
          )
        : [record];
    const attempt = Symbol('approval action');
    affected.forEach((item) => {
      attempts.set(item.eventId, attempt);
      states.set(item.eventId, { kind, status: 'sending' });
    });
    publish();
    let result: ApprovalActionState;
    try {
      await send(
        'revoke' in action
          ? buildToolApprovalRevocationContent(grant!.grantId, threadId, eventId)
          : buildToolApprovalResponseContent(
              action.status,
              threadId,
              eventId,
              action.reason,
              action.duration
            )
      );
      result = { kind, status: 'submitted' };
    } catch (cause) {
      result = {
        kind,
        status: 'error',
        error: cause instanceof Error ? cause.message : 'Unable to send response. Try again.',
      };
    }
    affected.forEach((item) => {
      if (attempts.get(item.eventId) !== attempt) return;
      const current = getRecords().find((candidate) => candidate.eventId === item.eventId);
      if (current && relevant(current, kind)) states.set(item.eventId, result);
      else {
        states.delete(item.eventId);
        attempts.delete(item.eventId);
      }
    });
    publish();
  };
  return {
    submit,
    reconcile,
    getSnapshot: () => states as ReadonlyMap<string, ApprovalActionState>,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
