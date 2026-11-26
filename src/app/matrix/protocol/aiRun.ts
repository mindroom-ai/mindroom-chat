import { STREAM_STATUS_TS_KEY } from './editMetadata';

const AI_RUN_METADATA_KEY = 'io.mindroom.ai_run';

type AiRunModel = {
  config?: unknown;
  display_name?: unknown;
  id?: unknown;
  provider?: unknown;
};

type AiRunUsage = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_tokens?: unknown;
  cache_write_tokens?: unknown;
  uncached_input_tokens?: unknown;
  time_to_first_token?: unknown;
};

type AiRunContext = {
  input_tokens?: unknown;
  window_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  uncached_input_tokens?: unknown;
};

type AiRunTools = {
  count?: unknown;
};

type AiRunCost = {
  usd?: unknown;
  subagents_usd?: unknown;
};

type AiRunError = {
  kind?: unknown;
  title?: unknown;
  summary?: unknown;
  detail?: unknown;
  code?: unknown;
  status_code?: unknown;
  provider?: unknown;
  retryable?: unknown;
  action?: unknown;
};

export type AiRunErrorAction = 'continue' | 'retry' | 'compact';

export type AiRunErrorKind =
  | 'stream_stalled'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'timeout'
  | 'context_window'
  | 'tokens_per_minute'
  | 'safeguard_refusal'
  | 'quota_exhausted'
  | 'missing_api_key'
  | 'authentication_failed'
  | 'runtime_error';

export type AiRunErrorInfo = {
  kind: string;
  title: string;
  summary: string;
  detail?: string;
  code?: string;
  statusCode?: number;
  provider?: string;
  retryable: boolean;
  action?: AiRunErrorAction;
};

type AiRunMetadata = {
  version?: unknown;
  status?: unknown;
  run_id?: unknown;
  session_id?: unknown;
  model?: unknown;
  usage?: unknown;
  context?: unknown;
  tools?: unknown;
  cost?: unknown;
  error?: unknown;
};

export type AiRunInfo = {
  status?: string;
  runId?: string;
  sessionId?: string;
  modelConfig?: string;
  /** Trimmed, nonempty display name from message metadata. */
  modelDisplayName?: string;
  modelId?: string;
  modelProvider?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  /** Input that was not read from cache, split by the backend with each provider's cache accounting. */
  uncachedInputTokens?: number;
  /** The part of the uncached input written to cache; the backend leaves out a zero count. */
  cacheWriteTokens?: number;
  timeToFirstToken?: number;
  contextInputTokens?: number;
  contextWindowTokens?: number;
  contextCacheReadInputTokens?: number;
  contextUncachedInputTokens?: number;
  toolCount?: number;
  /** The reply's own cost in USD at the deployment's configured model prices. */
  costUsd?: number;
  /**
   * What the subagent turns cost whose results the reply's turn received, their own nested
   * subagents included, in USD at the same prices; not part of `costUsd`.
   */
  subagentsCostUsd?: number;
  error?: AiRunErrorInfo;
};

/** The model a run used, as `io.mindroom.ai_run` and sub-agent frames send it. */
export type AiRunModelInfo = Pick<
  AiRunInfo,
  'modelConfig' | 'modelDisplayName' | 'modelId' | 'modelProvider'
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const DECIMAL_STRING = /^\d+(\.\d+)?(e[-+]?\d+)?$/i;

// Matrix event JSON forbids floats, so the backend sends fractional values as decimal strings.
const asNonNegativeDecimal = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' && DECIMAL_STRING.test(value) ? Number(value) : value;
  const number = asFiniteNumber(parsed);
  return number !== undefined && number >= 0 ? number : undefined;
};

