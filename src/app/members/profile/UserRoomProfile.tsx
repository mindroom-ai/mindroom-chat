import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Avatar, Badge, Box, Button, Icon, IconButton, Icons, Spinner, Text, color } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useAlive } from '../../lib/hooks/useAlive';
import { useIgnoredUsers } from '../../matrix/hooks/useIgnoredUsers';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { readPowerLevel, usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { useGetMemberPowerTag } from '../useMemberPowerTag';
import { useUserProfile } from '../useUserProfile';
import { useAgentRoles } from '../useAgentRoles';
import { useStateEvent } from '../../matrix/hooks/useStateEvent';
import { getDirectCreatePath, withSearchParam } from '../../routes/pathUtils';
import { useOpenRoomSettings } from '../../navigation/useRoomSettingsState';
import { RoomSettingsPage } from '../../navigation/roomSettingsState';
import { settingsModalAtom } from '../../navigation/settingsModal';
import { SettingsPages } from '../../navigation/settingsPages';
import { AgentCallButton } from '../../calls/agent/AgentCallButton';
import { nameInitials } from '../../lib/common';
import { getMxIdLocalPart, getMxIdServer } from '../../matrix/matrix';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { getMemberRawDisplayName, withoutNameDisguises } from '../../matrix/room';
import { StateEvent } from '../../matrix/types/room';
import { UserAvatar } from '../../avatars/UserAvatar';
import { ownDirectionBlock } from '../../ui/directional';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { getAiRunCompactModelLabel } from '../../matrix/protocol/aiRunModelLabel';
import { AgentCapabilities, AgentProfileRead, AgentToolList, WorksIn } from './AgentTools';
import { MutualRoomsChip, useMutualRooms } from './MutualRoomsChip';
import type { AgentProfileState } from './useAgentProfile';
import { PowerChip } from './PowerChip';
import { moderationAbilities } from './profileModeration';
import { ServerChip, ShareChip } from './UserChips';
import { UserModeration } from './UserModeration';
import * as css from './UserRoomProfile.css';
import * as toolsCss from './AgentTools.css';

const CHIPS = 'sharedUi.userChips';

/**
 * Blocking (`m.ignored_user_list`): the server stops delivering the person's messages and
 * invites. A blocked person's card says so and offers to unblock them.
 */
function BlockControl({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const ignored = useIgnoredUsers();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const blocked = ignored.includes(userId);

  const toggle = () => {
    setBusy(true);
    setFailed(false);
    const next = blocked ? ignored.filter((id) => id !== userId) : [...ignored, userId];
    client
      .setIgnoredUsers(next)
      .catch(() => alive() && setFailed(true))
      .finally(() => alive() && setBusy(false));
  };

  return (
    <Box direction="Column" gap="200">
      {blocked && (
        <Box
          className={css.ProfileNoteTone.blocked}
          direction="Column"
          gap="100"
          data-blocked-user=""
        >
          <Text size="L400">{t(`${CHIPS}.blockedUser`)}</Text>
          <Text size="T200">{t(`${CHIPS}.youDoNotReceiveAnyMessagesOrInvitesFromThisUser`)}</Text>
        </Box>
      )}
      <Button
        size="300"
        radii="300"
        variant="Critical"
        fill={blocked ? 'Solid' : 'Soft'}
        disabled={busy}
        before={
          busy ? <Spinner size="50" variant="Critical" /> : <Icon size="100" src={Icons.NoEntry} />
        }
        onClick={toggle}
      >
        <Text size="B300">{t(`${CHIPS}.${blocked ? 'unblockUser' : 'blockUser'}`)}</Text>
      </Button>
      {failed && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t('sharedUi.invites.actionFailed')}
        </Text>
      )}
    </Box>
  );
}

/**
 * A card's one read of `userId`'s profile and membership, and the name it shows: as the room
 * knows them, else their profile's, else their ID's.
 */
export const useProfileName = (room: Room, userId: string) => {
  const profile = useUserProfile(userId);
  // The card follows their membership, so a kick or ban from it shows at once, in Works in too.
  const membership = useStateEvent(room, StateEvent.RoomMember, userId);
  const user = useMatrixClient().getUser(userId);
  // A member event without a name (a ban, the leave that lifts it) names the person by their ID;
  // their profile still has the name.
  // The ID shows under the name, so the name goes without it, and without what disguises it.
  const name =
    withoutNameDisguises(
      getMemberRawDisplayName(room, userId) ||
        profile.displayName ||
        (user?.displayName !== userId ? user?.displayName : undefined) ||
        ''
    ) ||
    getMxIdLocalPart(userId) ||
    userId;
  return { profile, name, membership };
};

