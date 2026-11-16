import { createContext } from 'react';

// Manual expansion is user preference, unlike the timeline's module-level overflow
// verdict cache (which is only a measurement warm-start hint). Keep it in a
// room/thread timeline-owned Map so virtualization remounts can reuse it without
// leaking UI state across navigation. Long messages (CollapsibleMessage) and
// finished agent work (FinishedWorkFold) keep their choices here under distinct keys.
export const ManualExpansionStateContext = createContext<Map<string, boolean> | undefined>(
  undefined
);
export const MANUAL_EXPANSION_STATE_LIMIT = 4000;

export const rememberManualExpansionState = (
  state: Map<string, boolean>,
  key: string,
  expanded: boolean,
  limit = MANUAL_EXPANSION_STATE_LIMIT
) => {
  // Refresh existing keys so oldest-entry eviction retains recently-used rows.
  state.delete(key);
  state.set(key, expanded);
  while (state.size > limit) {
    const oldestKey = state.keys().next().value;
    if (oldestKey === undefined) break;
    state.delete(oldestKey);
  }
};
