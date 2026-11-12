import { createContext } from 'react';
import type { ToolApprovalStatus } from '../../matrix/protocol/toolApproval';
import type { ToolJobHandle } from '../../matrix/protocol/toolJobHandle';

export type ToolCallState = 'running' | 'waiting' | 'done' | 'denied' | 'expired';

/**
 * The message being rendered: its event ID, so its tool calls can find their approval cards, and
 * its room and thread, whose menus can show or hide those calls.
 */
export type ToolCallMessage = { eventId?: string; roomId?: string; threadId?: string };
export const ToolCallMessageContext = createContext<ToolCallMessage | undefined>(undefined);

/**
 * What happened to each call. The public trace only says started or completed, and a denied
 * call completes without a result, so calls that needed approval take their state from the
 * approval card MindRoom posted for this reply. A call that went on as a background job takes
 * the card of the job its handle names; other cards match calls by tool name, in order. A call
 * whose card still waits has not run, even when the reply went on without it.
 */
export const resolveToolCallStates = (
  calls: readonly { toolName: string; pending: boolean; job?: ToolJobHandle }[],
  approvals: readonly { toolName: string; status: ToolApprovalStatus; jobId?: string | null }[]
): ToolCallState[] => {
  const unmatched = [...approvals];
  const take = (index: number) => (index >= 0 ? unmatched.splice(index, 1)[0].status : undefined);
  const byJob = calls.map(({ job }) =>
    job ? take(unmatched.findIndex((approval) => approval.jobId === job.jobId)) : undefined
  );
  return calls.map(({ toolName, pending, job }, callIndex) => {
    const status = job
      ? byJob[callIndex]
      : take(unmatched.findIndex((approval) => approval.toolName === toolName));
    if (status === 'denied' || status === 'expired') return status;
    if (status === 'pending' || (!status && job?.status === 'awaiting_approval')) return 'waiting';
    return pending ? 'running' : 'done';
  });
};

export type ToolCallSummary = {
  state: ToolCallState;
  count: number;
  /** Tool names in call order, with repeats as "send_message ×2". */
  names: string;
};

export const summarizeToolCalls = (
  calls: readonly { toolName: string }[],
  states: readonly ToolCallState[]
): ToolCallSummary => {
  const repeats = new Map<string, number>();
  calls.forEach(({ toolName }) => repeats.set(toolName, (repeats.get(toolName) ?? 0) + 1));
  const names = [...repeats]
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(', ');
  const count = (state: ToolCallState) => states.filter((item) => item === state).length;
  if (count('running') > 0) return { state: 'running', count: calls.length, names };
  if (count('waiting') > 0) return { state: 'waiting', count: count('waiting'), names };
  if (count('done') > 0) return { state: 'done', count: count('done'), names };
  return count('denied') > 0
    ? { state: 'denied', count: count('denied'), names }
    : { state: 'expired', count: count('expired'), names };
};
