import type { TFunction } from 'i18next';
import {
  AI_RUN_TOKEN_KINDS,
  getAiRunTokenCounts,
  type AiRunErrorInfo,
  type AiRunInfo,
  type AiRunTokenCounts,
  type AiRunTokenKind,
} from '../../matrix/protocol/aiRun';
import { getAiRunCompactModelLabel } from '../../matrix/protocol/aiRunModelLabel';

export const formatAiRunNumber = (
  value: number | undefined,
  locale?: string
): string | undefined =>
  typeof value === 'number' ? Math.round(value).toLocaleString(locale) : undefined;

/** A large count in the reader's short style, such as 61.4M. */
export const formatAiRunCompactNumber = (value: number, locale?: string): string =>
  new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export const formatAiRunTimeToFirstToken = (value: number | undefined): string | undefined => {
  if (typeof value !== 'number' || value < 0) return undefined;
  return `${Math.round(value * 1000)} ms`;
};

/** A USD amount sized for per-reply costs: cents from $0.10 up, two significant digits below. */
export const formatCostUsd = (usd: number, locale?: string): string => {
  const currency = (options: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', ...options });
  if (usd === 0) return currency({ minimumFractionDigits: 2 }).format(0);
  // Rounding decides the style, so $0.0999 reads $0.10, not $0.1.
  if (Number(usd.toPrecision(2)) >= 0.1) {
    return currency({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usd);
  }
  return currency({ maximumSignificantDigits: 2 }).format(usd);
};

/** A share of a bar, such as 82.6 %, in the reader's number style. */
export const formatAiRunPercentage = (percentage: number, locale?: string): string =>
  new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(percentage / 100);

type AiRunTokenPart = {
  key: AiRunTokenKind;
  label: string;
  tokens: number;
  percentage: number;
};

type AiRunContextBarSegment = AiRunTokenPart & {
  key: 'cacheRead' | 'newInput' | 'input';
};

const TOKEN_PART_LABELS = {
  cacheRead: ['mindroomUi.messages.mindroomReplyDetails.fromCache', 'From cache'],
  cacheWrite: ['mindroomUi.messages.mindroomReplyDetails.writtenToCache', 'Written to cache'],
  notCached: ['mindroomUi.messages.mindroomReplyDetails.notCached', 'Not cached'],
  newInput: ['mindroomUi.messages.mindroomReplyDetails.newInput', 'New input'],
  input: ['mindroomUi.messages.mindroomReplyDetails.input', 'Input'],
  output: ['mindroomUi.messages.mindroomReplyDetails.output', 'Output'],
} as const;

const tokenPartLabel = (key: AiRunTokenPart['key'], t?: TFunction): string => {
  const [labelKey, fallback] = TOKEN_PART_LABELS[key];
  return t ? t(labelKey) : fallback;
};

/** Token counts as parts of their total, in the order they are shown. */
export const getAiRunTokenCountParts = (
  counts: AiRunTokenCounts,
  t?: TFunction
): { total: number; parts: AiRunTokenPart[] } | undefined => {
  const used = AI_RUN_TOKEN_KINDS.flatMap((key) => {
    const tokens = counts[key];
    return tokens ? [{ key, tokens }] : [];
  });
  const total = used.reduce((sum, { tokens }) => sum + tokens, 0);
  if (total <= 0) return undefined;
  return {
    total,
    parts: used.map(({ key, tokens }) => ({
      key,
      label: tokenPartLabel(key, t),
      tokens,
      percentage: (tokens / total) * 100,
    })),
  };
};

/** What a reply's tokens were spent on: its input, by where it came from, and its output. */
export const getAiRunTokenParts = (info: AiRunInfo, t?: TFunction) =>
  getAiRunTokenCountParts(getAiRunTokenCounts(info), t);

const isValidContextBarTokenCount = (value: number | undefined): value is number =>
  typeof value === 'number' && value >= 0;

/** How much of the model's context window the reply's last request filled. */
export const getAiRunContextLabel = (
  info: AiRunInfo,
  t?: TFunction,
  locale?: string
): string | undefined => {
  const inputTokens = info.contextInputTokens;
  const windowTokens = info.contextWindowTokens;
  if (inputTokens === undefined || windowTokens === undefined || windowTokens <= 0) {
    return undefined;
  }

  const percentage = formatAiRunPercentage((inputTokens / windowTokens) * 100, locale);
  const input = formatAiRunNumber(inputTokens, locale);
  const window = formatAiRunNumber(windowTokens, locale);
  return t
    ? t('mindroomUi.messages.mindroomReplyDetails.contextWindowUsage', {
        input,
        window,
        percentage,
      })
    : `${input} of ${window} · ${percentage}`;
};

export const getAiRunContextBarSegments = (
  info: AiRunInfo,
  t?: TFunction
): AiRunContextBarSegment[] | undefined => {
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

  // Without a cache count the split is unknown, so the bar shows the input as one part.
  if (!isValidContextBarTokenCount(cacheReadTokens)) {
    return [
      {
        key: 'input',
        label: tokenPartLabel('input', t),
        tokens: inputTokens,
        percentage: (inputTokens / windowTokens) * 100,
      },
    ];
  }

  const displayedCacheReadTokens = Math.min(cacheReadTokens, inputTokens);
  const displayedUncachedTokens =
    isValidContextBarTokenCount(uncachedTokens) && cacheReadTokens + uncachedTokens === inputTokens
      ? uncachedTokens
      : inputTokens - displayedCacheReadTokens;
  return [
    {
      key: 'cacheRead',
      label: tokenPartLabel('cacheRead', t),
      tokens: displayedCacheReadTokens,
      percentage: (displayedCacheReadTokens / windowTokens) * 100,
    },
    {
      key: 'newInput',
      label: tokenPartLabel('newInput', t),
      tokens: displayedUncachedTokens,
      percentage: (displayedUncachedTokens / windowTokens) * 100,
    },
  ];
};

/** Statuses that ReplyDetails displays as a flagged status badge in its header. */
export const isFlaggedAiRunStatus = (status: string | undefined): status is 'error' | 'cancelled' =>
  status === 'error' || status === 'cancelled';

/** True iff ReplyDetails renders at least one section for `info`. */
export const hasRenderableAiRunDetails = (info: AiRunInfo): boolean => {
  const status = info.status?.toLowerCase();
  return Boolean(
    getAiRunCompactModelLabel(info) ||
    isFlaggedAiRunStatus(status) ||
    info.costUsd !== undefined ||
    info.subagentsCostUsd !== undefined ||
    getAiRunTokenParts(info) ||
    getAiRunContextLabel(info) ||
    info.toolCount !== undefined ||
    formatAiRunTimeToFirstToken(info.timeToFirstToken) ||
    info.modelConfig ||
    info.runId ||
    info.sessionId ||
    info.error
  );
};

/** Formats an `io.mindroom.ai_run.error` status code and machine code as `504 · stream_stalled`. */
export const formatRunErrorCode = (error: AiRunErrorInfo): string | undefined => {
  const parts: string[] = [];
  if (error.statusCode !== undefined) parts.push(String(error.statusCode));
  if (error.code) parts.push(error.code);
  return parts.length > 0 ? parts.join(' · ') : undefined;
};
