import { useEffect } from 'react';
import { useLocation, useNavigationType, type NavigationType } from 'react-router-dom';
import { decodeRouteParam } from './pathUtils';

/** A page of this tab's history: its path and its query. */
export type HistoryPage = { pathname: string; search: string };

type HistoryEntry = HistoryPage & { key: string };

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
  const { key, pathname, search } = useLocation();
  const action = useNavigationType();
  useEffect(() => {
    current = advanceHistoryStack(current, { key, pathname, search }, action);
  }, [key, pathname, search, action]);
};

/** The pathname of the history entry before the current one, when the app has shown it. */
export const previousHistoryPathname = (): string | undefined =>
  current.entries[current.index - 1]?.pathname;

/** Where a page that is left by stepping back in history leads, and how many steps back that is. */
export type HistoryOrigin = { steps: number; path: string };

/**
 * The newest entry of `stack` before the current one that `isElsewhere` accepts: the page a room or
 * thread was opened from, passing over the entries of the room or thread itself. Undefined when
 * the app has not shown one, such as after a reload or for a page opened from outside.
 */
export const findHistoryOrigin = (
  stack: HistoryStack,
  isElsewhere: (page: HistoryPage) => boolean
): HistoryOrigin | undefined => {
  for (let index = stack.index - 1; index >= 0; index -= 1) {
    const entry = stack.entries[index];
    if (entry && isElsewhere(entry)) {
      return { steps: stack.index - index, path: `${entry.pathname}${entry.search}` };
    }
  }
  return undefined;
};

/** `findHistoryOrigin` in this tab's history. */
export const previousHistoryOrigin = (
  isElsewhere: (page: HistoryPage) => boolean
): HistoryOrigin | undefined => findHistoryOrigin(current, isElsewhere);

/**
 * Whether a page shows the room: its route names it by one of `addresses` (its ID or an alias), as a
 * room's own page, an event in it, its threads and a space's own pages do. `threadIds` narrows it
 * to those threads. The app's routes name a space in their first segment and a room in their second
 * (`/home/<room>`, `/<space>/<room>`); a later segment belongs to another page, such as a plugin's
 * page about the room (`/p/<plugin>/rooms/<room>`).
 */
export const showsRoom = (page: HistoryPage, addresses: string[], threadIds?: string[]): boolean =>
  page.pathname
    .split('/')
    .slice(1, 3)
    .some((segment) => addresses.includes(decodeRouteParam(segment))) &&
  (!threadIds || threadIds.includes(new URLSearchParams(page.search).get('threadId') ?? ''));
