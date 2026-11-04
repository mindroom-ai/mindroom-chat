import { useCallback } from 'react';
import { atom, useAtom } from 'jotai';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getScreenSize, ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';

// On phones the members drawer covers the room, so it opens only when asked and is not saved;
// this is that per-account, in-memory state.
export const phoneDrawerOpenAtom = atom<Record<string, boolean>>({});

const isPhoneViewport = (): boolean =>
  typeof document !== 'undefined' && getScreenSize(document.body.clientWidth) === ScreenSize.Mobile;

/**
 * Whether the room's members drawer is open, and a setter. Beside the room (tablet, desktop) it
 * is the saved `isPeopleDrawer` setting; on phones it is an overlay that does not change that.
 */
export const useMembersDrawer = (): [boolean, (open: boolean) => void] => {
  const userId = useMatrixClient().getSafeUserId();
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const [isPeopleDrawer, setPeopleDrawer] = useSetting(settingsAtom, 'isPeopleDrawer');
  const [phoneOpen, setPhoneOpen] = useAtom(phoneDrawerOpenAtom);

  const setOpen = useCallback(
    (open: boolean) => {
      // Decided when called: a callback from a wide layout can run after the window narrowed.
      if (isPhoneViewport()) {
        setPhoneOpen((current) => ({ ...current, [userId]: open }));
        return;
      }
      setPeopleDrawer(open);
    },
    [setPeopleDrawer, setPhoneOpen, userId]
  );

  return [mobile ? phoneOpen[userId] ?? false : isPeopleDrawer, setOpen];
};