type CardProps = {
  room: Room;
  userId: string;
  /** The card has done its job, such as opening the direct room. */
  onDone(): void;
  /** What holds the card (a sheet) shows the name already. */
  titled?: boolean;
};

/** The card, reading the person's profile itself. */
export function UserRoomProfile(props: CardProps) {
  return <ProfileCard {...props} {...useProfileName(props.room, props.userId)} />;
}

/**
 * Who a person is in a room: their avatar, name and user ID, an agent's role, their power tag (a menu for those
 * who may change it), the rooms shared with them, their server, a share menu for the ID, a
 * button to message them directly, moderation, and blocking. The person need not be a member:
 * the card falls back to their server profile. An agent's card adds its model, configured tools
 * and named rooms, and keeps the ID, chips, moderation and blocking under "More".
 */
export function ProfileCard({
  room,
  userId,
  onDone,
  titled = false,
  profile,
  name,
  membership,
}: CardProps & ReturnType<typeof useProfileName>) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const navigate = useNavigate();
  const openRoomSettings = useOpenRoomSettings();
  const openSettings = useSetAtom(settingsModalAtom);
  const authenticatedMedia = useMediaAuthentication();
  const creators = useRoomCreators(room);
  const levels = usePowerLevels(room);
  const may = useRoomPermissions(creators, levels);
  const getPowerTag = useGetMemberPowerTag(room, creators, levels);
  const roomRole = useAgentRoles(room).get(userId);
  const me = client.getSafeUserId();
  const shared = useMutualRooms(userId, membership);
  useStateEvent(room, StateEvent.RoomMember, me);
  const isMe = userId === me;
  const agent = !isMe && isMindroomAgentUserIdForViewer(userId, me);
  const [allTools, setAllTools] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const viewAll = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLDivElement>(null);
  const moreId = useId();
  // "More" opens at the card's end, which may be out of the card's view.
  useEffect(() => {
    // Newer browsers return a promise from scrolling, which no effect may return.
    void more.current?.scrollIntoView?.({ block: 'nearest' });
  }, [moreOpen]);

  const member = room.getMember(userId);
  const user = client.getUser(userId);
  const avatarMxc = member?.getMxcAvatarUrl() ?? profile.avatarUrl ?? user?.avatarUrl;
  const avatarSrc = avatarMxc
    ? mxcUrlToHttp(client, avatarMxc, authenticatedMedia, 112, 112, 'crop') ?? undefined
    : undefined;
  const server = getMxIdServer(userId);
  const tag = member ? getPowerTag(userId) : undefined;

  const levelOf = (id: string) => (creators.has(id) ? Infinity : readPowerLevel.user(levels, id));
  const mine = levelOf(me);
  const abilities = moderationAbilities({
    membership: member?.membership,
    mine,
    theirs: levelOf(userId),
    required: {
      kick: readPowerLevel.action(levels, 'kick'),
      ban: readPowerLevel.action(levels, 'ban'),
      invite: readPowerLevel.action(levels, 'invite'),
    },
    isSelf: isMe,
    canEditPowers: may.stateEvent(StateEvent.RoomPowerLevels, me),
  });

  const openDirectRoom = () => {
    onDone();
    void navigate(withSearchParam(getDirectCreatePath(), { userId }));
  };

  const managePowers = () => {
    onDone();
    openRoomSettings(room.roomId, RoomSettingsPage.PermissionsPage);
  };

  const userIdLine = (
    <Text size="T200" priority="300" className={css.ProfileUserId}>
      {/* A Matrix ID reads left to right, with its @ at the start, in any language. */}
      <bdi>{userId}</bdi>
    </Text>
  );
  const chips = (
    <Box gap="200" wrap="Wrap">
      {tag && (
        <PowerChip
          room={room}
          userId={userId}
          tag={tag}
          mine={mine}
          editable={
            abilities.changePower &&
            (member?.membership === 'join' || member?.membership === 'invite')
          }
          onManagePowers={may.stateEvent(StateEvent.RoomPowerLevels, me) ? managePowers : undefined}
        />
      )}
      <ShareChip userId={userId} />
      {server && <ServerChip server={server} />}
      {!isMe && !agent && <MutualRoomsChip shared={shared} onOpen={onDone} />}
    </Box>
  );
  const moderation = !isMe && (
    <>
      <UserModeration room={room} userId={userId} abilities={abilities} />
      <BlockControl userId={userId} />
    </>
  );

  // The agent's profile is read only for an agent's card, while it is shown.
  const card = (agentProfile: AgentProfileState) => {
    const ready = agentProfile.status === 'ready' ? agentProfile.profile : undefined;
    const role = roomRole ?? ready?.role;
    const modelLabel = ready?.model && getAiRunCompactModelLabel(ready.model);
    return (
      <Box className={agent ? toolsCss.AgentCard : css.ProfileCard} direction="Column" gap="400">
        {allTools && ready ? (
          <AgentToolList
            name={name}
            tools={ready.tools}
            onBack={() => {
              setAllTools(false);
              requestAnimationFrame(() => viewAll.current?.focus());
            }}
          />
        ) : (
          <>
            <Box alignItems="Center" gap="300">
              <Avatar className={css.ProfileAvatar} size="500" radii="Pill">
                <UserAvatar
                  alt={name}
                  userId={userId}
                  src={avatarSrc}
                  renderFallback={() => <Text size="H4">{nameInitials(name)}</Text>}
                />
              </Avatar>
              <Box direction="Column" gap="100" style={{ minWidth: 0 }}>
                <Box alignItems="Center" gap="200" wrap="Wrap">
                  {!titled && (
                    <Text as="h2" size="H5" className={css.ProfileName}>
                      {name}
                    </Text>
                  )}
                  {agent && (
                    <Badge variant="Secondary" fill="Soft" outlined radii="Pill">
                      <Text size="L400">{t('sharedUi.agentCard.agent')}</Text>
                    </Badge>
                  )}
                </Box>
                {!agent && userIdLine}
                {modelLabel && (
                  <Text size="T200" priority="300">
                    {modelLabel}
                  </Text>
                )}
              </Box>
            </Box>
            {role && (
              <Text size="T300" className={css.ProfileRole} {...ownDirectionBlock}>
                {role}
              </Text>
            )}
            {agent ? (
              <>
                <AgentCapabilities
                  state={agentProfile}
                  onViewAll={() => setAllTools(true)}
                  viewAllRef={viewAll}
                />
                <WorksIn room={room} shared={shared} onOpen={onDone} />
              </>
            ) : (
              chips
            )}
          </>
        )}
        {!isMe && (
          <Box gap="200">
            <Button
              style={{ flexGrow: 1 }}
              size="300"
              radii="300"
              variant="Primary"
              before={<Icon size="100" src={Icons.Message} />}
              onClick={openDirectRoom}
            >
              <Text size="B300">{t('sharedUi.userRoomProfile.message')}</Text>
            </Button>
            {agent && (
              <IconButton
                size="300"
                radii="300"
                variant="SurfaceVariant"
                outlined
                aria-label={t('sharedUi.agentCard.more')}
                aria-expanded={moreOpen}
                aria-controls={moreOpen ? moreId : undefined}
                onClick={() => setMoreOpen((open) => !open)}
              >
                <Icon size="100" src={Icons.HorizontalDots} />
              </IconButton>
            )}
          </Box>
        )}
        {!isMe && (
          <AgentCallButton
            roomId={room.roomId}
            userId={userId}
            displayName={name}
            presenceStatus={user?.presenceStatusMsg}
            onStarted={onDone}
          />
        )}
        {isMe && (
          <Button
            size="300"
            radii="300"
            variant="Secondary"
            fill="Soft"
            before={<Icon size="100" src={Icons.Pencil} />}
            onClick={() => {
              onDone();
              openSettings({ initialPage: SettingsPages.AccountPage });
            }}
          >
            <Text size="B300">{t('sharedUi.userRoomProfile.editProfile')}</Text>
          </Button>
        )}
        {agent
          ? moreOpen && (
              <Box ref={more} id={moreId} className={toolsCss.Section} direction="Column" gap="300">
                {userIdLine}
                {chips}
                {moderation}
              </Box>
            )
          : moderation}
      </Box>
    );
  };

  if (!agent) return card({ status: 'none' });
  return (
    <AgentProfileRead room={room} agentUserId={userId}>
      {card}
    </AgentProfileRead>
  );
}
