const AI_RUN_METADATA_KEY = 'io.mindroom.ai_run';

type MindroomAiRunModel = {
  config?: unknown;
  id?: unknown;
  provider?: unknown;
};

type MindroomAiRunUsage = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
  time_to_first_token?: unknown;
};

type MindroomAiRunContext = {
  input_tokens?: unknown;
  window_tokens?: unknown;
};

type MindroomAiRunTools = {
  count?: unknown;
};

type MindroomAiRunMetadata = {
  version?: unknown;
  status?: unknown;
  run_id?: unknown;
  session_id?: unknown;
  model?: unknown;
  usage?: unknown;
  context?: unknown;
  tools?: unknown;
};

export type MindroomAiRunInfo = {
  status?: string;
  runId?: string;
  sessionId?: string;
  modelConfig?: string;
  modelId?: string;
  modelProvider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  timeToFirstToken?: number;
  contextInputTokens?: number;
  contextWindowTokens?: number;
  toolCount?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const getMindroomAiRunMetadataFromCandidate = (
  content: Record<string, unknown>
): MindroomAiRunMetadata | undefined => {
  const metadata = content[AI_RUN_METADATA_KEY];
  if (!isRecord(metadata)) return undefined;
  if (metadata.version !== 1) return undefined;
  return metadata as MindroomAiRunMetadata;
};

const getMindroomAiRunMetadata = (
  content: Record<string, unknown>
): MindroomAiRunMetadata | undefined => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;

  if (newContent) {
    const fromNewContent = getMindroomAiRunMetadataFromCandidate(newContent);
    if (fromNewContent) return fromNewContent;
  }

  return getMindroomAiRunMetadataFromCandidate(content);
};

export const getMindroomAiRunInfo = (
  content: Record<string, unknown>
): MindroomAiRunInfo | undefined => {
  const metadata = getMindroomAiRunMetadata(content);
  if (!metadata) return undefined;

  const model = isRecord(metadata.model) ? (metadata.model as MindroomAiRunModel) : undefined;
  const usage = isRecord(metadata.usage) ? (metadata.usage as MindroomAiRunUsage) : undefined;
  const context = isRecord(metadata.context)
    ? (metadata.context as MindroomAiRunContext)
    : undefined;
  const tools = isRecord(metadata.tools) ? (metadata.tools as MindroomAiRunTools) : undefined;

  const info: MindroomAiRunInfo = {
    status: asString(metadata.status),
    runId: asString(metadata.run_id),
    sessionId: asString(metadata.session_id),
    modelConfig: asString(model?.config),
    modelId: asString(model?.id),
    modelProvider: asString(model?.provider),
    inputTokens: asFiniteNumber(usage?.input_tokens),
    outputTokens: asFiniteNumber(usage?.output_tokens),
    totalTokens: asFiniteNumber(usage?.total_tokens),
    timeToFirstToken: asFiniteNumber(usage?.time_to_first_token),
    contextInputTokens: asFiniteNumber(context?.input_tokens),
    contextWindowTokens: asFiniteNumber(context?.window_tokens),
    toolCount: asFiniteNumber(tools?.count),
  };

  const hasAnyInfo = Object.values(info).some((value) => value !== undefined);
  return hasAnyInfo ? info : undefined;
};

export const hasMindroomAiRunMetadata = (content: Record<string, unknown>): boolean =>
  !!getMindroomAiRunMetadata(content);

export { AI_RUN_METADATA_KEY };
