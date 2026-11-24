import React, { useState } from 'react';
import { Avatar, Box, Chip, Icon, Icons, Text, toRem } from 'folds';
import { PopOut, ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { Menu } from '../../ui/glass/GlassPrimitives';
import { MenuGroup } from '../../ui/MenuEntry';
import * as scrollableMenuCss from '../../ui/ScrollableMenu.css';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { RoomAvatar } from '../../avatars/RoomAvatar';
import { LocalRoomSummaryLoader } from '../../rooms/RoomSummaryLoader';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import type { HierarchyItem } from '../useSpaceHierarchy';
import type { LocalRoomSummary } from '../../rooms/useLocalRoomSummary';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { nameInitials } from '../../lib/common';
import { Membership } from '../../matrix/types/room';
import { resolveLobbyItemAccess } from './access';
import { LobbyAccessButton } from './LobbyAccessButton';
import { JoinFailure } from '../../rooms/JoinFailure';
import { pressCardAction } from '../../lib/cardAction';
import { AddExistingModal } from '../AddExistingModal';
import { SpaceAddMenuEntries } from '../SpaceActions';
import * as css from './SpaceItem.css';
import * as styleCss from './style.css';
import { LoneTouchTarget } from '../../ui/styles/TouchTarget.css';

type SpaceItemCardProps = {
  item: HierarchyItem;
  /** Joined immediate parent sub-space for nested (depth >= 2) headings (tracks live renames). */
  parentSpace?: Room;
  /** Fallback hierarchy summary name for an unjoined nested (depth >= 2) parent sub-space. */
  parentSummaryName?: string;
  /** The hierarchy entry; a join rule the client does not know arrives as a plain string. */
  summary: (Omit<IHierarchyRoom, 'join_rule'> & { join_rule?: string }) | undefined;
  /** Whether the user is in the space, from the joined list (the client's own state may be ahead). */
  joined: boolean;
  closed: boolean;
  /** Offers the menu that adds a room or subspace. */
  canEditChild: boolean;
  /** Collapses or expands the space's rooms in the lobby, by the space's room id. */
  handleClose?: (roomId: string) => void;
  /** The summary is still being fetched. */
  loading?: boolean;
  getRoom: (roomId: string) => Room | undefined;
  /** Extra controls at the end of the heading. */
  options?: React.ReactNode;
};

/**
 * Compact `+ Add` chip (icon-only on phones) opening the shared add menu for a joined editable
 * space: new room, existing room, new sub-space, or existing sub-space.
 */
export function AddToSpaceChips({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<RectCords>();
  const [picking, setPicking] = useState<'rooms' | 'spaces'>();
  // Phones keep the heading's name readable: icon-only plus with the same accessible label.
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const label = t('featureUi.spaceNav.add');

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
      <Menu
        className={scrollableMenuCss.ScrollableMenu}
        style={{ width: '100vw', maxWidth: toRem(220) }}
      >
        <div className={scrollableMenuCss.ScrollableMenuRows}>
          <MenuGroup>
            <SpaceAddMenuEntries
              spaceId={spaceId}
              onClose={dismiss}
              onAddRooms={() => setPicking('rooms')}
              onAddSpaces={() => setPicking('spaces')}
            />
          </MenuGroup>
        </div>
      </Menu>
    </FocusTrap>
  );

  return (
    <Box alignItems="Center" shrink="No">
      <PopOut anchor={anchor} align="End" position="Bottom" offset={4} content={menu}>
        <Chip
          variant="SurfaceVariant"
          radii="Pill"
          className={LoneTouchTarget}
          aria-haspopup="menu"
          aria-expanded={!!anchor}
          aria-label={phone ? label : undefined}
          before={phone ? undefined : <Icon size="50" src={Icons.Plus} />}
          onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
            setAnchor(anchor ? undefined : event.currentTarget.getBoundingClientRect())
          }
        >
          {phone ? <Icon size="50" src={Icons.Plus} /> : <Text size="T200">{label}</Text>}
        </Chip>
      </PopOut>
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

function ParentPrefixText({ name }: { name: string }) {
  if (!name) return null;
  return (
    <Text as="span" size="T300" priority="300" truncate {...ownDirectionLine}>
      {revealDirectionControls(name)} /
    </Text>
  );
}

function JoinedParentPrefix({ parentSpace }: { parentSpace: Room }) {
  return <ParentPrefixText name={useRoomName(parentSpace)} />;
}

function ParentPrefix({
  parentSpace,
  parentSummaryName,
}: {
  parentSpace?: Room;
  parentSummaryName?: string;
}) {
  if (parentSpace) return <JoinedParentPrefix parentSpace={parentSpace} />;
  return parentSummaryName ? <ParentPrefixText name={parentSummaryName} /> : null;
}

/** A space heading in a lobby: its name opens or collapses it, or offers a way in. */
export function SpaceItemCard({
  item,
  parentSpace,
  parentSummaryName,
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
              fill="None"
              radii="300"
              onClick={() => handleClose?.(roomId)}
              before={
                <Icon
                  size="50"
                  src={closed ? Icons.ChevronRight : Icons.ChevronBottom}
                  data-directional={closed || undefined}
                />
              }
            >
              <ParentPrefix parentSpace={parentSpace} parentSummaryName={parentSummaryName} />
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
            <ParentPrefix parentSpace={parentSpace} parentSummaryName={parentSummaryName} />
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
