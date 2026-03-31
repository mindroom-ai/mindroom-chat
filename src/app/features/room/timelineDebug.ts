const TIMELINE_DEBUG_STORAGE_KEY = 'mindroom.debug.timeline';

let traceCounter = 0;

const getTimelineDebugStorage = (): Storage | undefined => {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
};

const sanitizeTracePart = (value: string): string =>
  value.replace(/[^A-Za-z0-9:_-]+/g, '_').replace(/^_+|_+$/g, '').slice(-48) || 'unknown';

export const isTimelineDebugEnabled = (): boolean => {
  try {
    return getTimelineDebugStorage()?.getItem(TIMELINE_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

export const createTimelineDebugTrace = (
  scope: 'room-open' | 'thread-open',
  roomId: string,
  threadId?: string
): string => {
  traceCounter += 1;
  const traceParts = [scope, String(traceCounter), sanitizeTracePart(roomId)];
  if (threadId) {
    traceParts.push(sanitizeTracePart(threadId));
  }
  return traceParts.join('#');
};

export const logTimelineDebug = (
  traceId: string | undefined,
  phase: string,
  payload?: Record<string, unknown>
): void => {
  if (!traceId || !isTimelineDebugEnabled()) return;

  if (payload) {
    console.log(`[timeline-debug] ${traceId} ${phase}`, payload);
    return;
  }

  console.log(`[timeline-debug] ${traceId} ${phase}`);
};
