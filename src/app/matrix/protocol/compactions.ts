import { isRecord } from '../../lib/isRecord';

/** On an agent's reply and its edits: each history compaction the reply ran, in start order. */
export const COMPACTIONS_CONTENT_KEY = 'io.mindroom.compactions';
/** The older standalone `m.notice` of one compaction, still sent for manual ones. */
export const COMPACTION_NOTICE_CONTENT_KEY = 'io.mindroom.compaction';

export type CompactionStatus = 'running' | 'success' | 'failed' | 'timeout';

/**
 * One compaction, from a reply's list or an old notice. `afterTool` counts the visible tool calls
 * the reply started before it, as reasoning segments do; `manual` is only an old notice's phase.
 */
export type ReplyCompaction = {
  id: string;
  phase: 'pre_turn' | 'mid_turn' | 'manual';
  afterTool: number;
  status: CompactionStatus;
  startedAt?: number;
  durationMs?: number;
  summaryModel?: string;
  beforeTokens: number;
  afterTokens?: number;
  historyBudgetTokens?: number;
  runsBefore?: number;
  compactedRunCount?: number;
  runsRemaining?: number;
  failureReason?: string;
};

type OptionalFields = Omit<
  ReplyCompaction,
  'id' | 'phase' | 'afterTool' | 'status' | 'beforeTokens'
>;

const STATUSES: ReadonlySet<unknown> = new Set<CompactionStatus>([
  'running',
  'success',
  'failed',
  'timeout',
]);

const isStatus = (value: unknown): value is CompactionStatus => STATUSES.has(value);

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** The optional fields `entry` carries with the right type; a malformed one is left out. */
const readOptionalFields = (entry: Record<string, unknown>): OptionalFields => {
  const fields: OptionalFields = {};
  if (isAmount(entry.started_at)) fields.startedAt = entry.started_at;
  if (isAmount(entry.duration_ms)) fields.durationMs = entry.duration_ms;
  if (isText(entry.summary_model)) fields.summaryModel = entry.summary_model;
  if (isAmount(entry.after_tokens)) fields.afterTokens = entry.after_tokens;
  if (isAmount(entry.history_budget_tokens)) {
    fields.historyBudgetTokens = entry.history_budget_tokens;
  }
  if (isCount(entry.runs_before)) fields.runsBefore = entry.runs_before;
  if (isCount(entry.compacted_run_count)) fields.compactedRunCount = entry.compacted_run_count;
  if (isCount(entry.runs_remaining)) fields.runsRemaining = entry.runs_remaining;
  if (isText(entry.failure_reason)) fields.failureReason = entry.failure_reason;
  return fields;
};

const readEntry = (entry: unknown): ReplyCompaction | undefined => {
  if (!isRecord(entry)) return undefined;
  const { id, phase, after_tool: afterTool, status, before_tokens: beforeTokens } = entry;
  if (!isText(id) || (phase !== 'pre_turn' && phase !== 'mid_turn')) return undefined;
  if (!isCount(afterTool) || !isStatus(status) || !isAmount(beforeTokens)) return undefined;
  return { id, phase, afterTool, status, ...readOptionalFields(entry), beforeTokens };
};

/**
 * The compactions of a reply's `io.mindroom.compactions` list (the raw value), in start order.
 * An entry without a string id, a known phase and status, a tool count or a token count is
 * dropped; unknown keys are ignored, and a value that is not a list gives none.
 */
export const readReplyCompactions = (value: unknown): ReplyCompaction[] =>
  Array.isArray(value) ? value.flatMap((entry: unknown) => readEntry(entry) ?? []) : [];

/**
 * The compaction of an old `io.mindroom.compaction` notice, which started when the notice was
 * sent (`originTs`). Notices before version 3 carry no status and were sent only after success;
 * a failure notice carries no token count, so it reads as 0. Undefined when the content is not a
 * compaction notice or its status is unknown.
 */
export const readCompactionNotice = (
  content: Record<string, unknown>,
  originTs: number
): ReplyCompaction | undefined => {
  const notice = content[COMPACTION_NOTICE_CONTENT_KEY];
  if (!isRecord(notice)) return undefined;
  const status = notice.status === undefined ? 'success' : notice.status;
  if (!isStatus(status)) return undefined;
  const failed = status === 'failed' || status === 'timeout';
  const beforeTokens = isAmount(notice.before_tokens) ? notice.before_tokens : undefined;
  if (beforeTokens === undefined && !failed) return undefined;
  return {
    id: 'notice',
    phase: notice.mode === 'manual' ? 'manual' : 'mid_turn',
    afterTool: 0,
    status,
    ...readOptionalFields(notice),
    startedAt: originTs,
    beforeTokens: beforeTokens ?? 0,
  };
};
