import { useEffect, useMemo, useRef, useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { FocusTrap } from 'focus-trap-react';
import { Avatar, Box, config, Icon, Icons, Text, type RectCords } from 'folds';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Room } from 'matrix-js-sdk';
import { RoomAvatar } from '../../avatars/RoomAvatar';
import { nameInitials } from '../../lib/common';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { stopPropagation } from '../../lib/keyboard';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { getCanonicalAliasOrRoomId } from '../../matrix/matrix';
import { getRoomAvatarUrl } from '../../matrix/room';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import { getSpaceLobbyPath, getSpacePath, getSpaceThreadsPath } from '../../routes/pathUtils';
import * as overviewCss from '../../threads/overview/RoomThreadOverview.css';
import { ownDirectionLine, PopOut, revealDirectionControls } from '../../ui/directional';
import { Menu, MenuItem } from '../../ui/glass/GlassPrimitives';
import { PageHeader } from '../../ui/page/Page';
import { PhoneBackButton } from '../../ui/page/PhoneBackButton';
import { SpaceAvatar, SpaceHeaderIconLink, useSpaceAvatarSrc } from '../lobby/LobbyHeader';
import { useShownSidebarItems } from '../sidebarSpaces';
import { buildSwitchableSpaceItems } from './spaceThreadsModel';
import * as css from './SpaceThreads.css';

export type SpaceThreadsHeaderProps = {
  space: Room;
  activeRoomCount?: number;
  totalRoomCount?: number;
  showSpaceSwitcher?: boolean;
};

type SpaceSwitcherProps = {
  space: Room;
  spaceName: string;
  avatarSrc?: string;
};

function SpaceSwitcher({ space, spaceName, avatarSrc }: SpaceSwitcherProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const authenticated = useMediaAuthentication();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const { items: sidebarItems } = useShownSidebarItems();
  const [anchor, setAnchor] = useState<RectCords>();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocusRef = useRef(false);

  useEffect(() => {
    if (anchor || !refocusRef.current) return;
    refocusRef.current = false;
    buttonRef.current?.focus();
  }, [anchor]);

  const railSpaceIds = useMemo(
    () => sidebarItems.flatMap((item) => (typeof item === 'string' ? [item] : item.content)),
    [sidebarItems]
  );
  const switchableSpaces = useMemo(
    () => buildSwitchableSpaceItems(mx, railSpaceIds, joinedRoomIds, roomToParents),
    [joinedRoomIds, mx, railSpaceIds, roomToParents]
  );

  if (switchableSpaces.length <= 1) {
    return (
      <>
        <SpaceAvatar roomId={space.roomId} name={spaceName} src={avatarSrc} />
        <Text size="H4" truncate {...ownDirectionLine}>
          {spaceName}
        </Text>
      </>
    );
  }

  const label = t('spaceThreads.header.switchSpace');
  const open = anchor !== undefined;
  const handleSelect = (targetSpaceId: string) => {
    setAnchor(undefined);
    if (targetSpaceId !== space.roomId) {
      void navigate(getSpaceThreadsPath(getCanonicalAliasOrRoomId(mx, targetSpaceId)));
    }
  };

  return (
    <PopOut
      anchor={anchor}
      position="Bottom"
      align="Start"
      offset={4}
      content={
        open ? (
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => setAnchor(undefined),
              escapeDeactivates: (event) => {
                refocusRef.current = true;
                return stopPropagation(event);
              },
              clickOutsideDeactivates: true,
            }}
          >
            <Menu
              role="menu"
              aria-label={label}
              className={css.SpaceSwitcherMenu}
              data-space-switcher-menu="true"
            >
              <div className={css.SpaceSwitcherScroll}>
                {switchableSpaces.map((item) => {
                  const isCurrent = item.spaceId === space.roomId;
                  const indent = Math.min(item.depth, 3) * 16;
                  return (
                    <MenuItem
                      key={item.spaceId}
                      role="menuitemradio"
                      aria-checked={isCurrent}
                      size="300"
                      radii="300"
                      variant="Surface"
                      fill={isCurrent ? 'Soft' : 'None'}
                      style={
                        indent > 0
                          ? { paddingInlineStart: `calc(${config.space.S200} + ${indent}px)` }
                          : undefined
                      }
                      before={
                        <Avatar size="200" radii="300">
                          <RoomAvatar
                            roomId={item.spaceId}
                            src={getRoomAvatarUrl(mx, item.room, 64, authenticated)}
                            alt=""
                            renderFallback={() => (
                              <Text as="span" size="H6">
                                {nameInitials(item.name)}
                              </Text>
                            )}
                          />
                        </Avatar>
                      }
                      after={isCurrent ? <Icon size="50" src={Icons.Check} /> : undefined}
                      onClick={() => handleSelect(item.spaceId)}
                      data-space-switcher-option={item.spaceId}
                    >
                      <Text
                        size="T300"
                        truncate
                        style={{ flexGrow: 1, textAlign: 'start' }}
                        {...ownDirectionLine}
                      >
                        {item.name}
                      </Text>
                    </MenuItem>
                  );
                })}
              </div>
            </Menu>
          </FocusTrap>
        ) : null
      }
    >
      <button
        ref={buttonRef}
        type="button"
        className={css.SpaceSwitcherButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-space-switcher-button="true"
        onClick={(event) =>
          setAnchor(open ? undefined : event.currentTarget.getBoundingClientRect())
        }
      >
        <SpaceAvatar roomId={space.roomId} name={spaceName} src={avatarSrc} />
        <Text size="H4" truncate {...ownDirectionLine}>
          {spaceName}
        </Text>
        <IconChevronDown size={16} stroke={1.8} aria-hidden="true" style={{ flexShrink: 0 }} />
      </button>
    </PopOut>
  );
}

