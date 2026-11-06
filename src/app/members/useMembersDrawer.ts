import { createContext, useCallback, useContext } from 'react';
import { atom, useAtom } from 'jotai';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { getScreenSize, ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useSetting } from '../preferences/useSetting';
import { settingsAtom } from '../preferences/settings';

// On phones the members drawer covers the room, so it opens only when asked and is not saved;
// this is that per-account, in-memory state.
export const phoneDrawerOpenAtom = atom<Record<string, boolean>>({});

const isPhoneViewport = (): boolean =>
  typeof document !== 'undefined' && getScreenSize(document.body.clientWidth) === ScreenSize.Mobile;

/**
 * True inside a room or a lobby too narrow to show the members beside the conversation
 * (`PanelRow`): there the members lie over it, as on a phone.
 */
const MembersOverlayContext = createContext(false);
export const MembersOverlayProvider = MembersOverlayContext.Provider;
export const useMembersOverlay = (): boolean => useContext(MembersOverlayContext);

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
