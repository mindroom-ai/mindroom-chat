import { atom } from 'jotai';
import type { NavigationType } from 'react-router-dom';

/** Whether a phone's navigation drawer (the rail and the section's list over the page) is out. */
export const phoneNavDrawerOpenAtom = atom(false);

/** The drawer's place for the routed section's list, which portals itself there on phones. */
export const phoneNavSlotAtom = atom<HTMLElement | null>(null);

/**
 * Whether the drawer is out after a navigation: arriving at a section's own page opens it, since
 * that page's list is what the person came for; moving on to any other page closes it. A replace
 * keeps it as it was (address clean-ups replace the page while the drawer is out), except one that
 * leads away from a section's own page: a redirect, such as a short room link that first matched
 * a space's address, was not a visit to the list.
 */
export const nextPhoneNavDrawerOpen = (
  open: boolean,
  sectionRoot: boolean,
  action: NavigationType | `${NavigationType}`,
  fromSectionRoot = false
): boolean => {
  if (sectionRoot) return true;
  return action === 'REPLACE' && !fromSectionRoot ? open : false;
};
