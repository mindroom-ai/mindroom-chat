import { createContext, useContext, useId, useLayoutEffect, type ReactNode } from 'react';
import type { HTMLReactParserOptions } from 'html-react-parser';
import type { ToolApprovalStatus } from '../../matrix/protocol/toolApproval';
import type { ToolJobHandle } from '../../matrix/protocol/toolJobHandle';
import type { ReasoningSegment } from './reasoningSegments';

export type ToolCallState = 'running' | 'waiting' | 'done' | 'denied' | 'expired';

/**
 * The message being rendered: its event ID, so its tool calls can find their approval cards, and
 * its room and thread, whose menus can show or hide those calls.
 */
export type ToolCallMessage = { eventId?: string; roomId?: string; threadId?: string };
export const ToolCallMessageContext = createContext<ToolCallMessage | undefined>(undefined);

/**
 * The clock, in Unix milliseconds, of a view that shows how long its running tool calls have run
 * (the Sub-agents panel's, which ticks while a run is at it). Without one, calls show no time.
 */
export const ToolCallClockContext = createContext<number | undefined>(undefined);

/** A running call shows how long it has run only from this many seconds on. */
const TOOL_ELAPSED_MIN_SECONDS = 10;

/**
 * How long a running call has run, in seconds, by the view's clock: none before 10 seconds, nor
 * without a clock or the call's start.
 */
export const runningToolElapsed = (
  startedAt: number | undefined,
  now: number | undefined
): number | undefined => {
  if (startedAt === undefined || now === undefined) return undefined;
  const seconds = now / 1000 - startedAt;
  return seconds >= TOOL_ELAPSED_MIN_SECONDS ? seconds : undefined;
};

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

/**
 * A reply's reasoning segments and where each shows (withReasoning in Reasoning.tsx): under the
 * reply's header, or after the run of tool calls that ends at a marker.
 */
export type ReasoningSegmentsState = {
  segments: readonly ReasoningSegment[];
  /** From an anchor (a rendered tool marker's index, or 0 for the top) to its segments' indices. */
  placement: ReadonlyMap<number, readonly number[]>;
  /** Whether the bulb shows every segment. */
  open: boolean;
  /** Closes the bulb and gives it the focus, which scrolls it into view. */
  hide: () => void;
  /** The segment the model is writing, which shows under a closed bulb too until the reader closes
   * it. */
  liveIndex: number | undefined;
  /** What the segments' Markdown renders with. */
  htmlReactParserOptions: HTMLReactParserOptions;
};
export const ReasoningSegmentsContext = createContext<ReasoningSegmentsState | undefined>(
  undefined
);

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
 * the card of the job its handle names first; then each call still without a card takes the one
 * that names its call ID and its tool (a provider may reuse an ID within a reply). While `byName`,
 * the other cards go to the first call of their tool, in order, that has no card or job and names
 * no other call ID than the card's: a trace from before call IDs names none. A call whose card still waits has
 * not run, even when the reply went on without it.
 */
export const resolveToolCallStates = (
  calls: readonly {
    toolName: string;
    pending: boolean;
    job?: ToolJobHandle;
    toolCallId?: string;
  }[],
  approvals: readonly {
    toolName: string;
    status: ToolApprovalStatus;
    jobId?: string | null;
    toolCallId?: string | null;
  }[],
  byName = true
): ToolCallState[] => {
  const unmatched = [...approvals];
  const take = (match: (approval: (typeof approvals)[number]) => boolean) => {
    const index = unmatched.findIndex(match);
    return index >= 0 ? unmatched.splice(index, 1)[0]!.status : undefined;
  };
  const byJob = calls.map(({ job }) =>
    job ? take((approval) => approval.jobId === job.jobId) : undefined
  );
  const named = calls.map(
    ({ toolName, toolCallId }, callIndex) =>
      byJob[callIndex] ??
      (toolCallId
        ? take((approval) => approval.toolCallId === toolCallId && approval.toolName === toolName)
        : undefined)
  );
  return calls.map(({ toolName, pending, job, toolCallId }, callIndex) => {
    const status =
      named[callIndex] ??
      (job || !byName
        ? undefined
        : take(
            (approval) => approval.toolName === toolName && !(approval.toolCallId && toolCallId)
          ));
    if (status === 'denied' || status === 'expired') return status;
    if (status === 'pending' || (!status && job?.status === 'awaiting_approval')) return 'waiting';
    return pending ? 'running' : 'done';
  });
};

/**
 * Whether a reply's calls take approval cards by their tool's name (`byName` of
 * resolveToolCallStates); not in the reply's extras (MessageExtras.tsx), whose markers repeat
 * calls of its body, which take those cards there.
 */
export const ToolApprovalsByNameContext = createContext(true);

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
