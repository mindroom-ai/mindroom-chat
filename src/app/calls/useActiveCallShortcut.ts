import { useStore } from 'jotai';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icons } from 'folds';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoomName } from '../matrix/hooks/useRoomMeta';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { afterWaitingSlide, movePhoneNavDrawer } from '../navigation/phonePageSlide';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useSelectedRoom } from '../navigation/useSelectedRoom';
import { revealDirectionControls } from '../ui/directional';
import { callHomeRoomId, callPanelRoomAtom, useCallState, type ActiveCall } from './callStore';

/** What the rail and phone shortcuts show, and how they return to the call panel. */
export function useActiveCallShortcut(active: ActiveCall) {
  const { t } = useTranslation();
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const store = useStore();
  const mx = useMatrixClient();
  const here = useSelectedRoom();
  const { search } = useLocation();
  const { microphone, participants } = useCallState(active.call);
  const homeRoomId = callHomeRoomId(active);
  const name = revealDirectionControls(useRoomName(mx.getRoom(homeRoomId) ?? active.call.room));

  const openHome = () => {
    // The rail and the pill can both be used with the drawer open, even without a navigation.
    if (store.get(phoneNavDrawerOpenAtom)) {
      movePhoneNavDrawer(false, (open) => store.set(phoneNavDrawerOpenAtom, open));
    }
    afterWaitingSlide(() => {
      store.set(callPanelRoomAtom, homeRoomId);
      const threadId = active.origin?.threadId;
      if (
        here === homeRoomId &&
        (!threadId || new URLSearchParams(search).get('threadId') === threadId)
      )
        return;
      if (threadId) navigateRoomThread(homeRoomId, threadId);
      else navigateRoom(homeRoomId);
    });
  };

  return {
    label: t('featureUi.calls.rail.returnToCall', { room: name }),
    icon: microphone ? Icons.Phone : Icons.MicMute,
    speaking: participants.some((participant) => participant.speaking),
    microphone,
    openHome,
  };
}
