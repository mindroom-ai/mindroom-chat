import type { NavigateOptions, Path } from 'react-router-dom';
import { getActiveSession } from '../matrix/session/sessions';
import { isNativeIOS } from '../native/nativeSso';
import {
  setRoomThreadExitTargetForHistoryState,
  withRoomThreadExitTargetState,
} from '../routes/roomNavigateState';
import { joinPathComponent } from '../routes/pathUtils';
import { withReturnToRoom } from '../routes/historyStack';

export type NavigateRoomThreadDirect = (
  roomId: string,
  threadId: string,
  eventId?: string,
  opts?: NavigateOptions
) => void;

export type RoomThreadNavigationOptions = {
  roomId: string;
  threadId: string;
  eventId?: string;
  opts?: NavigateOptions;
  navigateRoomThreadDirect: NavigateRoomThreadDirect;
  location?: Path;
  getHistoryState?: () => unknown;
  replaceHistoryState?: (state: unknown) => void;
  schedule?: (callback: () => void) => void;
  isNativeIOSDevice?: () => boolean;
  /** The active account, which the exit target records as the one that opened the thread. */
  getSessionId?: () => string | undefined;
};

const afterNextPaint = (callback: () => void) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
    return;
  }
  queueMicrotask(callback);
};

export const navigateToRoomThread = ({
  roomId,
  threadId,
  eventId,
  opts,
  navigateRoomThreadDirect,
  location,
  getHistoryState = () => window.history.state,
  replaceHistoryState = (state) => window.history.replaceState(state, ''),
  schedule = afterNextPaint,
  isNativeIOSDevice = isNativeIOS,
  getSessionId = () => getActiveSession()?.sessionId,
}: RoomThreadNavigationOptions): void => {
  const seededExitTarget = !opts?.replace;
  const exitTarget = seededExitTarget
    ? {
        exitPath: location && joinPathComponent(location),
        roomId,
        threadId,
        useHistoryBack: !isNativeIOSDevice(),
        sessionId: getSessionId(),
      }
    : undefined;
  const nextOpts = exitTarget
    ? {
        ...opts,
        state: withRoomThreadExitTargetState(opts?.state, exitTarget),
      }
    : opts;

  // The page that is left stays the room on a step back to it (the browser's Back): its address
  // may name an event of this thread, which would open the thread again. A page that asks for
  // an event in the room (`focusEvent`) leads into no thread, and keeps its own return.
  if (exitTarget && new URLSearchParams(location?.search).get('focusEvent') !== '1') {
    replaceHistoryState(withReturnToRoom(getHistoryState()));
  }
  navigateRoomThreadDirect(roomId, threadId, eventId, nextOpts);

  if (!exitTarget) return;
  schedule(() => {
    setRoomThreadExitTargetForHistoryState(getHistoryState(), exitTarget);
  });
};
