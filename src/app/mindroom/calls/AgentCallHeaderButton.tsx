import React, { MouseEventHandler, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { UserEvent, UserEventHandlerMap } from 'matrix-js-sdk';
import {
  Box,
  color,
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
import { useForceUpdate } from '../../hooks/useForceUpdate';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoom } from '../../hooks/useRoom';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { stopPropagation } from '../../utils/keyboard';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import { isConfirmedMatrixEventId } from '../threads/threadRouteUtils';
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
  const { startAgentCall, supported, loading, error, unavailableReason } = useStartAgentCall();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [noticeAnchor, setNoticeAnchor] = useState<RectCords>();
  const reasonId = useId();
  const [, forceUpdate] = useForceUpdate();
  const viewerUserId = mx.getUserId() ?? undefined;

  useEffect(() => {
    // Fires for every m.presence; `Presence` fires only when online/offline changes, not the status.
    const handlePresence: UserEventHandlerMap[UserEvent.LastPresenceTs] = (_event, user) => {
      if (isMindroomAgentUserIdForViewer(user.userId, viewerUserId)) forceUpdate();
    };
    mx.on(UserEvent.LastPresenceTs, handlePresence);
    return () => {
      mx.removeListener(UserEvent.LastPresenceTs, handlePresence);
    };
  }, [mx, viewerUserId, forceUpdate]);

  const candidates = getAgentCallCandidates(
    members,
    viewerUserId,
    (userId) => mx.getUser(userId)?.presenceStatusMsg
  );
  // An unsupported homeserver or browser hides the button for good; only an active call disables it.
  if (!supported || candidates.length === 0 || room.isCallRoom()) return null;

  // A new thread's root is a local echo until it is sent; the backend can only resolve a real event.
  const origin: MindroomAgentCallOrigin = {
    room_id: room.roomId,
    thread_id: isConfirmedMatrixEventId(threadId) ? threadId : null,
  };
  const disabled = loading || !!unavailableReason;
  const errorText = localizeVoiceErrorMessage(
    t,
    error,
    t('mindroomUi.calls.agentCallButton.failedToStart')
  );
  const reason = unavailableReason ?? errorText;
  const noticeOpen = !!errorText && !!noticeAnchor;
  const label =
    candidates.length === 1
      ? t('mindroomUi.calls.agentCallHeaderButton.callAgent', { name: candidates[0].displayName })
      : t('mindroomUi.calls.agentCallHeaderButton.call');

  const handleCall = async (candidate: AgentCallCandidate, anchor: RectCords) => {
    setMenuAnchor(undefined);
    setNoticeAnchor(undefined);
    // Touch devices have no hover, so a failed start is shown next to the button, not only in its tooltip.
    if (!(await startAgentCall(candidate, origin))) setNoticeAnchor(anchor);
  };

  const handleClick: MouseEventHandler<HTMLButtonElement> = (evt) => {
    if (disabled) return;
    const anchor = evt.currentTarget.getBoundingClientRect();
    if (candidates.length === 1) {
      handleCall(candidates[0], anchor);
      return;
    }
    setMenuAnchor(anchor);
  };

  return (
    <>
      <TooltipProvider
        position="Bottom"
        offset={4}
        tooltip={
          // The notice already shows the error; a hover tooltip would cover it with the same text.
          noticeOpen ? null : (
            <Tooltip>
              <Text>{reason ?? label}</Text>
            </Tooltip>
          )
        }
      >
        {(triggerRef) => (
          <IconButton
            fill="None"
            ref={triggerRef}
            onClick={handleClick}
            aria-label={label}
            aria-describedby={reason ? reasonId : undefined}
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
      {reason && (
        <span id={reasonId} hidden>
          {reason}
        </span>
      )}
      <PopOut
        anchor={menuAnchor}
        position="Bottom"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: true,
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
                    onClick={() => {
                      if (menuAnchor) handleCall(candidate, menuAnchor);
                    }}
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
      <PopOut
        anchor={noticeOpen ? noticeAnchor : undefined}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: true,
              onDeactivate: () => setNoticeAnchor(undefined),
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu style={{ maxWidth: toRem(280), width: '100vw' }}>
              <Box alignItems="Start" gap="200" style={{ padding: config.space.S300 }}>
                <Text role="alert" size="T300" style={{ flexGrow: 1, color: color.Critical.Main }}>
                  {errorText}
                </Text>
                <IconButton
                  size="300"
                  radii="300"
                  fill="None"
                  onClick={() => setNoticeAnchor(undefined)}
                  aria-label={t('mindroomUi.calls.agentCallHeaderButton.close')}
                >
                  <Icon size="100" src={Icons.Cross} />
                </IconButton>
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}
