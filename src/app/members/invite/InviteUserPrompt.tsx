import { FormEvent, RefObject, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'jotai';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Button,
  Checkbox,
  Icon,
  Icons,
  Input,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  color,
  config,
  toRem,
} from 'folds';
import { RoomMemberEvent, type MatrixEvent, type Room, type RoomMember } from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';
import { Dialog, Header, IconButton } from '../../ui/glass/GlassPrimitives';
import { InviteUserAutocomplete } from './InviteUserAutocomplete';
import {
  detachedGrantErrorAtom,
  evaluateModeratorGrant,
  formatGrantFailure,
  grantRoleName,
  grantRoomModeratorRights,
  hasModeratorMindroomAgent,
} from './moderatorInvite';
import { usePowerLevelTags } from '../usePowerLevelTags';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useAlive } from '../../lib/hooks/useAlive';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import { isUserId } from '../../matrix/matrix';
import { stopPropagation } from '../../lib/keyboard';

type InviteUserPromptProps = {
  room: Room;
  requestClose: () => void;
};

type InviteFormTarget = EventTarget & {
  reasonInput?: { value: string };
};

const TITLE_ID = 'invite-user-prompt-title';

/** Title row: the heading the dialog is labelled by, and a close button at the end. */
function InvitePromptTitle({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Header
      size="500"
      style={{ paddingBlock: 0, paddingInline: `${config.space.S400} ${config.space.S200}` }}
    >
      <Text size="H4" id={TITLE_ID} style={{ flexGrow: 1 }}>
        {t('sharedUi.inviteUserPrompt.invite')}
      </Text>
      <IconButton
        aria-label={t('sharedUi.inviteUserPrompt.close')}
        onClick={onClose}
        radii="300"
        size="300"
      >
        <Icon src={Icons.Cross} />
      </IconButton>
    </Header>
  );
}

/** The user ID field takes focus first; Escape and a click outside close the dialog. */
const dialogTrapOptions = (
  firstFocus: RefObject<HTMLElement>,
  dismiss: () => void
): FocusTrap.Props['focusTrapOptions'] => ({
  initialFocus: () => firstFocus.current ?? false,
  onDeactivate: dismiss,
  escapeDeactivates: stopPropagation,
  clickOutsideDeactivates: true,
});

/**
 * Dialog to invite people to a room by user ID, with directory suggestions and a reason. It stays
 * open after each invitation, says who was invited and clears the fields for the next person.
 */