/** A `model` object `{config, display_name?, id?, provider?}`; undefined unless it names a model. */
export const parseAiRunModel = (value: unknown): AiRunModelInfo | undefined => {
  if (!isRecord(value)) return undefined;
  const model = value as AiRunModel;
  const info: AiRunModelInfo = {
    modelConfig: asString(model.config),
    modelDisplayName: asString(model.display_name)?.trim() || undefined,
    modelId: asString(model.id),
    modelProvider: asString(model.provider),
  };
  return Object.values(info).some((field) => field !== undefined) ? info : undefined;
};

const AI_RUN_ERROR_ACTIONS: ReadonlySet<string> = new Set<AiRunErrorAction>([
  'continue',
  'retry',
  'compact',
]);

const asTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asPositiveInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

const asAiRunErrorAction = (value: unknown): AiRunErrorAction | undefined =>
  typeof value === 'string' && AI_RUN_ERROR_ACTIONS.has(value)
    ? (value as AiRunErrorAction)
    : undefined;

/** Structured run failure payload inside io.mindroom.ai_run; ignores malformed shapes. */
export const parseAiRunError = (value: unknown): AiRunErrorInfo | undefined => {
  if (!isRecord(value)) return undefined;
  const error = value as AiRunError;
  const kind = asTrimmedString(error.kind);
  const title = asTrimmedString(error.title);
  const summary = asTrimmedString(error.summary);
  if (!kind || !title || !summary) return undefined;

  const detail = asTrimmedString(error.detail);
  const code = asTrimmedString(error.code);
  const statusCode = asPositiveInteger(error.status_code);
  const provider = asTrimmedString(error.provider);
  const action = asAiRunErrorAction(error.action);

  return {
    kind,
    title,
    summary,
    ...(detail !== undefined ? { detail } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(provider !== undefined ? { provider } : {}),
    retryable: typeof error.retryable === 'boolean' ? error.retryable : false,
    ...(action !== undefined ? { action } : {}),
  };
};

const getAiRunMetadataFromCandidate = (
  content: Record<string, unknown>
): AiRunMetadata | undefined => {
  const metadata = content[AI_RUN_METADATA_KEY];
  if (!isRecord(metadata)) return undefined;
  if (metadata.version !== 1) return undefined;
  return metadata;
};

const getAiRunMetadata = (content: Record<string, unknown>): AiRunMetadata | undefined => {
  const newContent = isRecord(content['m.new_content']) ? content['m.new_content'] : undefined;

  if (newContent) {
    const fromNewContent = getAiRunMetadataFromCandidate(newContent);
    if (fromNewContent) return fromNewContent;
  }

  return getAiRunMetadataFromCandidate(content);
};

export const getAiRunInfo = (content: Record<string, unknown>): AiRunInfo | undefined => {
  const metadata = getAiRunMetadata(content);
  if (!metadata) return undefined;

  const usage = isRecord(metadata.usage) ? (metadata.usage as AiRunUsage) : undefined;
  const context = isRecord(metadata.context) ? (metadata.context as AiRunContext) : undefined;
  const tools = isRecord(metadata.tools) ? (metadata.tools as AiRunTools) : undefined;
  const cost = isRecord(metadata.cost) ? (metadata.cost as AiRunCost) : undefined;

  const info: AiRunInfo = {
    status: asString(metadata.status),
    runId: asString(metadata.run_id),
    sessionId: asString(metadata.session_id),
    ...parseAiRunModel(metadata.model),
    inputTokens: asFiniteNumber(usage?.input_tokens),
    outputTokens: asFiniteNumber(usage?.output_tokens),
    cacheReadTokens: asFiniteNumber(usage?.cache_read_tokens),
    uncachedInputTokens: asFiniteNumber(usage?.uncached_input_tokens),
    cacheWriteTokens: asFiniteNumber(usage?.cache_write_tokens),
    timeToFirstToken: asNonNegativeDecimal(usage?.time_to_first_token),
    contextInputTokens: asFiniteNumber(context?.input_tokens),
    contextWindowTokens: asFiniteNumber(context?.window_tokens),
    contextCacheReadInputTokens: asFiniteNumber(context?.cache_read_input_tokens),
    contextUncachedInputTokens: asFiniteNumber(context?.uncached_input_tokens),
    toolCount: asFiniteNumber(tools?.count),
    costUsd: asNonNegativeDecimal(cost?.usd),
    subagentsCostUsd: asNonNegativeDecimal(cost?.subagents_usd),
    error: parseAiRunError(metadata.error),
  };

  const hasAnyInfo = Object.values(info).some((value) => value !== undefined);
  return hasAnyInfo ? info : undefined;
};

/** The kinds of tokens a reply's model requests used, in the order they are shown. */
export const AI_RUN_TOKEN_KINDS = [
  'cacheRead',
  'cacheWrite',
  'notCached',
  'newInput',
  'input',
  'output',
] as const;
export type AiRunTokenKind = (typeof AI_RUN_TOKEN_KINDS)[number];
export type AiRunTokenCounts = Partial<Record<AiRunTokenKind, number>>;

/**
 * The tokens a reply's own model requests used, by kind. Input splits by cache only where the
 * backend reported the split, and its uncached part into cache writes and the rest only where it
 * counted the writes: it leaves out a zero count, and some providers cache without counting
 * writes, so without the count the uncached input stays one part.
 */
export const getAiRunTokenCounts = (info: AiRunInfo): AiRunTokenCounts => {
  const counts: AiRunTokenCounts = {};
  const add = (kind: AiRunTokenKind, tokens: number | undefined) => {
    if (tokens !== undefined && tokens > 0) counts[kind] = tokens;
  };
  const uncached = info.uncachedInputTokens;
  if (uncached === undefined) add('input', info.inputTokens);
  else {
    add('cacheRead', info.cacheReadTokens);
    if (info.cacheWriteTokens === undefined) add('newInput', uncached);
    else {
      const writes = Math.min(Math.max(0, info.cacheWriteTokens), uncached);
      add('cacheWrite', writes);
      add('notCached', uncached - writes);
    }
  }
  add('output', info.outputTokens);
  return counts;
};

/** The run details without their costs, for a sender whose cost does not count. */
export const withoutAiRunCost = (info: AiRunInfo): AiRunInfo => ({
  ...info,
  costUsd: undefined,
  subagentsCostUsd: undefined,
});

const TERMINAL_AI_RUN_STATUSES = new Set([
  'completed',
  'cached',
  'error',
  'cancelled',
  'interrupted',
]);

export const STREAM_STATUS_KEY = 'io.mindroom.stream_status';
export const SUPPRESS_PUSH_KEY = 'io.mindroom.suppress_push';
// 'pending' counts as active so callers driving spinners (e.g. thread streaming
// state) treat a not-yet-started run as still in flight.
export const ACTIVE_STREAM_STATUSES = new Set(['active', 'pending', 'running', 'streaming']);
export const TERMINAL_STREAM_STATUSES = new Set([
  'complete',
  'completed',
  'done',
  'error',
  'failed',
  'stopped',
  'cancelled',
  'interrupted',
]);

/** Run statuses of a reply that finished on its own; a failed or stopped one keeps its work open. */
export const FINISHED_AI_RUN_STATUSES = new Set(['completed', 'cached']);

/** The terminal stream statuses of a reply that finished on its own. */
export const SUCCESSFUL_STREAM_STATUSES = new Set(['complete', 'completed', 'done']);

export const getStreamStatusFromContent = (
  content: Record<string, unknown>
): string | undefined => {
  const newContent = isRecord(content['m.new_content']) ? content['m.new_content'] : undefined;

  const raw = newContent?.[STREAM_STATUS_KEY] ?? content[STREAM_STATUS_KEY];
  return typeof raw === 'string' && raw.length > 0 ? raw.toLowerCase() : undefined;
};

// Some producers wrap the stream status in a `{ status | state }` record instead
// of writing a plain string. Fall back to that shape when the shared string
// helper (which only accepts strings) yields nothing.
const getStatusFromRecordMetadata = (metadata: unknown): string | undefined => {
  if (!isRecord(metadata)) return undefined;
  const statusCandidate = metadata.status ?? metadata.state;
  if (typeof statusCandidate !== 'string' || statusCandidate.length === 0) return undefined;
  return statusCandidate.toLowerCase();
};

/** The stream status in string or record form, lower-cased. */
export const readStreamStatus = (content: Record<string, unknown>): string | undefined => {
  const fromStringForm = getStreamStatusFromContent(content);
  if (fromStringForm) return fromStringForm;

  const newContent = isRecord(content['m.new_content']) ? content['m.new_content'] : undefined;
  return (
    getStatusFromRecordMetadata(newContent?.[STREAM_STATUS_KEY]) ??
    getStatusFromRecordMetadata(content[STREAM_STATUS_KEY])
  );
};

/**
 * The stream status the content carries itself. An edit without one shows the status of an older
 * edit (`getEditedEvent`, which marks it with `STREAM_STATUS_TS_KEY`): that one says how an earlier
 * run ended or paused, so it does not outweigh a run status that says the edit's own run goes on.
 */
export const readOwnStreamStatus = (content: Record<string, unknown>): string | undefined => {
  const newContent = isRecord(content['m.new_content']) ? content['m.new_content'] : undefined;
  const borrowed =
    newContent?.[STREAM_STATUS_TS_KEY] !== undefined || content[STREAM_STATUS_TS_KEY] !== undefined;
  return borrowed ? undefined : readStreamStatus(content);
};

/**
 * True only when the content itself proves the stream reached a terminal
 * state. Absent or unrecognized metadata returns false — callers must not
 * treat "not terminal" as "still streaming".
 */
export const hasTerminalStreamMetadata = (content: Record<string, unknown>): boolean => {
  const metadata = getAiRunMetadata(content);
  const aiRunStatus =
    typeof metadata?.status === 'string' ? metadata.status.toLowerCase() : undefined;
  if (aiRunStatus && TERMINAL_AI_RUN_STATUSES.has(aiRunStatus)) return true;

  const streamStatus = getStreamStatusFromContent(content);
  return !!streamStatus && TERMINAL_STREAM_STATUSES.has(streamStatus);
};

const endsOrPausesStream = (streamStatus: string | undefined): boolean =>
  streamStatus === 'approval_pending' ||
  (!!streamStatus && TERMINAL_STREAM_STATUSES.has(streamStatus));

export const isAiRunStreaming = (content: Record<string, unknown>): boolean => {
  const metadata = getAiRunMetadata(content);
  const aiRunStatus =
    typeof metadata?.status === 'string' && metadata.status.length > 0
      ? metadata.status.toLowerCase()
      : undefined;
  if (aiRunStatus && TERMINAL_AI_RUN_STATUSES.has(aiRunStatus)) return false;
  // A status the content carries itself ends or pauses the run whatever its run status says; a
  // borrowed one only when the content has no run status of its own.
  if (endsOrPausesStream(readOwnStreamStatus(content))) return false;
  if (aiRunStatus) return true;

  const streamStatus = readStreamStatus(content);
  if (endsOrPausesStream(streamStatus)) return false;
  if (streamStatus) return ACTIVE_STREAM_STATUSES.has(streamStatus);
  return !!metadata;
};

/**
 * Whether a reply finished its own run cleanly (completed or cached), without a conflicting
 * non-successful stream status (e.g. a regenerated reply streaming over a prior completed answer).
 */
export const isFinishedAgentReply = (content: Record<string, unknown>): boolean => {
  const status = getAiRunInfo(content)?.status?.toLowerCase();
  if (!status || !FINISHED_AI_RUN_STATUSES.has(status)) return false;
  const streamStatus = readStreamStatus(content);
  return !streamStatus || SUCCESSFUL_STREAM_STATUSES.has(streamStatus);
};

export { AI_RUN_METADATA_KEY };
