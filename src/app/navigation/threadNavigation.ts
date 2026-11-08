import type { NavigateOptions } from 'react-router-dom';
import { isNativeIOS } from '../native/nativeSso';
import {
  setRoomThreadExitTargetForHistoryState,
  withRoomThreadExitTargetState,
} from '../routes/roomNavigateState';

type LocationPathParts = Pick<Location, 'pathname' | 'search' | 'hash'>;

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
  getLocation: () => LocationPathParts;
  getHistoryState?: () => unknown;
  schedule?: (callback: () => void) => void;
  isNativeIOSDevice?: () => boolean;
};

export const getCurrentRoutePath = (location: LocationPathParts): string =>
  `${location.pathname}${location.search}${location.hash}`;

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
  getLocation,
  getHistoryState = () => window.history.state,
  schedule = afterNextPaint,
  isNativeIOSDevice = isNativeIOS,
}: RoomThreadNavigationOptions): void => {
  const seededExitTarget = !opts?.replace;
  const exitTarget = seededExitTarget
    ? {
        exitPath: getCurrentRoutePath(getLocation()),
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