export function InviteUserPrompt({ room, requestClose }: InviteUserPromptProps) {
  const { t } = useTranslation();
  const reasonId = useId();
  const moderatorHelpId = useId();
  const store = useStore();
  const client = useMatrixClient();
  const alive = useAlive();
  const levels = usePowerLevels(room);
  const creators = useRoomCreators(room);
  const tags = usePowerLevelTags(room);
  const me = client.getSafeUserId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [userId, setUserId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string>();
  // The last person invited: the dialog stays open for the next one.
  const [invited, setInvited] = useState<string>();
  const [grantOverride, setGrantOverride] = useState<{ target: string; checked: boolean }>();
  const [rosterVersion, bumpRoster] = useForceUpdate();

  const trimmedTarget = userId.trim();
  const offer = evaluateModeratorGrant(room, trimmedTarget, me, levels, creators);
  const offerLevel = offer.kind === 'grant' ? offer.level : undefined;
  const canOffer = offerLevel !== undefined;
  const membersLoaded = room.membersLoaded();

  // Load or observe the roster only when the checkbox is offered; take one snapshot after hydration.
  useEffect(() => {
    if (!canOffer) return undefined;
    if (!membersLoaded) {
      let disposed = false;
      room
        .loadMembersIfNeeded()
        .then(() => {
          if (!disposed) bumpRoster();
        })
        .catch((err: unknown) => {
          logger.warn('[InviteUserPrompt] Failed to load room members', err);
        });
      return () => {
        disposed = true;
      };
    }
    const onMembership = (event: MatrixEvent | undefined, member?: RoomMember) => {
      if ((event?.getRoomId() ?? member?.roomId) === room.roomId) bumpRoster();
    };
    client.on(RoomMemberEvent.Membership, onMembership);
    return () => {
      client.removeListener(RoomMemberEvent.Membership, onMembership);
    };
  }, [canOffer, membersLoaded, client, room, bumpRoster]);

  const hasAgentModerator = useMemo(() => {
    void rosterVersion;
    return (
      offerLevel !== undefined &&
      membersLoaded &&
      hasModeratorMindroomAgent(room.getMembers(), me, levels, creators, offerLevel)
    );
  }, [offerLevel, membersLoaded, rosterVersion, room, me, levels, creators]);

  const defaultModerator = membersLoaded && !hasAgentModerator;
  const grantModerator =
    grantOverride?.target === trimmedTarget ? grantOverride.checked : defaultModerator;

  useEffect(() => {
    if (invited && !inviting) inputRef.current?.focus();
  }, [invited, inviting]);

  const handleInputChange = (value: string) => {
    setError(undefined);
    setInvited(undefined);
    setUserId(value);
  };

  const handleSubmit = async (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    if (inviting) return;
    const target = userId.trim();
    if (!isUserId(target)) {
      setError(t('featureUi.createChat.pleaseEnterAValidUserId'));
      return;
    }
    const form = evt.target as InviteFormTarget;
    const reason = form.reasonInput?.value.trim() || undefined;
    const grantCeiling = grantModerator ? offerLevel : undefined;

    setInviting(true);
    setError(undefined);
    setInvited(undefined);
    try {
      await client.invite(room.roomId, target, reason);
    } catch (inviteError) {
      if (!alive()) return;
      setError(
        inviteError instanceof Error && inviteError.message
          ? inviteError.message
          : String(inviteError)
      );
      setInviting(false);
      return;
    }
    if (alive()) {
      setUserId('');
      if (form.reasonInput) form.reasonInput.value = '';
      setGrantOverride(undefined);
      setInvited(target);
    }

    // Finish the submitted grant even if the user closed the dialog while invite was in flight.
    if (grantCeiling !== undefined) {
      const failure = await grantRoomModeratorRights(client, room, target, grantCeiling);
      if (failure) {
        const message = formatGrantFailure(failure, target, grantCeiling, tags, t);
        if (alive()) setError(message);
        else if (client.clientRunning !== false) store.set(detachedGrantErrorAtom, { message });
      }
    }
    if (alive()) setInviting(false);
  };

  const roleName = offerLevel !== undefined ? grantRoleName(tags, offerLevel, t) : '';

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={dialogTrapOptions(inputRef, requestClose)}>
          <Dialog
            role="dialog"
            aria-labelledby={TITLE_ID}
            style={{
              width: '100%',
              maxWidth: `min(calc(100vw - 2 * ${config.space.S400}), ${toRem(680)})`,
            }}
          >
            <Box direction="Column">
              <InvitePromptTitle onClose={requestClose} />
              <Box
                as="form"
                onSubmit={(evt: FormEvent<HTMLFormElement>) => void handleSubmit(evt)}
                direction="Column"
                gap="400"
                style={{ padding: config.space.S400, paddingTop: 0 }}
              >
                <Box direction="Column" gap="100">
                  <Text size="L400">{t('sharedUi.inviteUserPrompt.userId')}</Text>
                  <InviteUserAutocomplete
                    ref={inputRef}
                    room={room}
                    inputValue={userId}
                    onInputChange={handleInputChange}
                    onSelect={handleInputChange}
                    disabled={inviting}
                    autoFocus
                  />
                </Box>
                <Box direction="Column" gap="100">
                  <Text as="label" htmlFor={reasonId} size="L400">
                    {t('sharedUi.inviteUserPrompt.reasonOptional')}
                  </Text>
                  <Input
                    id={reasonId}
                    name="reasonInput"
                    size="500"
                    variant="Background"
                    radii="300"
                    autoComplete="off"
                    readOnly={inviting}
                  />
                </Box>
                {canOffer && (
                  <Box direction="Column" gap="100">
                    <Box
                      as="label"
                      alignItems="Center"
                      gap="200"
                      style={{ cursor: inviting ? 'default' : 'pointer' }}
                    >
                      <Checkbox
                        variant="Primary"
                        size="200"
                        checked={grantModerator}
                        disabled={inviting}
                        aria-describedby={moderatorHelpId}
                        // folds leaves onChange out of its Checkbox type; the click toggles the choice.
                        readOnly
                        onClick={() =>
                          setGrantOverride({ target: trimmedTarget, checked: !grantModerator })
                        }
                      />
                      <Text size="T300">
                        {t('sharedUi.inviteUserPrompt.giveRoleRights', { role: roleName })}
                      </Text>
                    </Box>
                    <Text id={moderatorHelpId} size="T200" priority="300">
                      {t('sharedUi.inviteUserPrompt.giveRoleRightsHelp', { role: roleName })}
                    </Text>
                  </Box>
                )}
                {error && (
                  <Text size="T300" style={{ color: color.Critical.Main }} role="alert">
                    {error}
                  </Text>
                )}
                <Text size="T300" role="status">
                  {invited && t('sharedUi.inviteUserPrompt.invited', { user: invited })}
                </Text>
                <Button
                  type="submit"
                  variant="Primary"
                  size="500"
                  disabled={inviting}
                  before={
                    inviting ? <Spinner fill="Solid" variant="Primary" size="200" /> : undefined
                  }
                >
                  <Text size="B500">{t('sharedUi.inviteUserPrompt.invite')}</Text>
                </Button>
              </Box>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
