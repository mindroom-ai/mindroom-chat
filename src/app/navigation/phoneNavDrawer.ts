import { useLayoutEffect } from 'react';
import { atom, useSetAtom } from 'jotai';
import { useLocation, type NavigationType } from 'react-router-dom';

/** Whether a phone's navigation drawer (the rail and the section's list over the page) is out. */
export const phoneNavDrawerOpenAtom = atom(false);

/** The drawer's place for the routed section's list, which portals itself there on phones. */
export const phoneNavSlotAtom = atom<HTMLElement | null>(null);

/**
 * The layer below a phone's top bar, under the drawer, where a sheet from the end edge (a room's
 * members) slides in; there while the phone layout is.
 */
export const phoneSheetSlotAtom = atom<HTMLElement | null>(null);

/**
 * Whether a phone's top bar gives way to a bar of the page's own: an open thread's, which holds
 * the way back and the thread's title in the top bar's place (ThreadContextBanner).
 */
export const phoneTopBarHiddenAtom = atom(false);

/** The layout sets it to 0 while the top bar is hidden; the layers under the bar start there. */
export const PHONE_TOP_BAR_OFFSET_PROPERTY = '--phone-top-bar-offset';

/**
 * Hides a phone's top bar while `hide` holds and the caller is mounted. A layout effect, so the
 * bar is gone before the frame that shows the caller's own.
 */
export const useHidePhoneTopBar = (hide: boolean): void => {
  const setHidden = useSetAtom(phoneTopBarHiddenAtom);
  useLayoutEffect(() => {
    if (!hide) return undefined;
    setHidden(true);
    return () => setHidden(false);
  }, [hide, setHidden]);
};

/** Whether a sheet is out in that layer (not while it slides away). */
export const phoneSheetOpenAtom = atom(false);

/** Whether the drawer or a sheet covers a phone's page: edge swipes rest meanwhile. */
export const phoneLayerOpenAtom = atom(
  (get) => get(phoneNavDrawerOpenAtom) || get(phoneSheetOpenAtom)
);

/**
 * How long the drawer or a sheet keeps its content after it was put away: until it has slid out
 * (the Slower motion token, and a frame to spare).
 */
export const PHONE_SLIDE_OUT_MS = 320;

/**
 * The history entry (location key) whose page is a section's own page (Home, Direct Messages, a
 * space, Activity, Explore), set by that page while it is shown. A page matched at a section's
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
 * Whether the drawer is out after a navigation or a change of the shown page: arriving at a
 * section's own page opens it, since that page's list is what the person came for; moving on to
 * any other page closes it. A replace keeps it as it was, because a room's address clean-ups
 * replace the page while the drawer is out, unless the replace leaves a section page the drawer
 * came out for (an account restored from another tab, a space left while shown).
 */
export const nextPhoneNavDrawerOpen = (
  open: boolean,
  sectionRoot: boolean,
  action: NavigationType | `${NavigationType}`,
  fromSectionRoot: boolean
): boolean => {
  if (sectionRoot) return true;
  return action === 'REPLACE' && !fromSectionRoot ? open : false;
};
