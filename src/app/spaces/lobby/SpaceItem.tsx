import React, { useState } from 'react';
import { Avatar, Box, Chip, Icon, Icons, Text, config, toRem } from 'folds';
import { PopOut, ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { Menu, MenuItem } from '../../ui/glass/GlassPrimitives';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { RoomAvatar } from '../../avatars/RoomAvatar';
import { LocalRoomSummaryLoader } from '../../rooms/RoomSummaryLoader';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import type { HierarchyItem } from '../useSpaceHierarchy';
import type { LocalRoomSummary } from '../../rooms/useLocalRoomSummary';
import { useOpenCreateRoomModal } from '../../navigation/useCreateRoomModal';
import { useOpenCreateSpaceModal } from '../../navigation/useCreateSpaceModal';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { nameInitials } from '../../lib/common';
import { Membership } from '../../matrix/types/room';
import { resolveLobbyItemAccess } from './access';
import { LobbyAccessButton } from './LobbyAccessButton';
import { JoinFailure } from '../../rooms/JoinFailure';
import { pressCardAction } from '../../lib/cardAction';
import { AddExistingModal } from '../AddExistingModal';
import * as css from './SpaceItem.css';
import * as styleCss from './style.css';
import { LoneTouchTarget } from '../../ui/styles/TouchTarget.css';

type SpaceItemCardProps = {
  item: HierarchyItem;
  /** Whether the user is in the space, from the joined list (the client's own state may be ahead). */
  joined: boolean;
  closed: boolean;
  /** Collapses or expands the space's rooms in the lobby, by the space's room id. */
  handleClose?: (roomId: string) => void;
  /** Offers the menu that adds a room or subspace. */
  canEditChild: boolean;
  /** The hierarchy entry; a join rule the client does not know arrives as a plain string. */
  summary: (Omit<IHierarchyRoom, 'join_rule'> & { join_rule?: string }) | undefined;
  /** The summary is still being fetched. */
  loading?: boolean;
  getRoom: (roomId: string) => Room | undefined;
  /** Extra controls at the end of the heading. */
  options?: React.ReactNode;
};

type AddChoice = { label: string; pick: () => void };

type AddChoiceChipProps = {
  label: string;
  choices: AddChoice[];
  /** Only the plus shows, for narrow headings; the label still names it. */
  compact?: boolean;
};

/** A chip that opens a short menu of ways to add something to a space. */
function AddChoiceChip({ label, choices, compact = false }: AddChoiceChipProps) {
  const [anchor, setAnchor] = useState<RectCords>();
  // Also the trap's answer to Escape and outside clicks: dismiss, and let them through.
  const dismiss = () => {
    setAnchor(undefined);
    return true;
  };
  const menu = (
    <FocusTrap
      focusTrapOptions={{
        initialFocus: false,
        returnFocusOnDeactivate: false,
        clickOutsideDeactivates: dismiss,
        escapeDeactivates: dismiss,
      }}
    >
      <Menu style={{ padding: config.space.S100, minWidth: toRem(168) }}>
        <Box direction="Column" gap="100">
          {choices.map((choice) => (
            <MenuItem
              key={choice.label}
              size="300"
              radii="300"
              onClick={() => {
                dismiss();
                choice.pick();
              }}
            >
              <Text as="span" size="T300" align="Left" style={{ flexGrow: 1 }}>
                {choice.label}
              </Text>
            </MenuItem>
          ))}
        </Box>
      </Menu>
    </FocusTrap>
  );
  return (
    <PopOut anchor={anchor} align="End" position="Bottom" offset={4} content={menu}>
      <Chip
        variant="SurfaceVariant"
        radii="Pill"
        className={LoneTouchTarget}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        aria-label={compact ? label : undefined}
        before={compact ? undefined : <Icon size="50" src={Icons.Plus} />}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
          setAnchor(anchor ? undefined : event.currentTarget.getBoundingClientRect())
        }
      >
        {compact ? <Icon size="50" src={Icons.Plus} /> : <Text size="T200">{label}</Text>}
      </Chip>
    </PopOut>
  );
}

/**
 * Ways to fill a joined space the user may edit: a new chat room or one of theirs, a new
 * subspace or one of their spaces.
 */
