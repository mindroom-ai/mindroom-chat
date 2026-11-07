import { useLayoutEffect } from 'react';
import { atom, useSetAtom } from 'jotai';
import { useLocation, type NavigationType } from 'react-router-dom';

/** Whether a phone's navigation drawer (the rail and the section's list over the page) is out. */
export const phoneNavDrawerOpenAtom = atom(false);

/** The drawer's place for the routed section's list, which portals itself there on phones. */
export const phoneNavSlotAtom = atom<HTMLElement | null>(null);

/**
 * The history entry (location key) whose page is a section's own page (Home, Direct Messages, a
 * space, the Inbox, Explore), set by that page while it is shown. A page matched at a section's
 * address that shows something else (a short room link's redirect, a room to join) never sets it.
 */
export const phoneNavSectionRootAtom = atom<string | null>(null);

/** Marks the shown history entry as a section's own page, for as long as the page is shown. */
export const useMarkPhoneSectionRoot = (): void => {
  const { key } = useLocation();
  const setSectionRoot = useSetAtom(phoneNavSectionRootAtom);
  useLayoutEffect(() => {
    setSectionRoot(key);
    return () => setSectionRoot((current) => (current === key ? null : current));
  }, [key, setSectionRoot]);
};

/**
 * Whether the drawer is out after a navigation: arriving at a section's own page opens it, since
 * that page's list is what the person came for; moving on to any other page closes it. A replace
 * keeps it as it was, because address clean-ups replace the page while the drawer is out.
 */
export const nextPhoneNavDrawerOpen = (
  open: boolean,
  sectionRoot: boolean,
  action: NavigationType | `${NavigationType}`
): boolean => {
  if (sectionRoot) return true;
  return action === 'REPLACE' ? open : false;
};