export function SpaceThreadsHeader({
  space,
  activeRoomCount,
  totalRoomCount,
  showSpaceSwitcher = false,
}: SpaceThreadsHeaderProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const screenSize = useScreenSizeContext();
  const navigate = useNavigate();
  const spaceName = revealDirectionControls(useRoomName(space));
  const avatarSrc = useSpaceAvatarSrc(space);
  const spaceIdOrAlias = getCanonicalAliasOrRoomId(mx, space.roomId);
  const spacePath = getSpacePath(spaceIdOrAlias);
  const overviewPath = getSpaceLobbyPath(spaceIdOrAlias);
  const openedFrom =
    spaceIdOrAlias !== space.roomId
      ? [overviewPath, getSpacePath(space.roomId), getSpaceLobbyPath(space.roomId)]
      : [overviewPath];
  const overviewLabel = t('sharedUi.space.overview');

  return (
    <PageHeader balance={screenSize === ScreenSize.Mobile}>
      <Box grow="Yes" alignItems="Center" gap="200" style={{ minInlineSize: 0 }}>
        <PhoneBackButton to={spacePath} openedFrom={openedFrom} />
        <Box grow="Yes" alignItems="Center" gap="200" style={{ minInlineSize: 0 }}>
          {showSpaceSwitcher ? (
            <SpaceSwitcher space={space} spaceName={spaceName} avatarSrc={avatarSrc} />
          ) : (
            <>
              <SpaceAvatar roomId={space.roomId} name={spaceName} src={avatarSrc} />
              <Text size="H4" truncate {...ownDirectionLine}>
                {spaceName}
              </Text>
            </>
          )}
          {totalRoomCount !== undefined && activeRoomCount !== undefined && (
            <Text as="span" size="T200" className={css.HeaderBadge} data-space-rooms-badge="true">
              {activeRoomCount === totalRoomCount
                ? t('spaceThreads.header.roomsCount', { count: totalRoomCount })
                : t('spaceThreads.header.roomsFiltered', {
                    active: activeRoomCount,
                    total: totalRoomCount,
                  })}
            </Text>
          )}
        </Box>
        {screenSize === ScreenSize.Mobile ? (
          <SpaceHeaderIconLink label={overviewLabel} icon={Icons.Category} to={overviewPath} />
        ) : (
          <button
            type="button"
            className={overviewCss.SortButton}
            onClick={() => void navigate(overviewPath)}
          >
            <Icon size="100" src={Icons.Category} aria-hidden="true" />
            <Text as="span" size="T200">
              {overviewLabel}
            </Text>
          </button>
        )}
      </Box>
    </PageHeader>
  );
}
