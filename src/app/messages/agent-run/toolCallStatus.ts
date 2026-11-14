import { createContext, useContext, useId, useLayoutEffect, type ReactNode } from 'react';
import type { ToolApprovalStatus } from '../../matrix/protocol/toolApproval';
import type { ToolJobHandle } from '../../matrix/protocol/toolJobHandle';

export type ToolCallState = 'running' | 'waiting' | 'done' | 'denied' | 'expired';

/**
 * The message being rendered: its event ID, so its tool calls can find their approval cards, and
 * its room and thread, whose menus can show or hide those calls.
 */
export type ToolCallMessage = { eventId?: string; roomId?: string; threadId?: string };
export const ToolCallMessageContext = createContext<ToolCallMessage | undefined>(undefined);

/** A call of a reply's hidden tool calls, as the reply's cog counts it (ToolCallsFold.tsx). */
export type FoldedToolCall = { toolName: string; state: ToolCallState };

/**
 * The cog of a reply whose tool calls are hidden: whether it shows the reply's runs of calls, and
 * where each run reports its calls (none once it is gone).
 */
export type ToolCallsFoldState = {
  open: boolean;
  report: (key: string, calls?: readonly FoldedToolCall[]) => void;
};
export const ToolCallsFoldContext = createContext<ToolCallsFoldState | undefined>(undefined);

/**
 * The reply's cog as ToolCallsFold draws it, for the top of the reply to show (withReasoning in
 * Reasoning.tsx); nothing while the reply has no hidden tool calls.
 */
export const ToolCallsCogContext = createContext<ReactNode>(null);

/** Counts a run's calls on the reply's cog while `calls` is given, and takes them back after. */
export const useFoldedToolCalls = (calls: readonly FoldedToolCall[] | undefined): void => {
  const report = useContext(ToolCallsFoldContext)?.report;
  const key = useId();
  const counted = calls !== undefined;
  // Before the browser paints, so a reply never shows without its cog and then moves its text.
  useLayoutEffect(() => {
    if (!report || !counted) return undefined;
    return () => report(key, undefined);
  }, [counted, key, report]);
  // After every render; the cog keeps its state while the calls stay the same.
  useLayoutEffect(() => {
    if (report && calls) report(key, calls);
  });
};

/** What a run of calls, or a reply's cog, says about them by their state (summarizeToolCalls). */
export const TOOL_STATE_TITLE = {
  running: 'mindroomUi.messages.mindroomHtmlBlocks.toolCallsRunning',
  waiting: 'mindroomUi.messages.mindroomHtmlBlocks.toolCallsWaiting',
  done: 'mindroomUi.messages.mindroomHtmlBlocks.toolCallsRan',
  denied: 'mindroomUi.messages.mindroomHtmlBlocks.toolCallsDenied',
  expired: 'mindroomUi.messages.mindroomHtmlBlocks.toolCallsExpired',
} as const satisfies Record<ToolCallState, string>;

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
  const take = (index: number) => (index >= 0 ? unmatched.splice(index, 1)[0]!.status : undefined);
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
