import React, { useRef, useState } from 'react';
import { Avatar, Box, Chip, Icon, IconButton, Icons, PopOut, Text, config, toRem } from 'folds';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { RoomAvatar } from '../../components/room-avatar';
import { LocalRoomSummaryLoader } from '../../components/RoomSummaryLoader';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import type { HierarchyItem } from '../../hooks/useSpaceHierarchy';
import type { LocalRoomSummary } from '../../hooks/useLocalRoomSummary';
import { useOpenCreateRoomModal } from '../../state/hooks/createRoomModal';
import { useOpenCreateSpaceModal } from '../../state/hooks/createSpaceModal';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import { nameInitials } from '../../utils/common';
import { Membership } from '../../../types/matrix/room';
import { resolveLobbyItemAccess } from './access';
import { LobbyAccessButton } from './LobbyAccessButton';
import { useDraggableItem } from './DnD';
import * as css from './SpaceItem.css';
import * as styleCss from './style.css';

type SpaceItemCardProps = {
  item: HierarchyItem;
  /** The hierarchy entry; a join rule the client does not know arrives as a plain string. */
  summary: (Omit<IHierarchyRoom, 'join_rule'> & { join_rule?: string }) | undefined;
  /** The summary is still being fetched. */





  closed: boolean;
  /** Collapses or expands the space's rooms in the lobby. */






  /** Extra controls at the end of the heading. */
  options?: React.ReactNode;
};

/** The plus button of a joined space: create a room or a subspace inside it. */
function AddChildMenu({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<RectCords>();
  const openCreateRoom = useOpenCreateRoomModal();
  const openCreateSpace = useOpenCreateSpaceModal();

  // Closing is also the focus trap's outside-click and Escape answer, so it lets both through.
  const close = () => {
    setAnchor(undefined);
    return true;
  };
  const choices = [
    { label: t('featureUi.lobby.spaceItem.addRoom'), create: openCreateRoom },
    { label: t('featureUi.lobby.spaceItem.newSpace'), create: openCreateSpace },
  ];

  return (
    <PopOut
      anchor={anchor}
      align="End"
      position="Bottom"
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            returnFocusOnDeactivate: false,
            clickOutsideDeactivates: close,
            escapeDeactivates: close,
          }}
        >
          <Menu style={{ padding: config.space.S100, minWidth: toRem(160) }}>
            {choices.map(({ label, create }) => (
              <MenuItem
                key={label}
                size="300"
                radii="300"
                onClick={() => {
                  close();
                  create(spaceId);
                }}
              >
                <Text size="T300">{label}</Text>
              </MenuItem>
            ))}
          </Menu>
        </FocusTrap>
      }
    >
      <IconButton
        size="300"
        radii="Pill"
        aria-label={t('featureUi.lobby.spaceItem.addRoom')}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
          setAnchor(event.currentTarget.getBoundingClientRect())
        }
      >
        <Icon size="50" src={Icons.Plus} />
      </IconButton>
    </PopOut>
  );
}

/** A space heading in a lobby: its name opens or collapses it, or offers a way in. */
export function SpaceItemCard({
  item,
  summary,
  loading = false,
  joined,
  categoryId,
  closed,
  handleClose,
  canEditChild,
  canReorder,
  onDragging,
  getRoom,
  options,
}: SpaceItemCardProps) {



  useDraggableItem(item, targetRef, canReorder ? onDragging : undefined);

  const { roomId } = item;
  const localSpace = getRoom(roomId) ?? mx.getRoom(roomId) ?? undefined;
  const membership = localSpace?.getMyMembership();
  // The joined list can lag behind the client's own membership.
  const isJoined = joined || membership === Membership.Join;

  if (isJoined && localSpace) {
    return (
      <Box
        ref={targetRef}
        className={css.SpaceItemCard({ outlined: closed })}
        alignItems="Center"
        gap="200"
      >
        <LocalRoomSummaryLoader room={localSpace}>
          {(localSummary: LocalRoomSummary) => (
            <Chip
              className={css.HeaderChip}
              variant="Background"
              radii="Pill"
              onClick={() => handleClose?.(categoryId)}
              after={<Icon size="50" src={closed ? Icons.ChevronRight : Icons.ChevronBottom} />}
            >
              <Text size="H4" truncate>
                {localSummary.name}
              </Text>
            </Chip>
          )}
        </LocalRoomSummaryLoader>
        <Box grow="Yes" />
        {canEditChild && <AddChildMenu spaceId={roomId} />}
        {options}
      </Box>
    );
  }

  const name = summary?.name || summary?.canonical_alias || roomId;
  const avatarUrl = summary?.avatar_url
    ? mxcUrlToHttp(mx, summary.avatar_url, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;
  const access = resolveLobbyItemAccess(summary?.join_rule, !!summary, membership);

  return (
    <Box
      ref={targetRef}
      className={css.SpaceItemCard({ outlined: true })}
      alignItems="Center"
      gap="200"
    >
      {loading ? (
        <div className={css.HeaderChipPlaceholder}>
          <div className={styleCss.LinePlaceholder} style={{ width: toRem(120) }} />
        </div>
      ) : (
        <>
          <Box alignItems="Center" gap="200" style={{ minWidth: 0 }}>
            <Avatar size="200" radii="300">
              <RoomAvatar
                roomId={roomId}
                src={avatarUrl}
                alt={name}
                renderFallback={() => <Text size="H6">{nameInitials(name)}</Text>}
              />
            </Avatar>
            <Text size="H4" truncate>
              {name}
            </Text>
          </Box>
          <LobbyAccessButton
            roomId={roomId}
            roomName={name}
            access={access}
            membership={membership}
            viaServers={item.content.via}
            chipClassName={css.HeaderChip}
          />
        </>
      )}
      {options}
    </Box>
  );
}
