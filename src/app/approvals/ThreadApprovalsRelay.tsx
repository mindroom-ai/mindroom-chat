import { createContext, useContext, useLayoutEffect } from 'react';
import type { ThreadApprovals } from './ThreadApprovalProvider';

/** The open thread's approvals: its provider's, or what a `ThreadApprovalsScope` was handed. */
export const ThreadApprovalsContext = createContext<ThreadApprovals | undefined>(undefined);

/**
 * Hands the thread's approvals on as they change, from inside their provider, for a part of the
 * page outside it that shows them too: a phone's room header, which holds the thread's chips
 * (`ThreadApprovalsScope`). The provider keeps one value while nothing in it changes, so a render
 * that follows the handing on hands nothing on again.
 */
export function ThreadApprovalsRelay({
  onChange,
}: {
  onChange: (approvals: ThreadApprovals | undefined) => void;
}) {
  const approvals = useContext(ThreadApprovalsContext);
  useLayoutEffect(() => onChange(approvals), [approvals, onChange]);
  useLayoutEffect(() => () => onChange(undefined), [onChange]);
  return null;
}

/** Gives its children the approvals a `ThreadApprovalsRelay` handed on. */
export const ThreadApprovalsScope = ThreadApprovalsContext.Provider;
