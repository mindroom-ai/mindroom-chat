import { atom, useAtom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';

const mobileMembersOpenAtomFamily = atomFamily((_userId: string) => atom(false));

export function useMembersDrawer() {
  const userId = useMatrixClient().getSafeUserId();
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const desktopState = useSetting(settingsAtom, 'isPeopleDrawer');
  const mobileState = useAtom(mobileMembersOpenAtomFamily(userId));

  // Opening an overlay on a phone is independent of the saved split-layout preference.
  return mobile ? mobileState : desktopState;
}
