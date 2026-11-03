import React, { useRef } from 'react';
import { Avatar, Box, Button, Icon, Icons, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { SequenceCard } from '../../components/sequence-card';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import type { HierarchyItem } from '../../hooks/useSpaceHierarchy';
import { getRoomAvatarUrl } from '../../utils/room';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import { Membership } from '../../../types/matrix/room';
import { resolveLobbyItemAccess } from './access';
import { LobbyAccessButton } from './LobbyAccessButton';
import { useDraggableItem } from './DnD';
import * as css from './RoomItem.css';
import * as styleCss from './style.css';





  /** The hierarchy entry; a join rule the client does not know arrives as a plain string. */
  summary: (Omit<IHierarchyRoom, 'join_rule'> & { join_rule?: string }) | undefined;





  options?: React.ReactNode;
};

/** A room in a space's lobby: open it when joined, otherwise join or ask to join. */
export function RoomItemCard({
  item,







  options,
}: RoomItemCardProps) {




  useDraggableItem(item, targetRef, canReorder ? onDragging : undefined);

  const { roomId } = item;
  const localRoom = getRoom(roomId) ?? mx.getRoom(roomId) ?? undefined;
  const membership = localRoom?.getMyMembership();
  const joined = membership === Membership.Join;

  const name = summary?.name || summary?.canonical_alias || localRoom?.name || roomId;
  const topic = summary?.topic;
  const avatarUrl = summary?.avatar_url
    ? mxcUrlToHttp(mx, summary.avatar_url, useAuthentication, 96, 96, 'crop') ?? undefined
    : localRoom
    ? getRoomAvatarUrl(mx, localRoom, 96, useAuthentication)
    : undefined;
  const access = resolveLobbyItemAccess(summary?.join_rule, !!summary, membership);

  return (
    <SequenceCard















          />
        )}
      </Avatar>
      <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
        {loading ? (
          <div className={styleCss.LinePlaceholder} />
        ) : (
          <Box className={css.ErrorNameContainer} alignItems="Center" gap="100">
            <Text size="T400" truncate>
              {name}
            </Text>
            {error && !summary && (
              <Icon size="50" src={Icons.Warning} style={{ color: color.Warning.Main }} />
            )}
          </Box>
        )}
        {topic && (
          <Text className={css.RoomProfileTopic} size="T200" priority="300" truncate>
            {topic}
          </Text>
        )}
        {summary?.num_joined_members !== undefined && (
          <Text size="T200" priority="300">
            {t('featureUi.lobby.members', { count: summary.num_joined_members })}
          </Text>
        )}
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
            >
              <Text size="B300">{t('featureUi.lobby.open')}</Text>
            </Button>
          ) : (
            <LobbyAccessButton
              roomId={roomId}
              roomName={name}
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
