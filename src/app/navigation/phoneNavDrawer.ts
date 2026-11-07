import { atom } from 'jotai';
import type { NavigationType } from 'react-router-dom';

/** Whether a phone's navigation drawer (the rail and the section's list over the page) is out. */
export const phoneNavDrawerOpenAtom = atom(false);

/** The drawer's place for the routed section's list, which portals itself there on phones. */
export const phoneNavSlotAtom = atom<HTMLElement | null>(null);

/**
 * Whether the drawer is out after a navigation: arriving at a section's own page opens it, since
 * that page's list is what the person came for; moving on to any other page closes it. A replace
 * keeps it as it was, because redirects (a space's root to its lobby) and address clean-ups replace
 * the page while the drawer is out.
 */
export const nextPhoneNavDrawerOpen = (
  open: boolean,
  sectionRoot: boolean,
  action: NavigationType | `${NavigationType}`
): boolean => {
  if (sectionRoot) return true;
  return action === 'REPLACE' ? open : false;
};
