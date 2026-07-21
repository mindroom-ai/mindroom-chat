import type { ThreadHeaderViewModel, ThreadRecord } from './types';
import { getThreadScheduledLabel } from './compactThreadCardUtils';

type BuildThreadHeaderViewModelOptions = {
  record: ThreadRecord;
  scheduledDisplayText?: string;
  canEdit: boolean;
  availableTags: string[];
  pickerDisabled: boolean;
};

const getBannerScheduledText = (
  summaryText: string | undefined,
  nextScheduledTs: number | undefined,
  scheduledDisplayText: string | undefined
): string | undefined => {
  if (!scheduledDisplayText) return undefined;
  if (summaryText || nextScheduledTs === undefined) return scheduledDisplayText;
  return `Next task ${scheduledDisplayText}`;
};

export const buildThreadHeaderViewModelFromRecord = ({
  record,
  scheduledDisplayText,
  canEdit,
  availableTags,
  pickerDisabled,
}: BuildThreadHeaderViewModelOptions): ThreadHeaderViewModel => {
  const { scheduledTaskCount, nextScheduledTs, cronDescription } = record.status;
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
    scheduledLabel: getThreadScheduledLabel(
      scheduledTaskCount,
      nextScheduledTs,
      cronDescription,
      scheduledDisplayText
    ),
    bannerScheduledText: getBannerScheduledText(
      summaryText,
      nextScheduledTs,
      scheduledDisplayText
    ),
  };
};
