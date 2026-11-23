import { type RefObject } from 'react';
import {
  type InteractiveSwipeBegin,
  SWIPE_PRIORITY,
  useInteractiveSwipe,
} from './interactiveSwipe';

/**
 * Whether the account quick switcher is open (`QuickAccountMenu`): the finger that held the avatar
 * in the panel is dragging to an account, not swiping the panel away.
 */
const quickSwitching = (): boolean => document.querySelector('[data-quick-account-menu]') !== null;

/**
 * Puts a panel that slid in from an edge (the line's `start` or `end`, so mirrored right to left)
 * away when a finger swipes it back toward that edge, at least 56 px and more sideways than up or
 * down (or continuously following the finger when an interactive `begin` scene is provided). It
 * listens on the panel's own element in the capture phase: rows inside that take touches for their
 * own gestures do not hide the swipe, and content portaled into the panel counts too.
 * A drag of the account quick switcher is no swipe.
 */
export const useSwipeAway = (
  ref: RefObject<HTMLElement>,
  edge: 'start' | 'end',
  onSwipe: () => void,
  options: {
    enabled?: boolean;
    priority?: number;
    begin?: InteractiveSwipeBegin;
  } = {}
): void => {
  useInteractiveSwipe({
    zone: 'element',
    edge,
    direction: 'toward-edge',
    priority: options.priority ?? SWIPE_PRIORITY.SHEET,
    enabled: options.enabled ?? true,
    elementRef: ref,
    cancelCommits: true,
    isBlocked: quickSwitching,
    onCommit: onSwipe,
    begin: options.begin,
  });
};
