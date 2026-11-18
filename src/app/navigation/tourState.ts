import { atom } from 'jotai';

/** How much of the tour plays: its first eight steps (about a minute) or all of it (about five). */
export type TourLevel = 'quick' | 'full';

/** The open interface tour (src/app/tour/) and its level; undefined while it is closed. */
export const tourAtom = atom<{ level: TourLevel } | undefined>(undefined);

/**
 * The accounts (session IDs, matrix/session/sessions.ts) that answered the offer of the tour
 * (src/app/tour/TourOffer.tsx) since the page loaded, while their stored answer is on its way or
 * after it was refused; the offer of the Mac app (src/app/shell/MacAppOffer.tsx) waits for it.
 */
export const tourOfferAnsweredAtom = atom<ReadonlySet<string>>(new Set<string>());
