import { forwardRef, useContext, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FocusTrap } from 'focus-trap-react';
import { Box, Icon, IconButton, Icons, Spinner, Text, Tooltip, toRem } from 'folds';
import { PopOut, TooltipProvider } from '../../ui/directional';
import { Menu, MenuItem } from '../../ui/glass/GlassPrimitives';
import { RestoreHeaderFocus, useHeaderPopup } from '../../ui/useHeaderPopup';
import { useRoom } from '../../matrix/hooks/useRoom';
import type { AgentCallCandidate } from './agentCallCandidates';
import { useAgentCaller } from './agentCaller';

type AgentCallHeaderButtonProps = {
  /** The open thread; the call is offered to the agents that took part in it. */
  threadId?: string;
  /** The agents to offer, as the header looked them up (`useAgentCallOffer`). */
  candidates: AgentCallCandidate[];
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
  const callRoom = room.isCallRoom();
  const restoreFocus = useContext(RestoreHeaderFocus);
  const chooser = useHeaderPopup(restoreFocus, !callRoom && candidates.length > 1);

  if (candidates.length === 0 || callRoom) return null;
  const single = candidates.length === 1 ? candidates[0] : undefined;
  const label = single
    ? t('mindroomUi.calls.agentCallHeaderButton.callAgent', { name: single.displayName })
    : t('mindroomUi.calls.agentCallHeaderButton.call');

  const start = (candidate: AgentCallCandidate) => {
    chooser.close();
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
            fill={chooser.opener ? 'Soft' : 'None'}
            aria-label={label}
            aria-haspopup={single ? undefined : 'menu'}
            aria-expanded={single ? undefined : !!chooser.opener}
            aria-busy={pending}
            disabled={pending}
            data-agent-call-button=""
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              if (single) {
                start(single);
                return;
              }
              chooser.open(event.currentTarget);
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
        anchor={chooser.anchor}
        position="Bottom"
        align="End"
        offset={4}
        content={
          <FocusTrap focusTrapOptions={chooser.trap}>
            <AgentChooser candidates={candidates} onChoose={start} />
          </FocusTrap>
        }
      />
    </>
  );
}
