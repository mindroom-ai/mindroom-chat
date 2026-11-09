import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { needsYou, type ActivityRowsResult } from './activityRows';
import { activityRowsAtom } from './activityState';

/** Activity's rows, as `ActivityRowsFeature` keeps them. */
export const useActivityRows = (): ActivityRowsResult => useAtomValue(activityRowsAtom);

/** The bell's badge: how many rows are unread, and whether one waits for an answer. */
export const useActivityBadge = (): { count: number; needsYou: boolean } => {
  const { rows } = useActivityRows();
  return useMemo(
    () => ({
      count: rows.filter((row) => row.unread).length,
      needsYou: rows.some(needsYou),
    }),
    [rows]
  );
};

/** How many threads wait for the user's answer (an approval, a question), for the Threads button. */
export const useThreadsNeedsYouCount = (): number => {
  const { rows } = useActivityRows();
  return useMemo(() => rows.filter((row) => row.type === 'thread' && needsYou(row)).length, [rows]);
};
