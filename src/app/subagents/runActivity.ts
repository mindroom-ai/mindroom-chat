import type { LiveDocs } from '../matrix/protocol/liveFrame';
import {
  isRestartInterrupted,
  subagentToolStartedAt,
  type SubagentMeta,
} from '../matrix/protocol/subagentFrame';
import type { ToolTraceEvent } from '../matrix/protocol/toolTrace';

/** A tool call as a row or card shows it: its tool, its arguments when sent, and when it started. */
export type ToolActivity = { tool: string; preview?: string; startedAt?: number };

/** How long a call's arguments may run on one line before they are cut; the line truncates sooner. */
const PREVIEW_CHARS = 160;

/** The arguments on one line: runs of white space as one space, cut short past `PREVIEW_CHARS`. */
const oneLine = (preview: string): string => {
  const flat = preview.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
};

/** A tool call as a row shows it: its tool, and its arguments when sent. */
export const toolActivity = (event: ToolTraceEvent | undefined): ToolActivity | undefined => {
  const { tool_name: tool, args_preview: preview } = event ?? {};
  if (typeof tool !== 'string' || !tool) return undefined;
  const args = typeof preview === 'string' ? oneLine(preview) : '';
  const startedAt = event && subagentToolStartedAt(event);
  return {
    tool,
    ...(args ? { preview: args } : {}),
    ...(startedAt === undefined ? {} : { startedAt }),
  };
};

/**
 * The call a run makes now: the newest call its documents still show as started. None when every
 * call completed, or from a run whose frames carry no calls (MindRoom before tool frames).
 */
export const currentToolCall = (tools: readonly ToolTraceEvent[]): ToolActivity | undefined => {
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const event = tools[index];
    if (event?.type === 'tool_call_started') {
      const activity = toolActivity(event);
      if (activity) return activity;
    }
  }
  return undefined;
};

/** The call a run at work makes now, or waits to make; none once it paused or ended. */
export const runToolCall = ({
  meta,
  docs,
}: {
  meta: SubagentMeta;
  docs: LiveDocs;
}): ToolActivity | undefined =>
  meta.status === 'running' || meta.status === 'awaiting_approval'
    ? currentToolCall(docs.tools)
    : undefined;

/** How an ended run that did not finish reads: as its status, the reason after it. */
export type EndedStatus = 'cancelled' | 'failed' | 'denied' | 'interrupted';

/**
 * A card's third line, labelled by how the run stands: the call it makes now, the call that waits
 * for approval, the start of what it wrote once done, or why it stopped. A run that tells none of
 * these (older MindRoom, no call yet) shows its text as before, unlabelled (`plain`).
 */
export type RunLine =
  | { kind: 'now'; activity: ToolActivity }
  | { kind: 'approval'; activity: ToolActivity }
  | { kind: 'result'; text: string }
  | { kind: 'ended'; status: EndedStatus; reason?: string }
  | { kind: 'plain'; text?: string };

/**
 * The line for a run, from its meta and documents. `preview` is the start of what it wrote, as the
 * card's text line shows it; `reason` its result, which an ended run that did not finish names.
 */
export const runLine = (
  { meta, docs }: { meta: SubagentMeta; docs: LiveDocs },
  preview: string | undefined,
  reason: string | undefined
): RunLine => {
  const activity = runToolCall({ meta, docs });
  if (activity) return { kind: meta.status === 'running' ? 'now' : 'approval', activity };
  const why = reason ? { reason } : {};
  switch (meta.status) {
    case 'completed':
      return preview ? { kind: 'result', text: preview } : { kind: 'plain' };
    case 'cancelled':
    case 'denied':
      return { kind: 'ended', status: meta.status, ...why };
    case 'failed':
      return {
        kind: 'ended',
        status: isRestartInterrupted(meta) ? 'interrupted' : 'failed',
        ...why,
      };
    default:
      return { kind: 'plain', ...(preview ? { text: preview } : {}) };
  }
};

/** What the conversation's runs used, summed; a count no run sent is left out. */
export type RunTotals = { calls?: number; tokens?: number; costUsd?: number };

export const runTotals = (metas: readonly SubagentMeta[]): RunTotals => {
  const totals: RunTotals = {};
  metas.forEach(({ usage }) => {
    if (!usage) return;
    totals.calls = (totals.calls ?? 0) + usage.toolCalls;
    totals.tokens = (totals.tokens ?? 0) + usage.inputTokens + usage.outputTokens;
    if (usage.costUsd !== undefined) totals.costUsd = (totals.costUsd ?? 0) + usage.costUsd;
  });
  return totals;
};
