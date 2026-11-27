import type { NavigateOptions, Path } from 'react-router-dom';
import { getActiveSession } from '../matrix/session/sessions';
import { isNativeIOS } from '../native/nativeSso';
import {
  setRoomThreadExitTargetForHistoryState,
  withRoomThreadExitTargetState,
} from '../routes/roomNavigateState';
import { joinPathComponent } from '../routes/pathUtils';
import { returnToRoomState } from '../routes/historyStack';

export type NavigateRoomThreadDirect = (
  roomId: string,
  threadId: string,
  eventId?: string,
  opts?: NavigateOptions
) => void;

export type NavigateRoomThreadOptions = NavigateOptions & {
  returnToOrigin?: boolean;
};

export type RoomThreadNavigationOptions = {
  roomId: string;
  threadId: string;
  eventId?: string;
  opts?: NavigateRoomThreadOptions;
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
  const { returnToOrigin, ...navigateOpts } = opts ?? {};
  const routerOpts: NavigateOptions | undefined = opts ? navigateOpts : undefined;
  const seededExitTarget = !routerOpts?.replace;
  const exitTarget = seededExitTarget
    ? {
        exitPath: location && joinPathComponent(location),
        roomId,
        threadId,
        useHistoryBack: !isNativeIOSDevice(),
        sessionId: getSessionId(),
        ...(returnToOrigin ? { returnToOrigin: true } : {}),
      }
    : undefined;
  const nextOpts = exitTarget
    ? {
        ...routerOpts,
        state: withRoomThreadExitTargetState(routerOpts?.state, exitTarget),
      }
    : routerOpts;

  // A step back (the browser's Back) to the room at an event, when that is the page left here,
  // stays the room: the event may be in this thread, and would open it again.
  const marked = exitTarget && location && returnToRoomState(location, roomId, getHistoryState());
  try {
    if (marked) replaceHistoryState(marked);
  } catch {
    // A browser may refuse the write (WebKit limits them): the thread opens all the same.
  }
  navigateRoomThreadDirect(roomId, threadId, eventId, nextOpts);

  if (!exitTarget) return;
  schedule(() => {
    setRoomThreadExitTargetForHistoryState(getHistoryState(), exitTarget);
  });
};
