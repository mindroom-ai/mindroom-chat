import { useEffect } from 'react';
import { useLocation, useNavigationType, type NavigationType } from 'react-router-dom';

type HistoryEntry = { key: string; pathname: string };

/** The entries of this tab's history the app has shown, and which one is current. */
export type HistoryStack = { entries: HistoryEntry[]; index: number };

export const emptyHistoryStack: HistoryStack = { entries: [], index: -1 };

/** The stack after the router moved to `entry` by `action`. */
export const advanceHistoryStack = (
  stack: HistoryStack,
  entry: HistoryEntry,
  action: NavigationType | `${NavigationType}`
): HistoryStack => {
  if (action === 'PUSH') {
    const entries = [...stack.entries.slice(0, stack.index + 1), entry];
    return { entries, index: entries.length - 1 };
  }
  if (action === 'REPLACE' && stack.index >= 0) {
    const entries = [...stack.entries];
    entries[stack.index] = entry;
    return { entries, index: stack.index };
  }
  // A back or forward step to an entry the app has seen; anything else (the first load, a
  // reload, a step past what this page knows) starts over from here.
  const index = stack.entries.findIndex(({ key }) => key === entry.key);
  if (action === 'POP' && index >= 0) return { entries: stack.entries, index };
  return { entries: [entry], index: 0 };
};

let current = emptyHistoryStack;

/** Keeps the stack up to date; mounted once, around every signed-in page. */
export const useHistoryStackRecorder = (): void => {
  const { key, pathname } = useLocation();
  const action = useNavigationType();
  useEffect(() => {
    current = advanceHistoryStack(current, { key, pathname }, action);
  }, [key, pathname, action]);
};

/** The pathname of the history entry before the current one, when the app has shown it. */
export const previousHistoryPathname = (): string | undefined =>
  current.entries[current.index - 1]?.pathname;
