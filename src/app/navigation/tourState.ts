import { atom } from 'jotai';

/** How much of the tour plays: its first eight steps (about a minute) or all of it (about five). */
export type TourLevel = 'quick' | 'full';

/** The open interface tour (src/app/tour/) and its level; undefined while it is closed. */
export const tourAtom = atom<{ level: TourLevel } | undefined>(undefined);
