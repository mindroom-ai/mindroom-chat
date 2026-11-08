import type { NavigateOptions, Path } from 'react-router-dom';
import { isNativeIOS } from '../native/nativeSso';
import {
  setRoomThreadExitTargetForHistoryState,
  withRoomThreadExitTargetState,
} from '../routes/roomNavigateState';
import { joinPathComponent } from '../routes/pathUtils';

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
  location: Path;
  getHistoryState?: () => unknown;
  schedule?: (callback: () => void) => void;
  isNativeIOSDevice?: () => boolean;
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
  schedule = afterNextPaint,
  isNativeIOSDevice = isNativeIOS,
}: RoomThreadNavigationOptions): void => {
  const seededExitTarget = !opts?.replace;
  const exitTarget = seededExitTarget
    ? {
        exitPath: joinPathComponent(location),
        roomId,
        threadId,
        useHistoryBack: !isNativeIOSDevice(),
      }
    : undefined;
  const nextOpts = exitTarget
    ? {
        ...opts,
        state: withRoomThreadExitTargetState(opts?.state, exitTarget),
      }
    : opts;

  navigateRoomThreadDirect(roomId, threadId, eventId, nextOpts);

  if (!exitTarget) return;
  schedule(() => {
    setRoomThreadExitTargetForHistoryState(getHistoryState(), exitTarget);
  });
};
