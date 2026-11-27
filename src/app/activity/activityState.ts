import { atom } from 'jotai';
import { needsYou, unreadCount, type ActivityRowsResult } from './activityRows';

/** Whether Activity lists only unread rows; shared by the popover, the page and the sheet. */
export const activityUnreadOnlyAtom = atom(false);

/** Whether Activity lists the threads agents run alone (automations) as rows. */
export const activityShowAutomationsAtom = atom(false);

/** Activity's rows, which `ActivityRowsFeature` keeps current. */
export const activityRowsAtom = atom<ActivityRowsResult>({
  rows: [],
  hiddenAutomations: 0,
  loading: true,
});

/** Primitive badge count derived from activityRowsAtom so chrome skips unrelated row rebuilds. */
export const activityUnreadCountAtom = atom((get) => unreadCount(get(activityRowsAtom).rows));

/** Whether any activity row waits on the user (approval, question, invite). */
export const activityNeedsYouAtom = atom((get) => get(activityRowsAtom).rows.some(needsYou));

/** Count of thread rows waiting on the user, for the Threads nav badge. */
export const threadsNeedsYouCountAtom = atom(
  (get) => get(activityRowsAtom).rows.filter((row) => row.type === 'thread' && needsYou(row)).length
);
