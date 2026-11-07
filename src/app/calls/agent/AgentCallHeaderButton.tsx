import { forwardRef, useMemo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import FocusTrap from 'focus-trap-react';
import { Box, Icon, IconButton, Icons, Spinner, Text, Tooltip, toRem, type RectCords } from 'folds';
import { PopOut, TooltipProvider } from '../../ui/directional';
import { Menu, MenuItem } from '../../ui/glass/GlassPrimitives';
import { preloadOnIntent } from '../../lib/preloadOnIntent';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoom } from '../../matrix/hooks/useRoom';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import {
  getAgentCallCandidates,
  keepThreadSenders,
  type AgentCallCandidate,
} from './agentCallCandidates';
import { usePresenceStatuses } from './agentPresence';
import { useAgentCaller } from './agentCaller';
import { loadCallEngine } from '../callStore';
import { loadCallPanel } from '../loadCallPanel';

type AgentCallHeaderButtonProps = {
  /** The open thread; the call is offered to the agents that took part in it. */
  threadId?: string;
  /** The agents to offer, as the header looked them up (`useAgentCallCandidates`). */
  candidates: AgentCallCandidate[];
};

/** The room's voice-capable agents; in a thread, the ones that took part in it when any did. */
export const useAgentCallCandidates = (
  room: Room,
  threadId: string | undefined
): AgentCallCandidate[] => {
  const mx = useMatrixClient();
  const viewer = mx.getUserId() ?? undefined;
  const members = useRoomMembers(mx, room.roomId);
  const agentIds = useMemo(
    () =>
      members
        .filter((member) => isMindroomAgentUserIdForViewer(member.userId, viewer))
        .map((member) => member.userId),
    [members, viewer]
  );
  const statuses = usePresenceStatuses(mx, agentIds);
  return useMemo(() => {
    const candidates = getAgentCallCandidates(members, viewer, (userId) => statuses.get(userId));
    if (!threadId) return candidates;
    const inThread = keepThreadSenders(candidates, room, threadId);
    return inThread.length > 0 ? inThread : candidates;
  }, [members, viewer, statuses, room, threadId]);
};

type ChooserProps = {
  candidates: AgentCallCandidate[];
  onChoose: (candidate: AgentCallCandidate) => void;
};

const AgentChooser = forwardRef<HTMLDivElement, ChooserProps>(function AgentChooser(
  { candidates, onChoose },
  ref
) {
  const { t } = useTranslation();
  return (
    <Menu
      ref={ref}
      role="menu"
      aria-label={t('mindroomUi.calls.agentCallHeaderButton.chooseAgent')}
      style={{ minWidth: toRem(200), maxWidth: toRem(280) }}
    >
      <Box direction="Column" gap="100" style={{ padding: toRem(4) }}>
        <Text size="L400" priority="300" style={{ padding: `${toRem(4)} ${toRem(8)}` }}>
          {t('mindroomUi.calls.agentCallHeaderButton.chooseAgent')}
        </Text>
        {candidates.map((candidate) => (
          <MenuItem
            key={candidate.userId}
            size="300"
            radii="300"
            variant="Surface"
            role="menuitem"
            after={<Icon size="100" src={Icons.Phone} />}
            onClick={() => onChoose(candidate)}
          >
            <Text as="span" size="T300" align="Left" truncate style={{ flexGrow: 1 }}>
              {t('mindroomUi.calls.agentCallHeaderButton.callAgent', {
                name: candidate.displayName,
              })}
            </Text>
          </MenuItem>
        ))}
      </Box>
    </Menu>
  );
});

/**
 * The room header's button for calling the room's voice-capable agent: one agent is called at
 * once, several open a menu to choose from. The call is about the open thread, or the room's
 * timeline outside a thread. Call rooms have their call in the room itself, so they show none.
 */
export function AgentCallHeaderButton({ threadId, candidates }: AgentCallHeaderButtonProps) {
  const { t } = useTranslation();
  const room = useRoom();
  // The header has no room for the reason a call did not start; the call notices show it.
  const { call, pending } = useAgentCaller({ announce: true });
  const [anchor, setAnchor] = useState<RectCords>();

  if (candidates.length === 0 || room.isCallRoom()) return null;
  const single = candidates.length === 1 ? candidates[0] : undefined;
  const label = single
    ? t('mindroomUi.calls.agentCallHeaderButton.callAgent', { name: single.displayName })
    : t('mindroomUi.calls.agentCallHeaderButton.call');

  const start = (candidate: AgentCallCandidate) => {
    setAnchor(undefined);
    void call({
      agentUserId: candidate.userId,
      displayName: candidate.displayName,
      roomId: room.roomId,
      threadId,
    });
  };

  return (
    <>
      <TooltipProvider
        position="Bottom"
        offset={4}
        tooltip={
          <Tooltip>
            <Text size="T200">{label}</Text>
          </Tooltip>
        }
      >
        {(anchorRef) => (
          <IconButton
            ref={anchorRef}
            size="400"
            radii="300"
            variant="Surface"
            fill={anchor ? 'Soft' : 'None'}
            aria-label={label}
            aria-haspopup={single ? undefined : 'menu'}
            aria-expanded={single ? undefined : !!anchor}
            aria-busy={pending}
            disabled={pending}
            data-agent-call-button=""
            // The click starts the call at once: the engine, then the panel it shows in.
            {...preloadOnIntent(loadCallEngine, loadCallPanel)}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              if (single) {
                start(single);
                return;
              }
              const { x, y, width, height } = event.currentTarget.getBoundingClientRect();
              setAnchor({ x, y, width, height });
            }}
          >
            {pending ? (
              <Spinner size="200" variant="Secondary" />
            ) : (
              <Icon size="400" src={Icons.Phone} />
            )}
          </IconButton>
        )}
      </TooltipProvider>
      <PopOut
        anchor={anchor}
        position="Bottom"
        align="End"
        offset={4}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              clickOutsideDeactivates: () => {
                setAnchor(undefined);
                return true;
              },
              escapeDeactivates: () => {
                setAnchor(undefined);
                return true;
              },
            }}
          >
            <AgentChooser candidates={candidates} onChoose={start} />
          </FocusTrap>
        }
      />
    </>
  );
}
