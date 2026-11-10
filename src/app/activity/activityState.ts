import { atom } from 'jotai';
import type { ActivityRowsResult } from './activityRows';

/** Whether Activity lists only unread rows; shared by the popover, the page and the sheet. */
export const activityUnreadOnlyAtom = atom(false);

/** Whether Activity lists the threads agents run alone (automations) as rows. */
export const activityShowAutomationsAtom = atom(false);

/** Activity's rows, which `ActivityRowsFeature` keeps current. */
export const activityRowsAtom = atom<ActivityRowsResult>({ rows: [], hiddenAutomations: 0 });
