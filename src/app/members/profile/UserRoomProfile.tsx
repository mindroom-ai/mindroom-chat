import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Avatar, Box, Button, Icon, Icons, Spinner, Text, color } from 'folds';
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
import { MutualRoomsChip } from './MutualRoomsChip';
import { PowerChip } from './PowerChip';
import { moderationAbilities } from './profileModeration';
import { ServerChip, ShareChip } from './UserChips';
import { UserModeration } from './UserModeration';
import * as css from './UserRoomProfile.css';

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
 * Who a person is in a room: their avatar, name and user ID, an agent's role, their power tag (a menu for those
 * who may change it), the rooms shared with them, their server, a share menu for the ID, a
 * button to message them directly, moderation, and blocking. The person need not be a member:
 * the card falls back to their server profile.
 */
export function UserRoomProfile({
  room,
  userId,
  onDone,
}: {
  room: Room;
  userId: string;
  /** The card has done its job, such as opening the direct room. */
  onDone(): void;
}) {
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
  const profile = useUserProfile(userId);
  const role = useAgentRoles(room).get(userId);
  // The card follows the person's membership, so a kick or ban from it shows at once.
  useStateEvent(room, StateEvent.RoomMember, userId);

  const me = client.getSafeUserId();
  const isMe = userId === me;
  const member = room.getMember(userId);
  const user = client.getUser(userId);
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
    navigate(withSearchParam(getDirectCreatePath(), { userId }));
  };

  const managePowers = () => {
    onDone();
    openRoomSettings(room.roomId, undefined, RoomSettingsPage.PermissionsPage);
  };

  return (
    <Box className={css.ProfileCard} direction="Column" gap="400">
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
          <Text as="h2" size="H5" className={css.ProfileName}>
            {name}
          </Text>
          <Text size="T200" priority="300" className={css.ProfileUserId}>
            {/* A Matrix ID reads left to right, with its @ at the start, in any language. */}
            <bdi>{userId}</bdi>
          </Text>
        </Box>
      </Box>
      {role && (
        <Text size="T300" className={css.ProfileRole} {...ownDirectionBlock}>
          {role}
        </Text>
      )}
      <Box gap="200" wrap="Wrap">
        {tag && (
          <PowerChip
            room={room}
            userId={userId}
            tag={tag}
            mine={mine}
            editable={abilities.changePower && member?.membership === 'join'}
            onManagePowers={
              may.stateEvent(StateEvent.RoomPowerLevels, me) ? managePowers : undefined
            }
          />
        )}
        <ShareChip userId={userId} />
        {server && <ServerChip server={server} />}
        {!isMe && <MutualRoomsChip userId={userId} onOpen={onDone} />}
      </Box>
      {!isMe && (
        <Button
          size="300"
          radii="300"
          variant="Primary"
          before={<Icon size="100" src={Icons.Message} />}
          onClick={openDirectRoom}
        >
          <Text size="B300">{t('sharedUi.userRoomProfile.message')}</Text>
        </Button>
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
      {!isMe && <UserModeration room={room} userId={userId} abilities={abilities} />}
      {!isMe && <BlockControl userId={userId} />}
    </Box>
  );
}