export function AddToSpaceChips({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const openCreateRoom = useOpenCreateRoomModal();
  const openCreateSpace = useOpenCreateSpaceModal();
  const [picking, setPicking] = useState<'rooms' | 'spaces'>();
  // Phones keep the heading's name readable: one plus holds all four ways in.
  const phone = useScreenSizeContext() === ScreenSize.Mobile;

  const roomChoices: AddChoice[] = [
    { label: t('featureUi.lobby.spaceItem.chatRoom'), pick: () => openCreateRoom(spaceId) },
    { label: t('featureUi.lobby.spaceItem.existingRoom'), pick: () => setPicking('rooms') },
  ];
  const spaceChoices: AddChoice[] = [
    { label: t('featureUi.lobby.spaceItem.newSpace'), pick: () => openCreateSpace(spaceId) },
    { label: t('featureUi.lobby.spaceItem.existingSpace'), pick: () => setPicking('spaces') },
  ];

  return (
    <Box gap="200" alignItems="Center" shrink="No">
      {phone ? (
        <AddChoiceChip
          compact
          label={t('featureUi.lobby.spaceItem.addRoom')}
          choices={[...roomChoices, ...spaceChoices]}
        />
      ) : (
        <>
          <AddChoiceChip label={t('featureUi.lobby.spaceItem.addRoom')} choices={roomChoices} />
          <AddChoiceChip label={t('featureUi.lobby.spaceItem.addSpace')} choices={spaceChoices} />
        </>
      )}
      {picking && (
        <AddExistingModal
          kind={picking}
          into={spaceId}
          requestClose={() => setPicking(undefined)}
        />
      )}
    </Box>
  );
}

/** A space heading in a lobby: its name opens or collapses it, or offers a way in. */
export function SpaceItemCard({
  item,
  summary,
  loading = false,
  joined,
  closed,
  handleClose,
  canEditChild,
  getRoom,
  options,
}: SpaceItemCardProps) {
  const authenticated = useMediaAuthentication();
  const client = useMatrixClient();
  const [joinFailure, setJoinFailure] = useState<unknown>();

  const { roomId } = item;
  const localSpace = getRoom(roomId) ?? client.getRoom(roomId) ?? undefined;
  const membership = localSpace?.getMyMembership();
  // The joined list can lag behind the client's own membership.
  const isJoined = joined || membership === Membership.Join;

  if (isJoined && localSpace) {
    return (
      <Box className={css.SpaceItemCard({ outlined: closed })} alignItems="Center" gap="200">
        <LocalRoomSummaryLoader room={localSpace}>
          {(localSummary: LocalRoomSummary) => (
            <Chip
              className={css.HeaderChip}
              variant="Background"
              radii="Pill"
              onClick={() => handleClose?.(roomId)}
              after={
                <Icon
                  size="50"
                  src={closed ? Icons.ChevronRight : Icons.ChevronBottom}
                  data-directional={closed || undefined}
                />
              }
            >
              <Text size="H4" truncate {...ownDirectionLine}>
                {revealDirectionControls(localSummary.name)}
              </Text>
            </Chip>
          )}
        </LocalRoomSummaryLoader>
        <Box grow="Yes" />
        {canEditChild && <AddToSpaceChips spaceId={roomId} />}
        {options}
      </Box>
    );
  }

  const spaceName = revealDirectionControls(summary?.name || summary?.canonical_alias || roomId);
  const avatarSrc = summary?.avatar_url
    ? mxcUrlToHttp(client, summary.avatar_url, authenticated, 96, 96, 'crop') ?? undefined
    : undefined;
  const access = resolveLobbyItemAccess(summary?.join_rule, !!summary, membership);

  // A click anywhere on the heading of a space the person is not in does what its chip does. A
  // join the server refused says why on a line of its own under the heading.
  return (
    <Box
      className={css.SpaceItemCard({ outlined: true })}
      alignItems="Center"
      gap="200"
      wrap={joinFailure !== undefined ? 'Wrap' : undefined}
      onClick={pressCardAction}
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
                src={avatarSrc}
                alt={spaceName}
                renderFallback={() => <Text size="H6">{nameInitials(spaceName)}</Text>}
              />
            </Avatar>
            <Text size="H4" truncate {...ownDirectionLine}>
              {spaceName}
            </Text>
          </Box>
          <LobbyAccessButton
            roomId={roomId}
            roomName={spaceName}
            access={access}
            membership={membership}
            viaServers={item.content.via}
            chipClassName={css.HeaderChip}
            onJoinFailure={setJoinFailure}
          />
        </>
      )}
      {options}
      {joinFailure !== undefined && (
        <JoinFailure error={joinFailure} style={{ flexBasis: '100%' }} />
      )}
    </Box>
  );
}
