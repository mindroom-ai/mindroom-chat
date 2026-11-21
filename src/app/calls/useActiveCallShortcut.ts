import { useStore } from 'jotai';
import { useContext } from 'react';
import { NavigationType, UNSAFE_DataRouterContext, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icons } from 'folds';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoomName } from '../matrix/hooks/useRoomMeta';
import { canonicalizeSessionPathname } from '../navigation/clientRouteRestore';
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
  const { navigateRoom, navigateRoomThread, roomPath } = useRoomNavigate();
  const store = useStore();
  const mx = useMatrixClient();
  const here = useSelectedRoom();
  const location = useLocation();
  const router = useContext(UNSAFE_DataRouterContext)?.router;
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
      // Establish the source for touch and assistive clicks too. Leave a new focus alone,
      // unless it fell back to the body while the return waited.
      if (doc.activeElement === focused || doc.activeElement === doc.body) {
        button.focus({ preventScroll: true });
        const handOff: FocusHandOff = { to: 'panel', roomId: homeRoomId, from: doc.activeElement };
        store.set(focusHandOffAtom, handOff);
        // The menu is a temporary landing spot if the heading needs longer to mount.
        const menu = doc.getElementById(PHONE_NAV_MENU_BUTTON_ID);
        let pending = handOff;
        const cancel = () => {
          if (store.get(focusHandOffAtom) === pending) store.set(focusHandOffAtom, undefined);
        };
        const focusChanged = () => {
          const current = doc.activeElement;
          if (current !== pending.from && current !== doc.body) cancel();
        };
        // Follow only the shortcut's own push, plus its room alias being replaced by its ID.
        const start = router?.state.location.key;
        const path = router && !alreadyThere ? roomPath(homeRoomId) : undefined;
        const canonicalPath = path && canonicalizeSessionPathname(mx, path);
        const base = router?.basename?.replace(/\/$/, '') ?? '';
        let destination = alreadyThere ? start : undefined;
        let canonicalized = false;
        const stopNavigation = router?.subscribe(({ location: next, historyAction }) => {
          if (next.key === (destination ?? start)) return;
          const sameThread =
            new URLSearchParams(next.search).get('threadId') === (threadId ?? null);
          if (!sameThread) cancel();
          else if (
            destination === undefined &&
            historyAction === NavigationType.Push &&
            next.pathname === `${base}${path}`
          ) {
            destination = next.key;
          } else if (
            !canonicalized &&
            destination !== undefined &&
            historyAction === NavigationType.Replace &&
            canonicalPath !== path &&
            next.pathname === `${base}${canonicalPath}`
          ) {
            destination = next.key;
            canonicalized = true;
          } else cancel();
        });
        doc.addEventListener('focusin', focusChanged);
        const stop = store.sub(focusHandOffAtom, () => {
          if (store.get(focusHandOffAtom) === pending) return;
          doc.removeEventListener('focusin', focusChanged);
          stopNavigation?.();
          stop();
        });
        if (drawerOpen && menu) {
          doc.defaultView?.requestAnimationFrame(() => {
            const current = doc.activeElement;
            if (
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
      store.set(callPanelRequestAtom, { roomId: homeRoomId });
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
