const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const isSameCalendarDay = (leftTs: number, rightTs: number): boolean => {
  const left = new Date(leftTs);
  const right = new Date(rightTs);

  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
};

const formatRelativeDelay = (deltaMs: number): string => {
  const totalSeconds = Math.max(1, Math.round(deltaMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 1) return `in ${totalSeconds}s`;

  if (totalMinutes < 60) {
    if (totalMinutes < 10 && seconds > 0) return `in ${totalMinutes}m ${seconds}s`;
    return `in ${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `in ${hours}h`;
  return `in ${hours}h ${minutes}m`;
};

export const formatScheduledTime = (ts: number): string => {
  const now = Date.now();
  const deltaMs = ts - now;

  if (deltaMs < SIX_HOURS_MS) return formatRelativeDelay(deltaMs);

  if (isSameCalendarDay(now, ts)) {
    return `at ${new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(ts)}`;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(ts);
};

export const getThreadScheduledDisplayText = (
  scheduledTaskCount: number,
  nextScheduledTs: number | undefined,
  cronDescription?: string
): string | undefined => {
  if (nextScheduledTs !== undefined) return formatScheduledTime(nextScheduledTs);
  if (scheduledTaskCount === 1 && cronDescription) return cronDescription;
  if (scheduledTaskCount <= 0) return undefined;
  return `${scheduledTaskCount} scheduled ${scheduledTaskCount === 1 ? 'task' : 'tasks'}`;
};

export const getThreadScheduledLabel = (
  scheduledTaskCount: number,
  nextScheduledTs: number | undefined,
  cronDescription: string | undefined,
  scheduledDisplayText: string | undefined
): string | undefined => {
  if (scheduledTaskCount <= 0) return undefined;

  const hasScheduleDetail =
    nextScheduledTs !== undefined || (scheduledTaskCount === 1 && !!cronDescription);
  const taskCopy = `${scheduledTaskCount} pending scheduled ${
    scheduledTaskCount === 1 ? 'task' : 'tasks'
  }`;
  return hasScheduleDetail && scheduledDisplayText
    ? `${taskCopy}, ${scheduledDisplayText}`
    : taskCopy;
};

export const getScheduledTimeUpdateInterval = (ts: number, now = Date.now()): number => {
  const deltaMs = ts - now;

  if (deltaMs <= 0) return -1;
  if (deltaMs < TEN_MINUTES_MS) return 1000;
  if (deltaMs < SIX_HOURS_MS) return 60 * 1000;
  if (deltaMs < ONE_HOUR_MS * 24) return FIFTEEN_MINUTES_MS;
  return ONE_HOUR_MS;
};
