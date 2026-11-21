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

const FOCUS_HAND_OFF_TIMEOUT_MS = 5_000;

/** What the rail and phone shortcuts show, and how they return to the call panel. */
export function useActiveCallShortcut(active: ActiveCall) {
  const { t } = useTranslation();
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const store = useStore();
  const mx = useMatrixClient();
  const here = useSelectedRoom();
  const location = useLocation();
  const { microphone, participants } = useCallState(active.call);
  const homeRoomId = callHomeRoomId(active);
  const name = revealDirectionControls(useRoomName(mx.getRoom(homeRoomId) ?? active.call.room));

  const openHome = (button: HTMLButtonElement) => {
    const doc = button.ownerDocument;
    const focused = doc.activeElement;
    const wasLive = isLiveCallPhase(active.call.getState().phase);
    const drawerOpen = store.get(phoneNavDrawerOpenAtom);
    const threadId = active.origin?.threadId;
    const alreadyThere =
      here === homeRoomId &&
      (!threadId || new URLSearchParams(location.search).get('threadId') === threadId);
    const open = () => {
      // A skipped return leaves the drawer open. A rail click on an already failed call can
      // still open it for dismissal.
      if (
        store.get(activeCallAtom) !== active ||
        (wasLive && !isLiveCallPhase(active.call.getState().phase))
      )
        return;
      const request = { roomId: homeRoomId };
      // Establish the source for touch and assistive clicks too. Leave a new focus alone,
      // unless it fell back to the body while the return waited.
      if (doc.activeElement === focused || doc.activeElement === doc.body) {
        button.focus({ preventScroll: true });
        let pending: FocusHandOff = { to: 'panel', roomId: homeRoomId, from: doc.activeElement };
        const cancel = () => {
          if (store.get(focusHandOffAtom) !== pending) return;
          if (store.get(callPanelRequestAtom) === request)
            store.set(callPanelRequestAtom, undefined);
          store.set(focusHandOffAtom, undefined);
        };
        const focusChanged = () => {
          if (doc.activeElement !== pending.from && doc.activeElement !== doc.body) cancel();
        };
        const timeout = doc.defaultView?.setTimeout(cancel, FOCUS_HAND_OFF_TIMEOUT_MS);
        doc.addEventListener('focusin', focusChanged);
        const stopDrawer = store.sub(phoneNavDrawerOpenAtom, () => {
          if (store.get(phoneNavDrawerOpenAtom)) cancel();
        });
        store.set(focusHandOffAtom, pending);
        const stop = store.sub(focusHandOffAtom, () => {
          if (store.get(focusHandOffAtom) === pending) return;
          doc.defaultView?.clearTimeout(timeout);
          doc.removeEventListener('focusin', focusChanged);
          stopDrawer();
          stop();
        });
        if (drawerOpen) {
          // The menu is a temporary landing spot if the heading needs longer to mount.
          doc.defaultView?.requestAnimationFrame(() => {
            const menu = doc.getElementById(PHONE_NAV_MENU_BUTTON_ID);
            const current = doc.activeElement;
            if (
              !menu ||
              store.get(focusHandOffAtom) !== pending ||
              (current !== pending.from && current !== doc.body)
            )
              return;
            pending = { ...pending, from: menu };
            store.set(focusHandOffAtom, pending);
            menu.focus({ preventScroll: true });
          });
        }
      }
      store.set(phoneNavDrawerOpenAtom, false);
      store.set(callPanelRoomAtom, homeRoomId);
      store.set(callPanelRequestAtom, request);
      if (alreadyThere) return;
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
