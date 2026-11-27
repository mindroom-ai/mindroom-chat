import { createContext, useContext } from 'react';

/** True while an enclosing conversation pane is collapsed or hidden behind a covering panel. */
export const PaneCollapsedContext = createContext(false);

export const usePaneCollapsed = (): boolean => useContext(PaneCollapsedContext);
