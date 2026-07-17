import type { NavigateOptions } from 'react-router-dom';
import { isNativeIOS } from '../native/nativeSso';
import {
  getRoomThreadExitTargetFromState,
  moveRoomThreadExitTargetBetweenHistoryStates,
  setRoomThreadExitTargetForHistoryState,
  withRoomThreadExitTargetState,
} from './roomNavigateState';

type LocationPathParts = Pick<Location, 'pathname' | 'search' | 'hash'>;

export type NavigateRoomThreadDirect = (
  roomId: string,
  threadId: string,
  eventId?: string,
  opts?: NavigateOptions
) => void;

export type MindroomRoomThreadNavigationOptions = {
  roomId: string;
  threadId: string;
  eventId?: string;
  opts?: NavigateOptions;
  navigateRoomThreadDirect: NavigateRoomThreadDirect;
  getLocation?: () => LocationPathParts;
  getHistoryState?: () => unknown;
  schedule?: (callback: () => void) => void;
  isNativeIOSDevice?: () => boolean;
};

export const getMindroomCurrentRoutePath = (location: LocationPathParts): string =>
  `${location.pathname}${location.search}${location.hash}`;

const afterNextPaint = (callback: () => void) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
    return;
  }
  queueMicrotask(callback);
};

export const navigateMindroomRoomThread = ({
  roomId,
  threadId,
  eventId,
  opts,
  navigateRoomThreadDirect,
  getLocation = () => window.location,
  getHistoryState = () => window.history.state,
  schedule = afterNextPaint,
  isNativeIOSDevice = isNativeIOS,
}: MindroomRoomThreadNavigationOptions): void => {
  const seededExitTarget = !opts?.replace;
  const carriedExitTarget = opts?.replace
    ? getRoomThreadExitTargetFromState(opts.state)
    : undefined;
  const exitTarget = seededExitTarget
    ? {
        exitPath: getMindroomCurrentRoutePath(getLocation()),
        roomId,
        threadId,
        useHistoryBack: !isNativeIOSDevice(),
      }
    : carriedExitTarget;
  const nextOpts =
    seededExitTarget && exitTarget
      ? {
          ...opts,
          state: withRoomThreadExitTargetState(opts?.state, exitTarget),
        }
      : opts;
  const previousHistoryState = carriedExitTarget ? getHistoryState() : undefined;

  navigateRoomThreadDirect(roomId, threadId, eventId, nextOpts);

  if (!exitTarget) return;
  schedule(() => {
    const nextHistoryState = getHistoryState();
    if (carriedExitTarget) {
      moveRoomThreadExitTargetBetweenHistoryStates(
        previousHistoryState,
        nextHistoryState,
        exitTarget
      );
      return;
    }
    setRoomThreadExitTargetForHistoryState(nextHistoryState, exitTarget);
  });
};
