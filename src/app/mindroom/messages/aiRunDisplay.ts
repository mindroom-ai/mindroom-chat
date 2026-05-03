import { MindroomAiRunInfo } from './aiRun';

export type MindroomAiRunContextBarSegment = {
  key: 'cacheRead' | 'newInput' | 'reserve';
  label: string;
  tokens: number;
  percentage: number;
  title: string;
};

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
    info.inputTokens !== undefined
      ? `in ${formatMindroomAiRunNumber(info.inputTokens)}`
      : undefined,
    info.outputTokens !== undefined
      ? `out ${formatMindroomAiRunNumber(info.outputTokens)}`
      : undefined,
    info.totalTokens !== undefined
      ? `total ${formatMindroomAiRunNumber(info.totalTokens)}`
      : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' • ') : undefined;
};

export const getMindroomAiRunUsageCacheLabel = (info: MindroomAiRunInfo): string | undefined => {
  const parts = [
    info.cacheReadTokens !== undefined
      ? `read ${formatMindroomAiRunNumber(info.cacheReadTokens)}`
      : undefined,
    info.cacheWriteTokens !== undefined
      ? `write ${formatMindroomAiRunNumber(info.cacheWriteTokens)}`
      : undefined,
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
  return `${formatMindroomAiRunNumber(inputTokens)} / ${formatMindroomAiRunNumber(
    windowTokens
  )} (${percentage}%)`;
};

export const getMindroomAiRunContextCacheLabel = (info: MindroomAiRunInfo): string | undefined => {
  const parts = [
    info.contextCacheReadInputTokens !== undefined
      ? `read ${formatMindroomAiRunNumber(info.contextCacheReadInputTokens)}`
      : undefined,
    info.contextCacheWriteInputTokens !== undefined
      ? `write ${formatMindroomAiRunNumber(info.contextCacheWriteInputTokens)}`
      : undefined,
    info.contextUncachedInputTokens !== undefined
      ? `not read ${formatMindroomAiRunNumber(info.contextUncachedInputTokens)}`
      : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' • ') : undefined;
};

const isValidContextBarTokenCount = (value: number | undefined): value is number =>
  typeof value === 'number' && value >= 0;

const formatMindroomAiRunContextBarPercentage = (value: number, windowTokens: number): string =>
  ((value / windowTokens) * 100).toFixed(1);

const getMindroomAiRunContextBarTitle = (
  label: string,
  tokens: number,
  windowTokens: number,
  suffix?: string
): string => {
  const tokenLabel = tokens === 1 ? 'token' : 'tokens';
  const percentage = formatMindroomAiRunContextBarPercentage(tokens, windowTokens);
  return `${label}: ${formatMindroomAiRunNumber(tokens)} ${tokenLabel} (${percentage}% of window)${
    suffix ? `; ${suffix}` : ''
  }`;
};

export const getMindroomAiRunContextBarSegments = (
  info: MindroomAiRunInfo
): MindroomAiRunContextBarSegment[] | undefined => {
  const inputTokens = info.contextInputTokens;
  const windowTokens = info.contextWindowTokens;
  const cacheReadTokens = info.contextCacheReadInputTokens;
  const uncachedTokens = info.contextUncachedInputTokens;

  if (
    !isValidContextBarTokenCount(inputTokens) ||
    !isValidContextBarTokenCount(windowTokens) ||
    windowTokens <= 0 ||
    !isValidContextBarTokenCount(cacheReadTokens) ||
    !isValidContextBarTokenCount(uncachedTokens) ||
    inputTokens > windowTokens ||
    cacheReadTokens + uncachedTokens !== inputTokens
  ) {
    return undefined;
  }

  const reserveTokens = windowTokens - inputTokens;
  const cacheWriteSuffix =
    info.contextCacheWriteInputTokens !== undefined
      ? `cache write: ${formatMindroomAiRunNumber(info.contextCacheWriteInputTokens)} tokens`
      : undefined;

  return [
    {
      key: 'cacheRead',
      label: 'Cache read',
      tokens: cacheReadTokens,
      percentage: (cacheReadTokens / windowTokens) * 100,
      title: getMindroomAiRunContextBarTitle('Cache read', cacheReadTokens, windowTokens),
    },
    {
      key: 'newInput',
      label: 'New input',
      tokens: uncachedTokens,
      percentage: (uncachedTokens / windowTokens) * 100,
      title: getMindroomAiRunContextBarTitle(
        'New input',
        uncachedTokens,
        windowTokens,
        cacheWriteSuffix
      ),
    },
    {
      key: 'reserve',
      label: 'Reserve',
      tokens: reserveTokens,
      percentage: (reserveTokens / windowTokens) * 100,
      title: getMindroomAiRunContextBarTitle('Reserve', reserveTokens, windowTokens),
    },
  ];
};
