import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import type { ActivityRowsResult } from './activityRows';
import {
  activityNeedsYouAtom,
  activityRowsAtom,
  activityUnreadCountAtom,
  threadsNeedsYouCountAtom,
} from './activityState';

/** Activity's rows, as `ActivityRowsFeature` keeps them. */
export const useActivityRows = (): ActivityRowsResult => useAtomValue(activityRowsAtom);

/** The bell's badge: how many rows are unread, and whether one waits for an answer. */
export const useActivityBadge = (): { count: number; needsYou: boolean } => {
  const count = useAtomValue(activityUnreadCountAtom);
  const waiting = useAtomValue(activityNeedsYouAtom);
  return useMemo(() => ({ count, needsYou: waiting }), [count, waiting]);
};

/** How many threads wait for the user's answer (an approval, a question), for the Threads button. */
export const useThreadsNeedsYouCount = (): number => useAtomValue(threadsNeedsYouCountAtom);
