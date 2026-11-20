import { useTranslation } from 'react-i18next';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import type { SubagentUsage } from '../matrix/protocol/subagentFrame';
import { formatCostUsd } from '../messages/agent-run/aiRunDisplay';

/** A token count as the jobs bar and the Sub-agents panel show it: compact ("1.4M"). */
export const formatTokens = (tokens: number, language: string): string =>
  new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens);

export type UsageCell = { text: string; title: string } | undefined;

/**
 * The run's calls, tokens and cost as bare numbers, each with its words as its title. A count of
 * none shows nothing, and no cost shows before any token.
 */
export const useUsageCells = (
  usage: SubagentUsage | undefined
): [UsageCell, UsageCell, UsageCell] => {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  if (!usage) return [undefined, undefined, undefined];
  const tokens = usage.inputTokens + usage.outputTokens;
  const compact = formatTokens(tokens, language);
  const cost = usage.costUsd !== undefined ? formatCostUsd(usage.costUsd, language) : undefined;
  return [
    usage.toolCalls > 0
      ? {
          text: String(usage.toolCalls),
          title: t('mindroomUi.backgroundJobs.toolCalls', { count: usage.toolCalls }),
        }
      : undefined,
    tokens > 0
      ? {
          text: compact,
          title: t('mindroomUi.backgroundJobs.tokens', { count: tokens, tokens: compact }),
        }
      : undefined,
    tokens > 0 && cost ? { text: cost, title: cost } : undefined,
  ];
};
