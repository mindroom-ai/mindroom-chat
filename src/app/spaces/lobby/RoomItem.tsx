import React, { useState } from 'react';
import { Avatar, Badge, Box, Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { SequenceCard } from '../../ui/SequenceCard';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { RoomAvatar, RoomIcon } from '../../avatars/RoomAvatar';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import type { HierarchyItem } from '../useSpaceHierarchy';
import { getRoomAvatarUrl } from '../../matrix/room';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { Membership } from '../../matrix/types/room';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { pressCardAction } from '../../lib/cardAction';
import { resolveLobbyItemAccess } from './access';
import { LobbyAccessButton } from './LobbyAccessButton';
import { JoinFailure } from '../../rooms/JoinFailure';
import * as css from './RoomItem.css';
import * as styleCss from './style.css';

type RoomItemCardProps = {
  item: HierarchyItem;
  /** The hierarchy entry; a join rule the client does not know arrives as a plain string. */
  summary: (Omit<IHierarchyRoom, 'join_rule'> & { join_rule?: string }) | undefined;
  /** The summary is still being fetched; the card shows placeholders. */
  loading: boolean;
  /** The client's copy of a room, for rooms the summary does not describe yet. */
  getRoom: (roomId: string) => Room | undefined;
  onOpen: (roomId: string) => void;
  /** Extra controls after the open or join button. */
  options?: React.ReactNode;
};

/**
 * A room in a space's lobby: open it when joined, otherwise join or ask to join, by its button or
 * by a click anywhere on the card.
 */
export function RoomItemCard({
  item,
  loading,
  summary,
  onOpen,
  getRoom,
  options,
}: RoomItemCardProps) {
  const authenticated = useMediaAuthentication();
  const client = useMatrixClient();
  const { t } = useTranslation();
  const [joinFailure, setJoinFailure] = useState<unknown>();

  const { roomId } = item;
  const localRoom = getRoom(roomId) ?? client.getRoom(roomId) ?? undefined;
  const membership = localRoom?.getMyMembership();
  const joined = membership === Membership.Join;
  // On a phone a joined room's whole card opens it, through its name's button, instead of an
  // Open Room button that would take room from the name.
  const opensByCard = useScreenSizeContext() === ScreenSize.Mobile && joined;
  // A click anywhere on such a card opens the room; the card's other controls, and the pop-outs
  // they open (portals whose clicks still reach the card through React), keep their own.
  const openFromCard = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as Element;
    if (!event.currentTarget.contains(target)) return;
    const control = target.closest('button, a, input');
    if (control && !control.hasAttribute('data-card-opener')) return;
    onOpen(roomId);
  };
  // A room the person is not in: a click anywhere on its card does what its button does (join,
  // accept the invite, or ask to join), on every screen size.
  let onCardClick: ((event: React.MouseEvent<HTMLElement>) => void) | undefined;
  if (opensByCard) onCardClick = openFromCard;
  else if (!joined) onCardClick = pressCardAction;

  // Direction controls in the name and topic show as code points, so they cannot reorder them.
  const roomName = revealDirectionControls(
    summary?.name || summary?.canonical_alias || localRoom?.name || roomId
  );
  const topic = summary?.topic && revealDirectionControls(summary.topic);
  const avatarSrc = summary?.avatar_url
    ? mxcUrlToHttp(client, summary.avatar_url, authenticated, 96, 96, 'crop') ?? undefined
    : localRoom
    ? getRoomAvatarUrl(client, localRoom, 96, authenticated)
    : undefined;
  const access = resolveLobbyItemAccess(summary?.join_rule, !!summary, membership);

  return (
    <SequenceCard
      className={css.RoomItemCard}
      data-opens-by-card={opensByCard || undefined}
      onClick={onCardClick}
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
          <Box className={css.ErrorNameContainer} alignItems="Center">
            {opensByCard ? (
              <button type="button" className={css.CardOpener} data-card-opener>
                <Text as="span" className={css.RoomName} size="T400" {...ownDirectionLine}>
                  {roomName}
                </Text>
              </button>
            ) : (
              <Text className={css.RoomName} size="T400" {...ownDirectionLine}>
                {roomName}
              </Text>
            )}
          </Box>
        )}
        {!!topic && (
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
        {!joined && joinFailure !== undefined && <JoinFailure error={joinFailure} />}
      </Box>
      {!loading && (
        <Box shrink="No" gap="200" alignItems="Center">
          {joined && !opensByCard && (
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
          )}
          {!joined && (
            <LobbyAccessButton
              roomId={roomId}
              roomName={roomName}
              access={access}
              membership={membership}
              viaServers={item.content.via}
              onJoinFailure={setJoinFailure}
            />
          )}
          {options}
        </Box>
      )}
    </SequenceCard>
  );
}
