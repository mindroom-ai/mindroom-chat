import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import { Icon, Icons } from 'folds';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../components/sidebar';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useRoomName } from '../../hooks/useRoomMeta';
import {
  callHomeRoomId,
  callPanelRoomAtom,
  useActiveCall,
  useCallState,
  type ActiveCall,
} from './callStore';
import * as css from './CallTab.css';

function ActiveCallTab({ active }: { active: ActiveCall }) {
  const { t } = useTranslation();
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const setPanelRoom = useSetAtom(callPanelRoomAtom);
  const state = useCallState(active.call);
  const homeRoomId = callHomeRoomId(active);
  const name = useRoomName(active.call.room);
  const label = t('featureUi.calls.rail.returnToCall', { room: name });
  const speaking = state.participants.some((participant) => participant.speaking);

  const open = () => {
    setPanelRoom(homeRoomId);
    const threadId = active.origin?.threadId;
    if (threadId) navigateRoomThread(homeRoomId, threadId);
    else navigateRoom(homeRoomId);
  };

  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip={label}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={label}
            data-call-tab=""
            data-speaking={speaking}
            className={css.CallTab}
            onClick={open}
          >
            <Icon src={state.microphone ? Icons.Phone : Icons.MicMute} filled />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}

/** The rail's way back to the call this device is in, wherever the person went meanwhile. */
export function CallTab() {
  const active = useActiveCall();
  if (!active) return null;
  return <ActiveCallTab active={active} />;
}
