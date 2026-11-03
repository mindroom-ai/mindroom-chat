import React, {
  MouseEvent,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { ThreadEvent, UserEvent } from 'matrix-js-sdk';
import {
  Box,
  Icon,
  IconButton,
  Icons,
  PopOut,
  RectCords,
  Text,
  Tooltip,
  TooltipProvider,
  config,
} from 'folds';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoom } from '../../hooks/useRoom';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { isConfirmedMatrixEventId } from '../threads/threadRouteUtils';
import { localizeVoiceErrorMessage } from '../voice/voiceErrorMessage';
import { toAgentCallOrigin } from './agentCall';
import {
  type AgentCallCandidate,
  getAgentCallCandidates,
  keepThreadSenders,
} from './agentCallCandidates';
import { useStartAgentCall } from './useStartAgentCall';

const THREAD_EVENTS = [ThreadEvent.New, ThreadEvent.Update, ThreadEvent.NewReply] as const;

/**
 * The room header's call button: calls the room's voice-capable agent, or offers a choice when
 * there are several. In a thread it offers only the agents that took part there.
 */
export function AgentCallHeaderButton({ threadId }: { threadId?: string }) {




  const viewerUserId = mx.getUserId() ?? undefined;
  // A thread whose root is still a local echo has no replies to read yet.
  const senderThreadId = isConfirmedMatrixEventId(threadId) ? threadId : undefined;

  // Presence and thread activity change often; the button renders again only when who can be
  // called changes, so the snapshot is the candidate list as a string.
  const subscribe = useCallback(
    (onChange: () => void) => {
      // A status message change alone fires only LastPresenceTs.
      mx.on(UserEvent.Presence, onChange);
      mx.on(UserEvent.LastPresenceTs, onChange);
      THREAD_EVENTS.forEach((event) => room.on(event, onChange));
      return () => {
        mx.off(UserEvent.Presence, onChange);
        mx.off(UserEvent.LastPresenceTs, onChange);
        THREAD_EVENTS.forEach((event) => room.off(event, onChange));
      };
    },
    [mx, room]
  );
  const getSnapshot = () => {
    const candidates = getAgentCallCandidates(
      members,
      viewerUserId,
      (userId) => mx.getUser(userId)?.presenceStatusMsg ?? undefined
    );
    return JSON.stringify(
      senderThreadId ? keepThreadSenders(candidates, room, senderThreadId) : candidates
    );
  };
  const candidatesKey = useSyncExternalStore(subscribe, getSnapshot);
  const candidates = useMemo(
    () => JSON.parse(candidatesKey) as AgentCallCandidate[],
    [candidatesKey]
  );

  const { startAgentCall, supported, loading, error, unavailableReason } = useStartAgentCall();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const reasonId = useId();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [noticeAnchor, setNoticeAnchor] = useState<RectCords>();

  const returnFocus = useCallback(() => triggerRef.current ?? false, []);

  if (!supported || room.isCallRoom() || candidates.length === 0) return null;

  const label =
    candidates.length === 1
      ? t('mindroomUi.calls.agentCallHeaderButton.callAgent', { name: candidates[0].displayName })
      : t('mindroomUi.calls.agentCallHeaderButton.callAnAgent');
  const notice =
    noticeAnchor && error
      ? localizeVoiceErrorMessage(t, error, t('mindroomUi.calls.agentCallButton.startFailed'))
      : undefined;

  const call = async (agent: AgentCallCandidate, anchor: RectCords) => {
    setMenuAnchor(undefined);
    setNoticeAnchor(undefined);
    const started = await startAgentCall(agent, toAgentCallOrigin(room.roomId, threadId));
    if (!started) setNoticeAnchor(anchor);
  };

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (unavailableReason || loading) return;
    const anchor = event.currentTarget.getBoundingClientRect();
    if (candidates.length === 1) {
      call(candidates[0], anchor).catch(() => undefined);
      return;
    }
    setMenuAnchor(anchor);
  };

  const trigger = (ref?: (node: HTMLElement | SVGElement | null) => void) => (
    <IconButton
      ref={(node: HTMLButtonElement | null) => {
        triggerRef.current = node;
        ref?.(node);
      }}
      variant="Surface"
      fill="None"
      aria-label={label}
      aria-describedby={unavailableReason ? reasonId : undefined}
      aria-disabled={unavailableReason ? true : undefined}
      aria-haspopup={candidates.length > 1 ? 'menu' : undefined}
      aria-expanded={candidates.length > 1 ? !!menuAnchor : undefined}
      onClick={handleClick}
    >
      <Icon size="400" src={Icons.Phone} />
    </IconButton>
  );

  return (
    <>
      <TooltipProvider
        position="Bottom"
        offset={4}
        tooltip={
          notice ? undefined : (
            <Tooltip>
              <Box direction="Column">
                <Text size="T300">{label}</Text>
                {unavailableReason && (
                  <Text size="T200" priority="300">
                    {unavailableReason}
                  </Text>
                )}
              </Box>
            </Tooltip>
          )
        }
      >
        {(ref) => trigger(ref)}
      </TooltipProvider>
      {unavailableReason && (
        <span id={reasonId} hidden>
          {unavailableReason}
        </span>
      )}
      <PopOut
        anchor={menuAnchor}
        position="Bottom"
        align="End"
        offset={4}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: true,
              setReturnFocus: returnFocus,
              onDeactivate: () => setMenuAnchor(undefined),
              clickOutsideDeactivates: true,
              escapeDeactivates: true,
            }}
          >
            <Menu style={{ maxWidth: 'min(18rem, calc(100vw - 2rem))' }}>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                <Box style={{ padding: `${config.space.S200} ${config.space.S200} 0` }}>
                  <Text size="L400">{t('mindroomUi.calls.agentCallHeaderButton.chooseAgent')}</Text>
                </Box>
                {candidates.map((candidate) => (
                  <MenuItem
                    key={candidate.userId}
                    size="300"
                    radii="300"
                    onClick={() => {
                      if (menuAnchor) call(candidate, menuAnchor).catch(() => undefined);
                    }}
                  >
                    <Text size="T300" truncate>
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
        anchor={notice ? noticeAnchor : undefined}
        position="Bottom"
        align="End"
        offset={4}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: true,
              setReturnFocus: returnFocus,
              onDeactivate: () => setNoticeAnchor(undefined),
              clickOutsideDeactivates: true,
              escapeDeactivates: true,
            }}
          >
            <Menu style={{ maxWidth: 'min(20rem, calc(100vw - 2rem))' }}>
              <Box alignItems="Start" gap="200" style={{ padding: config.space.S300 }}>
                <Icon size="200" src={Icons.Warning} />
                <Box grow="Yes" style={{ minWidth: 0 }}>
                  <Text as="p" size="T300" role="alert">
                    {notice}
                  </Text>
                </Box>
                <IconButton
                  size="300"
                  radii="300"
                  variant="Surface"
                  aria-label={t('mindroomUi.calls.agentCallHeaderButton.close')}
                  onClick={() => setNoticeAnchor(undefined)}
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
