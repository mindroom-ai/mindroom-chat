import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';

/** The room's open `!auto_approve` windows, as state the room steward keys by its own user ID. */
export const MINDROOM_AUTO_APPROVE_EVENT = 'io.mindroom.auto_approve';

/** One person's window in which their tool calls in a thread run without approval cards. */
export type AutoApproveWindow = {
  threadId: string | null;
  requesterId: string;
  expiresAt: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseWindow = (value: unknown): AutoApproveWindow | undefined => {
  if (!isRecord(value)) return undefined;
  const { thread_id: threadId, requester_id: requesterId, expires_at: expiresAt } = value;
  if (
    !(typeof threadId === 'string' || threadId === null) ||
    typeof requesterId !== 'string' ||
    typeof expiresAt !== 'string'
  ) {
    return undefined;
  }
  const timestamp = Date.parse(expiresAt);
  return Number.isNaN(timestamp) ? undefined : { threadId, requesterId, expiresAt: timestamp };
};

/** Read one agent's windows from state `agentRoomState` already checked the agent published about itself. */
export const parseAutoApproveStateEvent = (event: MatrixEvent): AutoApproveWindow[] => {
  const windows = event.getContent().windows;
  if (!Array.isArray(windows)) return [];
  return windows.flatMap((value) => parseWindow(value) ?? []);
};

const isNewerAutoApproveEvent = (candidate: MatrixEvent, current: MatrixEvent): boolean => {
  const candidateTs = candidate.getTs();
  const currentTs = current.getTs();
  if (candidateTs !== currentTs) return candidateTs > currentTs;
  const candidateSender = candidate.getSender();
  const currentSender = current.getSender();
  if (!candidateSender) return false;
  if (!currentSender) return true;
  return candidateSender < currentSender;
};

/**
 * The windows from the newest agent auto-approve state event (`origin_server_ts`, ties to the
 * lowest sender Matrix ID), since each write carries the room's full open set.
 */
export const selectAutoApproveWindows = (events: MatrixEvent[]): AutoApproveWindow[] => {
  let newest: MatrixEvent | undefined;
  for (const event of events) {
    if (!newest || isNewerAutoApproveEvent(event, newest)) newest = event;
  }
  return newest ? parseAutoApproveStateEvent(newest) : [];
};

/** The windows still open in one thread, the earliest-ending first. */
export const openAutoApproveWindowsInThread = (
  windows: AutoApproveWindow[],
  threadId: string,
  now: number
): AutoApproveWindow[] =>
  windows
    .filter((window) => window.threadId === threadId && window.expiresAt > now)
    .sort((a, b) => a.expiresAt - b.expiresAt);
