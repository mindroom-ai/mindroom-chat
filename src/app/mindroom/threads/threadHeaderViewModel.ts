import type { ThreadHeaderViewModel, ThreadRecord } from './types';

type BuildThreadHeaderViewModelOptions = {
  record: ThreadRecord;
  scheduledDisplayText?: string;
  canEdit: boolean;
  availableTags: string[];
  pickerDisabled: boolean;
};

const getScheduledLabel = (
  scheduledTaskCount: number,
  nextScheduledTs: number | undefined,
  scheduledDisplayText: string | undefined
): string | undefined => {
  if (scheduledTaskCount <= 0) return undefined;

  if (nextScheduledTs === undefined) {
    return scheduledDisplayText;
  }

  const taskCopy = `${scheduledTaskCount} pending scheduled ${
    scheduledTaskCount === 1 ? 'task' : 'tasks'
  }`;

  return scheduledDisplayText ? `${taskCopy}, ${scheduledDisplayText}` : taskCopy;
};

const getBannerScheduledText = (
  summaryText: string | undefined,
  scheduledTaskCount: number,
  nextScheduledTs: number | undefined,
  scheduledDisplayText: string | undefined
): string | undefined => {
  if (!scheduledDisplayText) return undefined;
  if (summaryText) return scheduledDisplayText;

  if (nextScheduledTs !== undefined) {
    return `Next task ${scheduledDisplayText}`;
  }

  if (scheduledTaskCount > 0) {
    return `${scheduledTaskCount} scheduled ${scheduledTaskCount === 1 ? 'task' : 'tasks'}`;
  }

  return scheduledDisplayText;
};

export const buildThreadHeaderViewModelFromRecord = ({
  record,
  scheduledDisplayText,
  canEdit,
  availableTags,
  pickerDisabled,
}: BuildThreadHeaderViewModelOptions): ThreadHeaderViewModel => {
  const { scheduledTaskCount, nextScheduledTs } = record.status;
  const summaryText = record.presentation.summaryText;

  return {
    summaryText,
    displayTags: record.status.tags,
    isResolved: record.status.isResolved,
    canEdit,
    availableTags,
    pickerDisabled,
    scheduledTaskCount,
    nextScheduledTs,
    scheduledDisplayText,
    scheduledLabel: getScheduledLabel(scheduledTaskCount, nextScheduledTs, scheduledDisplayText),
    bannerScheduledText: getBannerScheduledText(
      summaryText,
      scheduledTaskCount,
      nextScheduledTs,
      scheduledDisplayText
    ),
  };
};
