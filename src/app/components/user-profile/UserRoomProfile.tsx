import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar, Box, Button, Chip, Icon, Icons, Text } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { type MemberPowerTag, useGetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { getDirectCreatePath, withSearchParam } from '../../pages/pathUtils';
import { nameInitials } from '../../utils/common';
import { getMxIdLocalPart, getMxIdServer } from '../../utils/matrix';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import { UserAvatar } from '../user-avatar';
import { ServerChip, ShareChip } from './UserChips';
import * as css from './UserRoomProfile.css';

/** The member's power tag in the room, in the tag's color when the room gives it one. */
function PowerTagChip({ tag }: { tag: MemberPowerTag }) {
  const tint = tag.color ? { color: tag.color } : undefined;
  return (
    <Chip
      as="span"
      variant="SurfaceVariant"
      radii="Pill"
      before={<Icon size="50" src={Icons.Shield} />}
    >
      <Text size="B300" style={tint}>
        {tag.name}
      </Text>
    </Chip>
  );
}

/**
 * Who a room member is: their avatar, name and user ID, their power tag in the room, their
 * server, a share menu for the ID, and a button to message them directly.
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
  const authenticatedMedia = useMediaAuthentication();
  const getPowerTag = useGetMemberPowerTag(room, useRoomCreators(room), usePowerLevels(room));

  const member = room.getMember(userId);
  const user = client.getUser(userId);
  const name = member?.rawDisplayName || user?.displayName || getMxIdLocalPart(userId) || userId;
  const avatarMxc = member?.getMxcAvatarUrl() ?? user?.avatarUrl;
  const avatarSrc = avatarMxc
    ? mxcUrlToHttp(client, avatarMxc, authenticatedMedia, 112, 112, 'crop') ?? undefined
    : undefined;
  const server = getMxIdServer(userId);
  const tag = member ? getPowerTag(userId) : undefined;
  const isMe = userId === client.getUserId();

  const openDirectRoom = () => {
    onDone();
    navigate(withSearchParam(getDirectCreatePath(), { userId }));
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
            {userId}
          </Text>
        </Box>
      </Box>
      <Box gap="200" wrap="Wrap">
        {tag && <PowerTagChip tag={tag} />}
        <ShareChip userId={userId} />
        {server && <ServerChip server={server} />}
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
    </Box>
  );
}
