import { useCallback, useEffect, useRef } from 'react';
import { atom, useAtom, useSetAtom } from 'jotai';
import { NavigationType, useLocation, useNavigationType } from 'react-router-dom';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { getScreenSize, ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useSetting } from '../preferences/useSetting';
import { settingsAtom } from '../preferences/settings';
import { useMembersOverlay } from './PanelRow';

// On phones the members drawer covers the room, so it opens only when asked and is not saved;
// this is that per-account, in-memory state.
export const phoneDrawerOpenAtom = atom<Record<string, boolean>>({});

const isPhoneViewport = (): boolean =>
  typeof document !== 'undefined' && getScreenSize(document.body.clientWidth) === ScreenSize.Mobile;

/**
 * Whether the room's members drawer is open, and a setter. Beside the room (tablet, desktop) it
 * is the saved `isPeopleDrawer` setting; over it (phones, and rooms too narrow for it beside
 * them) it opens only when asked and does not change that setting.
 */
export const useMembersDrawer = (): [boolean, (open: boolean) => void] => {
  const userId = useMatrixClient().getSafeUserId();
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const overlay = useMembersOverlay();
  const [isPeopleDrawer, setPeopleDrawer] = useSetting(settingsAtom, 'isPeopleDrawer');
  const [phoneOpen, setPhoneOpen] = useAtom(phoneDrawerOpenAtom);

  const setOpen = useCallback(
    (open: boolean) => {
      // Decided when called: a callback from a wide layout can run after the window narrowed.
      if (overlay || isPhoneViewport()) {
        setPhoneOpen((current) => ({ ...current, [userId]: open }));
        return;
      }
      setPeopleDrawer(open);
    },
    [overlay, setPeopleDrawer, setPhoneOpen, userId]
  );

  return [mobile || overlay ? phoneOpen[userId] ?? false : isPeopleDrawer, setOpen];
};

/**
 * Over the page (a phone, or a room too narrow for them beside it), the members belong to the page
 * they were opened on: a navigation (a push or a pop) puts them away, also one to a page that
 * mounts its own members panel. Rendered once, by the signed-in layout.
 */
export function MembersOverlayFollowsNavigation(): null {
  const { key } = useLocation();
  const action = useNavigationType();
  const setPhoneOpen = useSetAtom(phoneDrawerOpenAtom);
  const shownKey = useRef(key);
  useEffect(() => {
    if (key === shownKey.current) return;
    shownKey.current = key;
    // A replace is the page cleaning up its own address (a sent thread's real ID, a resolved
    // alias), as the drawer's rule has it.
    if (action === NavigationType.Replace) return;
    setPhoneOpen((current) => (Object.values(current).some(Boolean) ? {} : current));
  }, [key, action, setPhoneOpen]);
  return null;
}
