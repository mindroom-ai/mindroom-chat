import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { fromJoinedAgents } from '../matrix/agentIdentity';

/** The room's open `!yolo` windows, as state the MindRoom router keys by its own user ID. */
export const MINDROOM_YOLO_EVENT = 'io.mindroom.yolo';

/** One person's window in which their tool calls in a thread run without approval cards. */
export type YoloWindow = {
  threadId: string | null;
  requesterId: string;
  expiresAt: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseWindow = (value: unknown): YoloWindow | undefined => {
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

/** Read one router's windows; a router may only describe them under its own user ID. */
export const parseYoloStateEvent = (event: MatrixEvent): YoloWindow[] => {
  const sender = event.getSender();
  const windows = event.getContent().windows;
  if (!sender || event.getStateKey() !== sender || !Array.isArray(windows)) return [];
  return windows.flatMap((value) => parseWindow(value) ?? []);
};

/** Every window of the room, from MindRoom accounts still in it. */
export const selectYoloWindows = (
  events: MatrixEvent[],
  viewerUserId: string | undefined,
  isJoined: (userId: string) => boolean
): YoloWindow[] => fromJoinedAgents(events, viewerUserId, isJoined).flatMap(parseYoloStateEvent);

/** The windows still open in one thread, the earliest-ending first. */
export const openYoloWindowsInThread = (
  windows: YoloWindow[],
  threadId: string,
  now: number
): YoloWindow[] =>
  windows
    .filter((window) => window.threadId === threadId && window.expiresAt > now)
    .sort((a, b) => a.expiresAt - b.expiresAt);
