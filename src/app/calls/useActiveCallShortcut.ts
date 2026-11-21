import { useStore } from 'jotai';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icons } from 'folds';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoomName } from '../matrix/hooks/useRoomMeta';
import { PHONE_NAV_MENU_BUTTON_ID, phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { afterWaitingSlide, slidePhonePage } from '../navigation/phonePageSlide';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useSelectedRoom } from '../navigation/useSelectedRoom';
import { revealDirectionControls } from '../ui/directional';
import {
  activeCallAtom,
  callHomeRoomId,
  callPanelRequestAtom,
  callPanelRoomAtom,
  isLiveCallPhase,
  useCallState,
  type ActiveCall,
} from './callStore';
import { focusHandOffAtom, type FocusHandOff } from './window/callWindowState';

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

  const openHome = (button: HTMLButtonElement) => {
    const doc = button.ownerDocument;
    const focused = doc.activeElement;
    const wasLive = isLiveCallPhase(active.call.getState().phase);
    const drawerOpen = store.get(phoneNavDrawerOpenAtom);
    const open = () => {
      // A skipped return leaves the drawer open. A rail click on an already failed call can
      // still open it for dismissal.
      if (
        store.get(activeCallAtom) !== active ||
        (wasLive && !isLiveCallPhase(active.call.getState().phase))
      )
        return;
      // Establish the source for touch and assistive clicks too. Leave a new focus alone,
      // unless it fell back to the body while the return waited.
      if (doc.activeElement === focused || doc.activeElement === doc.body) {
        button.focus({ preventScroll: true });
        const handOff: FocusHandOff = { to: 'panel', roomId: homeRoomId, from: doc.activeElement };
        store.set(focusHandOffAtom, handOff);
        if (drawerOpen) {
          // Don't strand focus in the drawer if no panel has taken the hand-off by the next
          // frame. A newer hand-off or another element taking focus wins.
          doc.defaultView?.requestAnimationFrame(() => {
            if (store.get(focusHandOffAtom) !== handOff) return;
            const current = doc.activeElement;
            if (current === handOff.from || current === doc.body) {
              doc.getElementById(PHONE_NAV_MENU_BUTTON_ID)?.focus({ preventScroll: true });
            }
            store.set(focusHandOffAtom, undefined);
          });
        }
      }
      store.set(phoneNavDrawerOpenAtom, false);
      store.set(callPanelRoomAtom, homeRoomId);
      store.set(callPanelRequestAtom, { roomId: homeRoomId });
      const threadId = active.origin?.threadId;
      if (
        here === homeRoomId &&
        (!threadId || new URLSearchParams(search).get('threadId') === threadId)
      )
        return;
      if (threadId) navigateRoomThread(homeRoomId, threadId);
      else navigateRoom(homeRoomId);
    };
    // Close the drawer and open the panel in one change, even without a navigation.
    if (drawerOpen) slidePhonePage(open);
    else afterWaitingSlide(open);
  };

  return {
    label: t('featureUi.calls.rail.returnToCall', { room: name }),
    icon: microphone ? Icons.Phone : Icons.MicMute,
    speaking: participants.some((participant) => participant.speaking),
    microphone,
    openHome,
  };
}
