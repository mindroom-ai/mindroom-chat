import React, { MouseEventHandler, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { UserEvent, UserEventHandlerMap } from 'matrix-js-sdk';
import {
  Box,
  config,
  Icon,
  IconButton,
  Icons,
  PopOut,
  RectCords,
  Spinner,
  Text,
  toRem,
  Tooltip,
  TooltipProvider,
} from 'folds';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoom } from '../../hooks/useRoom';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { stopPropagation } from '../../utils/keyboard';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import { localizeVoiceErrorMessage } from '../voice/voiceErrorMessage';
import { MindroomAgentCallOrigin } from './agentCall';
import { AgentCallCandidate, getAgentCallCandidates } from './agentCallCandidates';
import { useStartAgentCall } from './useStartAgentCall';

/** Calls a voice-capable agent in this room about the open thread (or the room) without leaving it. */
export function AgentCallHeaderButton({ threadId }: { threadId?: string }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const room = useRoom();
  const members = useRoomMembers(mx, room.roomId);
  const { startAgentCall, loading, error, unavailableReason } = useStartAgentCall();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [, setPresenceChanges] = useState(0);
  const viewerUserId = mx.getUserId() ?? undefined;

  useEffect(() => {
    const handlePresence: UserEventHandlerMap[UserEvent.Presence] = (_event, user) => {
      if (isMindroomAgentUserIdForViewer(user.userId, viewerUserId)) {
        setPresenceChanges((count) => count + 1);
      }
    };
    mx.on(UserEvent.Presence, handlePresence);
    return () => {
      mx.removeListener(UserEvent.Presence, handlePresence);
    };
  }, [mx, viewerUserId]);

  const candidates = getAgentCallCandidates(
    members,
    viewerUserId,
    (userId) => mx.getUser(userId)?.presenceStatusMsg
  );
  if (candidates.length === 0 || room.isCallRoom()) return null;

  const origin: MindroomAgentCallOrigin = { room_id: room.roomId, thread_id: threadId ?? null };
  const disabled = loading || !!unavailableReason;
  const label =
    unavailableReason ??
    localizeVoiceErrorMessage(t, error, t('mindroomUi.calls.agentCallButton.failedToStart')) ??
    (candidates.length === 1
      ? t('mindroomUi.calls.agentCallHeaderButton.callAgent', { name: candidates[0].displayName })
      : t('mindroomUi.calls.agentCallHeaderButton.call'));

  const handleCall = (candidate: AgentCallCandidate) => {
    setMenuAnchor(undefined);
    startAgentCall(candidate, origin);
  };

  const handleClick: MouseEventHandler<HTMLButtonElement> = (evt) => {
    if (disabled) return;
    if (candidates.length === 1) {
      handleCall(candidates[0]);
      return;
    }
    setMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };

  return (
    <>
      <TooltipProvider
        position="Bottom"
        offset={4}
        tooltip={
          <Tooltip>
            <Text>{label}</Text>
          </Tooltip>
        }
      >
        {(triggerRef) => (
          <IconButton
            fill="None"
            ref={triggerRef}
            onClick={handleClick}
            aria-label={label}
            aria-disabled={disabled}
            aria-haspopup={candidates.length > 1 ? 'menu' : undefined}
            aria-expanded={candidates.length > 1 ? !!menuAnchor : undefined}
          >
            {loading ? (
              <Spinner size="200" variant="Secondary" />
            ) : (
              <Icon size="400" src={Icons.Phone} />
            )}
          </IconButton>
        )}
      </TooltipProvider>
      <PopOut
        anchor={menuAnchor}
        position="Bottom"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => setMenuAnchor(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
              isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu style={{ maxWidth: toRem(240), width: '100vw' }}>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                <Box style={{ padding: `${config.space.S100} ${config.space.S200}` }}>
                  <Text size="L400">{t('mindroomUi.calls.agentCallHeaderButton.chooseAgent')}</Text>
                </Box>
                {candidates.map((candidate) => (
                  <MenuItem
                    key={candidate.userId}
                    onClick={() => handleCall(candidate)}
                    size="300"
                    after={<Icon size="100" src={Icons.Phone} />}
                    radii="300"
                  >
                    <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                      {candidate.displayName}
                    </Text>
                  </MenuItem>
                ))}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}
