import { atom } from 'jotai';

/**
 * The place at the foot of the room list beside the page (ResizablePageNav), where the new
 * version notice shows while there is one (shell/NewVersionNotice.tsx). Phones, whose list is in
 * the drawer, have none. A module of its own, so the app's first screen loads without the list.
 */
export const pageNavNoticeSlotAtom = atom<HTMLElement | null>(null);
