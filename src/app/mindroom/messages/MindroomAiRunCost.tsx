import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'folds';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { useThreadConversationCost } from '../threads/useThreadConversationCost';
import { MindroomAiRunInfo } from './aiRun';
import { formatMindroomConversationCost, formatMindroomCostUsd } from './aiRunDisplay';
import * as css from './MindroomAiRunCost.css';

export type MindroomReplyCostLabels = {
  cost: string;
  /** The conversation's cost through this reply, inside an open thread. */
  conversation?: string;
  title: string;
};

export function useMindroomReplyCostLabels(
  info: MindroomAiRunInfo,
  eventId: string | undefined
): MindroomReplyCostLabels | undefined {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const threadCost = useThreadConversationCost();
  if (info.costUsd === undefined) return undefined;
  const cost = formatMindroomCostUsd(info.costUsd, language);
  const throughReply = eventId ? threadCost?.byEventId.get(eventId) : undefined;
  const conversation =
    threadCost && throughReply
      ? formatMindroomConversationCost(throughReply, threadCost.complete, t, language)
      : undefined;
  return {
    cost,
    conversation,
    title: conversation
      ? t('mindroomUi.messages.mindroomMessageControls.replyCostWithConversation', {
          cost,
          conversation,
        })
      : t('mindroomUi.messages.mindroomMessageControls.replyCost', { cost }),
  };
}

/** A reply's cost in its header, sized like the timestamp beside it; it opens the run details. */
export function MindroomAiRunCostButton({
  labels,
  open,
  onOpen,
}: {
  labels: MindroomReplyCostLabels;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={css.CostButton}
      title={labels.title}
      aria-label={labels.title}
      aria-haspopup="dialog"
      aria-pressed={open}
      onClick={onOpen}
    >
      <Text as="span" size="T200" priority="300">
        {labels.cost}
      </Text>
    </button>
  );
}
