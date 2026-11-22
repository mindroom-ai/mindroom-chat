import { type InteractiveSwipeBegin, SWIPE_PRIORITY } from './interactiveSwipe';
import { useEdgeSwipe } from './useEdgeSwipe';

export const useEdgeSwipeForward = (
  onForward: () => void,
  enabled: boolean = true,
  options: {
    priority?: number;
    begin?: InteractiveSwipeBegin;
  } = {}
): void => {
  useEdgeSwipe({
    direction: 'forward',
    enabled,
    onSwipe: onForward,
    priority: options.priority ?? SWIPE_PRIORITY.PAGE,
    begin: options.begin,
  });
};
