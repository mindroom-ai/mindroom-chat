import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { formatMindroomConversationCost, formatMindroomCostUsd } from '../messages/aiRunDisplay';
import { useThreadConversationCost } from './useThreadConversationCost';
import * as css from './ThreadCostChip.css';

/** Says in a thread's header what its priced replies have cost so far. */
export function ThreadCostChip() {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const threadCost = useThreadConversationCost();
  if (!threadCost) return null;
  const { total, complete } = threadCost;
  const cost = formatMindroomCostUsd(total.usd, language);
  const label = t('mindroomUi.threads.threadCostChip.label', {
    conversation: formatMindroomConversationCost(total, complete, t, language),
  });
  return (
    <span
      className={css.Chip}
      role="note"
      title={label}
      aria-label={label}
      data-thread-status-chip=""
    >
      {complete ? cost : t('mindroomUi.threads.threadCostChip.atLeast', { cost })}
    </span>
  );
}
