import { createContext, useContext } from 'react';

/** True while an enclosing conversation pane is collapsed or folded out of sight. */
export const PaneCollapsedContext = createContext(false);

export const usePaneCollapsed = (): boolean => useContext(PaneCollapsedContext);
