import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Icons } from 'folds';
import { useRoomName } from '../matrix/hooks/useRoomMeta';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { revealDirectionControls } from '../ui/directional';
import { callHomeRoomId, callPanelRoomAtom, useCallState, type ActiveCall } from './callStore';

/** What the rail and phone shortcuts show, and how they return to the call panel. */
export function useActiveCallShortcut(active: ActiveCall) {
  const { t } = useTranslation();
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const setPanelRoom = useSetAtom(callPanelRoomAtom);
  const { microphone, participants } = useCallState(active.call);
  const homeRoomId = callHomeRoomId(active);
  const name = revealDirectionControls(useRoomName(active.call.room));

  const openHome = () => {
    setPanelRoom(homeRoomId);
    const threadId = active.origin?.threadId;
    if (threadId) navigateRoomThread(homeRoomId, threadId);
    else navigateRoom(homeRoomId);
  };

  return {
    label: t('featureUi.calls.rail.returnToCall', { room: name }),
    icon: microphone ? Icons.Phone : Icons.MicMute,
    speaking: participants.some((participant) => participant.speaking),
    microphone,
    openHome,
  };
}
