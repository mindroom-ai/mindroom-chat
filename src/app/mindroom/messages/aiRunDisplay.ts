import { MindroomAiRunInfo } from './aiRun';

export const formatMindroomAiRunNumber = (value: number | undefined): string | undefined =>
  typeof value === 'number' ? Math.round(value).toLocaleString() : undefined;

export const formatMindroomAiRunTimeToFirstToken = (
  value: number | undefined
): string | undefined => {
  if (typeof value !== 'number' || value < 0) return undefined;
  return `${Math.round(value * 1000)} ms`;
};

export const getMindroomAiRunModelLabel = (info: MindroomAiRunInfo): string | undefined => {
  const providerAndId = [info.modelProvider, info.modelId].filter(Boolean).join(' / ');
  if (info.modelConfig && providerAndId) return `${info.modelConfig} (${providerAndId})`;
  if (info.modelConfig) return info.modelConfig;
  return providerAndId || undefined;
};

export const getMindroomAiRunUsageLabel = (info: MindroomAiRunInfo): string | undefined => {
  const parts = [
    info.inputTokens !== undefined ? `in ${formatMindroomAiRunNumber(info.inputTokens)}` : undefined,
    info.outputTokens !== undefined
      ? `out ${formatMindroomAiRunNumber(info.outputTokens)}`
      : undefined,
    info.totalTokens !== undefined ? `total ${formatMindroomAiRunNumber(info.totalTokens)}` : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' • ') : undefined;
};

export const getMindroomAiRunContextLabel = (info: MindroomAiRunInfo): string | undefined => {
  const inputTokens = info.contextInputTokens;
  const windowTokens = info.contextWindowTokens;
  if (inputTokens === undefined || windowTokens === undefined || windowTokens <= 0) {
    return undefined;
  }

  const percentage = ((inputTokens / windowTokens) * 100).toFixed(1);
  return `${formatMindroomAiRunNumber(inputTokens)} / ${formatMindroomAiRunNumber(windowTokens)} (${percentage}%)`;
};
