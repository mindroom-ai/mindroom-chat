import { createContext, useContext } from 'react';
import type { LiveThreadBackUnder } from '../navigation/phonePageSlide';

export type SpaceUnderLayerContextValue = {
  /** Whether this Space's All threads view is currently mounted and warm for live peek. */
  hasWarmSpaceThreads: () => boolean;
  /** Reveals the parked Space All threads view behind the active thread on phones. */
  enterLiveSpaceThreadsPeek: () => LiveThreadBackUnder | null;
  /** True while SpaceSectionPage owns a forward slide into the active thread. */
  isSpaceSlideOwningThread: () => boolean;
};

export const SpaceUnderLayerContext = createContext<SpaceUnderLayerContextValue | null>(null);

export const useSpaceUnderLayer = (): SpaceUnderLayerContextValue | null =>
  useContext(SpaceUnderLayerContext);

/**
 * True while `SpaceThreadsPage` is temporarily revealed as an inert under-layer during an
 * interactive swipe-back peek (before commit), suppressing polling, thread-list rescans, and
 * focus side effects on cancelled swipes.
 */
export const SpaceThreadsPassiveContext = createContext<boolean>(false);

export const useIsSpaceThreadsPassive = (): boolean => useContext(SpaceThreadsPassiveContext);
