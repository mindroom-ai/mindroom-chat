import { createContext, useContext } from 'react';

/** True when this pane is collapsed out of view (e.g. a room hidden behind a full-screen thread). */
export const PaneCollapsedContext = createContext(false);

export const usePaneCollapsed = (): boolean => useContext(PaneCollapsedContext);

/** True while this pane is mounted passively for an active swipe peek or slide animation. */
export const PassivePeekContext = createContext(false);

export const usePassivePeek = (): boolean => useContext(PassivePeekContext);

/** True when heavy background work should pause (pane collapsed or passive swipe peek). */
export const usePanePaused = (): boolean => {
  const collapsed = usePaneCollapsed();
  const passive = usePassivePeek();
  return collapsed || passive;
};
