import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Manual expansion is user preference, unlike the timeline's module-level overflow
// verdict cache (which is only a measurement warm-start hint). Keep it in a
// room/thread timeline-owned Map so virtualization remounts can reuse it without
// leaking UI state across navigation. Long messages (CollapsibleMessage),
// finished agent work (FinishedWorkFold), and inner reply disclosures keep their
// choices here under distinct keys.
export const ManualExpansionStateContext = createContext<Map<string, boolean> | undefined>(
  undefined
);

// The owning timeline's expand/collapse-all baseline, scoped to that timeline instance. Newly
// mounted rows read it render-purely as their initial expanded state (virtualized timelines mount
// rows lazily), and mounted rows follow its changes in an effect, one commit after the timeline
// captures its reader anchor. `undefined` means "no override, use the per-message default".
// Long messages and finished agent work both follow it.
export const ExpandAllInitContext = createContext<boolean | undefined>(undefined);

export const MANUAL_EXPANSION_STATE_LIMIT = 4000;

export const DISCLOSURE_KEY_PREFIX = 'disclosure:';

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

/** Clear outer message and work-fold overrides while keeping inner `disclosure:` choices. */
export const clearBulkExpansionOverrides = (state: Map<string, boolean>): void => {
  for (const key of [...state.keys()]) {
    if (!key.startsWith(DISCLOSURE_KEY_PREFIX)) {
      state.delete(key);
    }
  }
};

const readPersistedDisclosure = (
  state: ReadonlyMap<string, boolean> | undefined,
  keys: string | readonly string[] | undefined,
  defaultOpen: boolean
): boolean => {
  if (!state || keys === undefined) return defaultOpen;
  if (typeof keys === 'string') return state.get(keys) ?? defaultOpen;
  if (keys.length === 0) return defaultOpen;
  return keys.some((key) => state.get(key) === true) || defaultOpen;
};

/**
 * Disclosure open state persisted in the owning timeline's `ManualExpansionStateContext`.
 * Reads initial state render-purely; persists `true` entries on open and deletes them on close
 * so the bounded LRU map only tracks open disclosures.
 */
export const usePersistedDisclosure = (
  keys: string | readonly string[] | undefined,
  defaultOpen = false
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] => {
  const state = useContext(ManualExpansionStateContext);
  const [open, setOpenState] = useState<boolean>(() =>
    readPersistedDisclosure(state, keys, defaultOpen)
  );
  const openRef = useRef(open);
  openRef.current = open;
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const keySignature = keys === undefined ? '' : typeof keys === 'string' ? keys : keys.join('\0');

  // If a multi-key disclosure (e.g. a growing tool run) gains keys while open, persist the new
  // keys so a subsequent split keeps every member open.
  useEffect(() => {
    if (!open || !state || keysRef.current === undefined) return;
    const keyList = typeof keysRef.current === 'string' ? [keysRef.current] : keysRef.current;
    for (const key of keyList) {
      if (state.get(key) !== true) rememberManualExpansionState(state, key, true);
    }
  }, [keySignature, open, state]);

  const setOpen = useCallback(
    (update: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof update === 'function' ? update(openRef.current) : update;
      openRef.current = next;
      const currentKeys = keysRef.current;
      if (state && currentKeys !== undefined) {
        const keyList = typeof currentKeys === 'string' ? [currentKeys] : currentKeys;
        for (const key of keyList) {
          if (next) rememberManualExpansionState(state, key, true);
          else state.delete(key);
        }
      }
      setOpenState(next);
    },
    [state]
  );

  return [open, setOpen];
};
