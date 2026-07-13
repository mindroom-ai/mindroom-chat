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

const GENERIC_MODEL_CONFIGS = new Set(['auto', 'default']);

const titleCaseWords = (value: string): string =>
  value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');

const formatModelId = (modelId: string): string => {
  const claudeMatch = modelId.match(/claude-(?:\d+(?:[-.]\d+)*-)?(opus|sonnet|haiku)(?:-(.*))?/i);
  if (claudeMatch) {
    const family = titleCaseWords(claudeMatch[1]);
    const version = claudeMatch[2]?.replace(/-/g, '.').replace(/(?:^|\.)latest$/i, '');
    return version ? `${family} ${version}` : family;
  }

  if (/^gpt-/i.test(modelId)) return modelId.replace(/^gpt/i, 'GPT');
  return titleCaseWords(modelId.replace(/-/g, ' '));
};

/** A short, friendly model name intended for the always-visible message badge. */
export const getMindroomAiRunCompactModelLabel = (info: MindroomAiRunInfo): string | undefined => {
  const modelConfig = info.modelConfig?.trim();
  if (modelConfig && !GENERIC_MODEL_CONFIGS.has(modelConfig.toLowerCase())) {
    return titleCaseWords(modelConfig);
  }

  const modelId = info.modelId?.trim();
  if (modelId) return formatModelId(modelId);

  const provider = info.modelProvider?.trim();
  return provider ? titleCaseWords(provider) : undefined;
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

const getDisplayedCacheReadTokens = (cacheReadTokens: number | undefined, inputTokens: number) =>
  isValidContextBarTokenCount(cacheReadTokens) ? Math.min(cacheReadTokens, inputTokens) : 0;

const getCacheReadTitleSuffix = (reportedTokens: number | undefined, displayedTokens: number) => {
  if (!isValidContextBarTokenCount(reportedTokens) || reportedTokens <= displayedTokens) {
    return undefined;
  }
  return `reported cache read: ${formatMindroomAiRunNumber(reportedTokens)} tokens`;
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
    inputTokens > windowTokens
  ) {
    return undefined;
  }

  const displayedCacheReadTokens = getDisplayedCacheReadTokens(cacheReadTokens, inputTokens);
  const displayedUncachedTokens =
    isValidContextBarTokenCount(cacheReadTokens) &&
    isValidContextBarTokenCount(uncachedTokens) &&
    cacheReadTokens + uncachedTokens === inputTokens
      ? uncachedTokens
      : inputTokens - displayedCacheReadTokens;
  const reserveTokens = windowTokens - inputTokens;
  const cacheWriteTokens = info.contextCacheWriteInputTokens;
  const cacheWriteSuffix = isValidContextBarTokenCount(cacheWriteTokens)
    ? `cache write: ${formatMindroomAiRunNumber(cacheWriteTokens)} tokens`
    : undefined;
  const cacheReadTitleSuffix = getCacheReadTitleSuffix(cacheReadTokens, displayedCacheReadTokens);

  return [
    {
      key: 'cacheRead',
      label: 'Cache read',
      tokens: displayedCacheReadTokens,
      percentage: (displayedCacheReadTokens / windowTokens) * 100,
      title: getMindroomAiRunContextBarTitle(
        'Cache read',
        displayedCacheReadTokens,
        windowTokens,
        cacheReadTitleSuffix
      ),
    },
    {
      key: 'newInput',
      label: 'New input',
      tokens: displayedUncachedTokens,
      percentage: (displayedUncachedTokens / windowTokens) * 100,
      title: getMindroomAiRunContextBarTitle(
        'New input',
        displayedUncachedTokens,
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
