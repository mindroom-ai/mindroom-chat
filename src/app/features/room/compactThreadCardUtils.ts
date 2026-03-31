const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

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
