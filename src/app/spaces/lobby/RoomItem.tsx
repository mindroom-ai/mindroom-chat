import React, { useRef } from 'react';
import { Avatar, Badge, Box, Button, Icon, Icons, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { SequenceCard } from '../../ui/SequenceCard';
import { ownDirectionLine } from '../../ui/directional';
import { RoomAvatar, RoomIcon } from '../../avatars/RoomAvatar';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import type { HierarchyItem } from '../useSpaceHierarchy';
import { getRoomAvatarUrl } from '../../matrix/room';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { Membership } from '../../matrix/types/room';
import { resolveLobbyItemAccess } from './access';
import { LobbyAccessButton } from './LobbyAccessButton';
import { useDraggableItem } from './DnD';
import * as css from './RoomItem.css';
import * as styleCss from './style.css';

/** What the lobby knows about the room: its fetched summary, or why there is none. */
type RoomSummaryState = {
  /** The summary is still being fetched; the card shows placeholders. */
  loading: boolean;
  /** Why the summary could not be fetched, if it could not. */
  error: Error | null;
  /** The hierarchy entry; a join rule the client does not know arrives as a plain string. */
  summary: (Omit<IHierarchyRoom, 'join_rule'> & { join_rule?: string }) | undefined;
  /** The client's copy of a room, for rooms the summary does not describe yet. */
  getRoom: (roomId: string) => Room | undefined;
};

/** Reordering the card among its siblings by drag and drop. */
type RoomItemDragProps = {
  onDragging: (item?: HierarchyItem) => void;
  canReorder: boolean;
};

type RoomItemCardProps = RoomSummaryState &
  RoomItemDragProps & {
    item: HierarchyItem;
    onOpen: (roomId: string) => void;
    /** Extra controls after the open or join button. */
    options?: React.ReactNode;
  };

/** A room in a space's lobby: open it when joined, otherwise join or ask to join. */
export function RoomItemCard({
  item,
  loading,
  error,
  summary,
  onOpen,
  onDragging,
  canReorder,
  getRoom,
  options,
}: RoomItemCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const authenticated = useMediaAuthentication();
  const client = useMatrixClient();
  const { t } = useTranslation();
  useDraggableItem(item, cardRef, canReorder ? onDragging : undefined);

  const { roomId } = item;
  const localRoom = getRoom(roomId) ?? client.getRoom(roomId) ?? undefined;
  const membership = localRoom?.getMyMembership();
  const joined = membership === Membership.Join;

  const roomName = summary?.name || summary?.canonical_alias || localRoom?.name || roomId;
  const topic = summary?.topic;
  const avatarSrc = summary?.avatar_url
    ? mxcUrlToHttp(client, summary.avatar_url, authenticated, 96, 96, 'crop') ?? undefined
    : localRoom
    ? getRoomAvatarUrl(client, localRoom, 96, authenticated)
    : undefined;
  const access = resolveLobbyItemAccess(summary?.join_rule, !!summary, membership);

  return (
    <SequenceCard
      ref={cardRef}
      className={css.RoomItemCard}
      variant="SurfaceVariant"
      alignItems="Center"
      gap="300"
    >
      <Avatar size="400" radii="400">
        {loading ? (
          <div className={styleCss.AvatarPlaceholder} />
        ) : (
          <RoomAvatar
            roomId={roomId}
            src={avatarSrc}
            alt={roomName}
            renderFallback={() => (
              <RoomIcon size="300" joinRule={summary?.join_rule ?? localRoom?.getJoinRule()} />
            )}
          />
        )}
      </Avatar>
      <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
        {loading ? (
          <div className={styleCss.LinePlaceholder} />
        ) : (
          <Box className={css.ErrorNameContainer} alignItems="Center" gap="100">
            <Text className={css.RoomName} size="T400" {...ownDirectionLine}>
              {roomName}
            </Text>
            {error && !summary && (
              <Icon size="50" src={Icons.Warning} style={{ color: color.Warning.Main }} />
            )}
          </Box>
        )}
        {topic && (
          <Text
            className={css.RoomProfileTopic}
            size="T200"
            priority="300"
            truncate
            {...ownDirectionLine}
          >
            {topic}
          </Text>
        )}
        <Box alignItems="Center" gap="200" wrap="Wrap">
          {summary?.num_joined_members !== undefined && (
            <Text size="T200" priority="300" style={{ whiteSpace: 'nowrap' }}>
              {t('featureUi.lobby.roomItem.memberCount', {
                count: summary.num_joined_members,
                formattedCount: summary.num_joined_members.toLocaleString(),
              })}
            </Text>
          )}
          {item.content.suggested === true && (
            <Badge variant="Success" fill="Soft" radii="Pill" outlined>
              <Text size="L400">{t('featureUi.lobby.roomItem.suggested')}</Text>
            </Badge>
          )}
        </Box>
      </Box>
      {!loading && (
        <Box shrink="No" gap="200" alignItems="Center">
          {joined ? (
            <Button
              variant="Secondary"
              fill="Soft"
              radii="300"
              size="300"
              onClick={() => onOpen(roomId)}
              // Names the room this button opens.
              data-room-id={roomId}
            >
              <Text size="B300">{t('featureUi.lobby.roomItem.openRoom')}</Text>
            </Button>
          ) : (
            <LobbyAccessButton
              roomId={roomId}
              roomName={roomName}
              access={access}
              membership={membership}
              viaServers={item.content.via}
            />
          )}
          {options}
        </Box>
      )}
    </SequenceCard>
  );
}
