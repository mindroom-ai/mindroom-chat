import { useAtomValue } from 'jotai';
import { type RefObject } from 'react';
import { imageViewerOpenAtom } from './imageViewerState';
import {
  type InteractiveSwipeBegin,
  SWIPE_PRIORITY,
  useInteractiveSwipe,
} from './interactiveSwipe';
import { EDGE_START_MAX_X } from './interactiveSwipeMath';
import { phoneLayerOpenAtom } from './phoneNavDrawer';

export { EDGE_START_MAX_X };

export type EdgeSwipeDirection = 'back' | 'forward';

export const useEdgeSwipe = ({
  blockStandaloneWebApp = false,
  direction,
  enabled = true,
  onSwipe,
  within,
  priority,
  begin,
}: {
  blockStandaloneWebApp?: boolean;
  direction: EdgeSwipeDirection;
  enabled?: boolean;
  onSwipe: () => void;
  /**
   * The overlay the swipe belongs to (the image viewer): it works while that overlay is open, for
   * a touch that starts inside it. Without one the swipe belongs to the page. Either way a menu or
   * dialog open over its layer, or opening before the finger lifts, takes the touch.
   */
  within?: RefObject<Element | null>;
  priority?: number;
  begin?: InteractiveSwipeBegin;
}): void => {
  const imageViewerOpen = useAtomValue(imageViewerOpenAtom);
  const phoneLayerOpen = useAtomValue(phoneLayerOpenAtom);
  const pageCovered = !within && (imageViewerOpen || phoneLayerOpen);

  useInteractiveSwipe({
    zone: 'edge',
    edge: direction === 'back' ? 'start' : 'end',
    direction: 'inward',
    priority: priority ?? (within ? SWIPE_PRIORITY.OVERLAY : SWIPE_PRIORITY.PAGE),
    enabled: enabled && !pageCovered,
    within,
    blockStandaloneWebApp,
    onCommit: onSwipe,
    begin,
  });
};
