import { atom } from 'jotai';

/** How much of the tour plays: its first eight steps (about a minute) or all of it (about five). */
export type TourLevel = 'quick' | 'full';

/** Names a step of the tour; its title and text are `tour.steps.<id>` in the catalogs. */
export type TourStepId =
  | 'conversation'
  | 'start'
  | 'reply'
  | 'title'
  | 'order'
  | 'states'
  | 'resolve'
  | 'filters'
  | 'snooze'
  | 'pinAndTag'
  | 'views'
  | 'activity';

/** A request to open the interface tour at a level, optionally starting on a specific step. */
export type TourRequest = { level: TourLevel; initialStep?: TourStepId };

/** The open interface tour (src/app/tour/) and its request; undefined while it is closed. */
export const tourAtom = atom<TourRequest | undefined>(undefined);

/**
 * The accounts (session IDs, matrix/session/sessions.ts) that answered the offer of the tour
 * (src/app/tour/TourOffer.tsx) since the page loaded, while their stored answer is on its way or
 * after it was refused; the offer of the Mac app (src/app/shell/MacAppOffer.tsx) waits for it.
 */
export const tourOfferAnsweredAtom = atom<ReadonlySet<string>>(new Set<string>());

/**
 * Contextual tip IDs dismissed per session ID since the page loaded, so switching accounts never
 * leaks dismissals and an in-flight or failed account-data write keeps a tip dismissed for the
 * current page load.
 */
export const dismissedTipsSessionAtom = atom<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
