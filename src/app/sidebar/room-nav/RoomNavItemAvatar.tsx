import React from 'react';
import { Avatar, Text, config } from 'folds';
import { RoomType, type Room } from 'matrix-js-sdk';
import { RoomAvatar, RoomIcon } from '../../avatars/RoomAvatar';
import { nameInitials } from '../../lib/common';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRoomAvatar } from '../../matrix/hooks/useRoomMeta';
import { mxcUrlToHttp } from '../../matrix/matrix';
import { getDirectPartnerId, getRoomAvatarUrl } from '../../matrix/room';
import { GroupCountAvatar } from './DirectRoomRowExtras';
import * as css from './RoomNavItem.css';

const AVATAR_SIZE = 96;

export type RoomNavItemAvatarProps = {
  room: Room;
  name: string;
  /** Show a person (direct message partner) with initials, instead of the room privacy icon. */
  personAvatar: boolean;
  groupMemberCount?: number;
  groupCountDescriptionId: string;
  fallbackAvatarMxc?: string;
  avatarBadge?: React.ReactNode;
  selected: boolean;
  /** Read rooms show their privacy icon as faint as their name. */
  quiet: boolean;
  /** The row sits under a room: its hash is framed. */
  nested: boolean;
};

/** Leading avatar or privacy icon for a sidebar room row, with group-DM count and corner badge support. */
export function RoomNavItemAvatar({
  room,
  name,
  personAvatar,
  groupMemberCount,
  groupCountDescriptionId,
  fallbackAvatarMxc,
  avatarBadge,
  selected,
  quiet,
  nested,
}: RoomNavItemAvatarProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const avatarMxc = useRoomAvatar(room, personAvatar);
  const isSpace = room.getType() === RoomType.Space;

  const wrap = (avatar: React.ReactNode) =>
    avatarBadge ? (
      <span className={css.AvatarSlot}>
        {avatar}
        {avatarBadge}
      </span>
    ) : (
      avatar
    );

  if (groupMemberCount !== undefined) {
    return wrap(
      <GroupCountAvatar count={groupMemberCount} descriptionId={groupCountDescriptionId} />
    );
  }

  const resolvedAvatarMxc = avatarMxc ?? (personAvatar ? fallbackAvatarMxc : undefined);
  let src = resolvedAvatarMxc
    ? (mxcUrlToHttp(mx, resolvedAvatarMxc, useAuthentication, AVATAR_SIZE, AVATAR_SIZE, 'crop') ??
      undefined)
    : undefined;
  // A partner without an avatar shows the room's own, which is only looked up then.
  if (!src && personAvatar) src = getRoomAvatarUrl(mx, room, AVATAR_SIZE, useAuthentication);

  const renderFallback = () => {
    if (personAvatar) {
      return (
        <Text as="span" size="H6">
          {nameInitials(name)}
        </Text>
      );
    }
    const joinRule = room.getJoinRule();
    return (
      <RoomIcon size="100" filled={selected} joinRule={joinRule} space={isSpace} subRoom={nested} />
    );
  };

  // A room without a picture shows the bare privacy icon, with no tinted tile behind it.
  if (!src && !personAvatar) {
    return wrap(
      <Avatar size="200" radii="400" style={quiet ? { opacity: config.opacity.P300 } : undefined}>
        {renderFallback()}
      </Avatar>
    );
  }

  // A room picture that fails falls back to the same bare icon as a room without one.
  const failedTone = personAvatar ? undefined : 'plain';
  return wrap(
    <Avatar size="200" radii="400">
      <RoomAvatar
        fallbackTone={failedTone}
        fallbackId={personAvatar ? getDirectPartnerId(room) : undefined}
        renderFallback={renderFallback}
        alt={name}
        src={src}
        roomId={room.roomId}
      />
    </Avatar>
  );
}
