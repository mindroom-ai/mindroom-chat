import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import type { SubagentUsage } from '../matrix/protocol/subagentFrame';
import { formatCostUsd } from '../messages/agent-run/aiRunDisplay';

/** A token count as the jobs bar and the Sub-agents panel show it: compact ("1.4M"). */
export const formatTokens = (tokens: number, language: string): string =>
  new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens);

/** What runs used, summed; none of it while no run sent what it used. */
export type RunTotals = {
  calls?: number;
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

/**
 * What the runs used together. A sub-agent counts all its turns, in its card and in its open
 * run's strip alike, as their "N turns" says; the panel's header counts every run it lists. The
 * cost is left out unless every run that used tokens sent its cost, so a sum never undercounts.
 */
export const runTotals = (usages: readonly (SubagentUsage | undefined)[]): RunTotals => {
  const sent = usages.filter((usage): usage is SubagentUsage => !!usage);
  if (sent.length === 0) return {};
  const sum = (count: (usage: SubagentUsage) => number) =>
    sent.reduce((total, usage) => total + count(usage), 0);
  const inputTokens = sum((usage) => usage.inputTokens);
  const outputTokens = sum((usage) => usage.outputTokens);
  const priced = sent.every(
    (usage) => usage.costUsd !== undefined || usage.inputTokens + usage.outputTokens === 0
  );
  return {
    calls: sum((usage) => usage.toolCalls),
    tokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    ...(priced ? { costUsd: sum((usage) => usage.costUsd ?? 0) } : {}),
  };
};

/** A count as a bare number (`compact`) and in words (`labelled`). */
export type UsageText = { compact: string; labelled: string };

export type UsageTexts = { calls?: UsageText; tokens?: UsageText; cost?: UsageText };

/** The calls, tokens and cost to show. A count of none shows nothing, and no cost shows before any token. */
export const usageTexts = (totals: RunTotals, t: TFunction, language: string): UsageTexts => {
  const { calls, tokens, costUsd } = totals;
  const texts: UsageTexts = {};
  if (calls)
    texts.calls = {
      compact: String(calls),
      labelled: t('mindroomUi.subagents.calls', { count: calls }),
    };
  if (tokens) {
    const compact = formatTokens(tokens, language);
    texts.tokens = {
      compact,
      labelled: t('mindroomUi.backgroundJobs.tokens', { count: tokens, tokens: compact }),
    };
    if (costUsd !== undefined) {
      const cost = formatCostUsd(costUsd, language);
      texts.cost = { compact: cost, labelled: cost };
    }
  }
  return texts;
};

export type UsageCell = { text: string; title: string } | undefined;

/** The jobs bar's cells for a run: its calls, tokens and cost as bare numbers, their words as titles. */
export const useUsageCells = (
  usage: SubagentUsage | undefined
): [UsageCell, UsageCell, UsageCell] => {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const texts = usageTexts(runTotals([usage]), t, language);
  const cell = (text?: UsageText): UsageCell =>
    text && { text: text.compact, title: text.labelled };
  return [cell(texts.calls), cell(texts.tokens), cell(texts.cost)];
};
