import { createContext } from 'react';

/**
 * Whether `Room` already owns the covering side panel's start-edge close swipe on phones.
 * Panels with inner navigation (`SubagentsPanel`) disable their panel-closing swipe when true
 * so there is no duplicate registration, while still registering higher-priority inner swipes.
 */
export const RoomPanelEdgeSwipeContext = createContext(false);
