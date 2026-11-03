import React, { MouseEventHandler, useMemo, useRef, useState } from 'react';
import { Avatar, Box, Icon, IconButton, Icons, PopOut, Text, config, toRem } from 'folds';
import { Menu } from '../../../components/glass/GlassPrimitives';
import type { IconSrc, RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { MatrixClient } from 'matrix-js-sdk';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import {
  NavButton,
  NavCategory,
  NavCategoryHeader,
  NavEmptyLayout,
  NavItem,
  NavItemContent,
} from '../../../components/nav';
import { VirtualTile } from '../../../components/virtualizer';
import { JoinAddressPrompt } from '../../../components/join-address-prompt';
import { RoomNavCategoryButton, RoomNavItem } from '../../../features/room-nav';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import {
  useHomeCreateSelected,
  useHomeSearchSelected,
} from '../../../hooks/router/useHomeSelected';
import { useCategoryHandler } from '../../../hooks/useCategoryHandler';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { makeNavCategoryId } from '../../../state/closedNavCategories';
import { useClosedNavCategoriesAtom } from '../../../state/hooks/closedNavCategories';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { stopPropagation } from '../../../utils/keyboard';
import { useVisibleRooms } from '../../../mindroom/rooms/archivedRooms';
import { ThreadNavCategory } from '../../../mindroom/recent-threads/ThreadNavCategory';
import { RecentlyOpenedNavCategory } from '../../../mindroom/recent-threads/RecentlyOpenedNavCategory';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import {
  getHomeCreatePath,
  getHomeRoomPath,
  getHomeSearchPath,
  withSearchParam,
} from '../../pathUtils';
import { useHomeRooms } from './useHomeRooms';

const ROOM_ROW_HEIGHT = 38;

const lastActivity = (mx: MatrixClient, roomId: string): number =>
  mx.getRoom(roomId)?.getLastActiveTimestamp?.() ?? 0;

/** Rooms by latest activity. */
const sortRooms = (mx: MatrixClient, roomIds: string[]): string[] =>
  [...roomIds].sort((a, b) => lastActivity(mx, b) - lastActivity(mx, a));

/** The header's options button, whose menu marks every listed room read. */
function MarkRoomsReadMenu({ label, roomIds }: { label: string; roomIds: string[] }) {
  const [anchor, setAnchor] = useState<RectCords>();
  const closeMenu = () => setAnchor(undefined);
  const openMenu: MouseEventHandler<HTMLButtonElement> = (event) => {
    setAnchor(event.currentTarget.getBoundingClientRect());
  };

  const menu = (
    <FocusTrap
      focusTrapOptions={{
        clickOutsideDeactivates: true,
        escapeDeactivates: stopPropagation,
        initialFocus: false,
        onDeactivate: closeMenu,
        returnFocusOnDeactivate: false,
      }}
    >
      <Menu style={{ width: '100vw', maxWidth: toRem(160) }}>
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          <MindroomMarkRoomsReadMenuItem roomIds={roomIds} onClose={closeMenu} />
        </Box>
      </Menu>
    </FocusTrap>
  );

  return (
    <>
      <IconButton variant="Background" aria-label={label} onClick={openMenu}>
        <Icon size="200" src={Icons.VerticalDots} />
      </IconButton>
      <PopOut anchor={anchor} align="End" position="Bottom" offset={6} content={menu} />
    </>
  );
}

function HomeHeader({ roomIds }: { roomIds: string[] }) {
  const { t } = useTranslation();
  const title = t('nav.home');

  return (
    <PageNavHeader>
      <Box gap="300" grow="Yes" alignItems="Center">
        <Box grow="Yes">
          <Text truncate size="H4">
            {title}
          </Text>
        </Box>
        <MarkRoomsReadMenu
          label={t('featureUi.roomNav.roomNavItem.moreOptions')}
          roomIds={roomIds}
        />
      </Box>
    </PageNavHeader>
  );
}

type RoomActionProps = {
  /** Value of `data-home-room-action`, which tests and styles select on. */
  action: 'create' | 'join' | 'search';
  icon: IconSrc;
  label: string;
  selected?: boolean;
  onSelect: () => void;
};

/** One of the shortcuts above the room list. */
function RoomAction({ action, icon, label, selected, onSelect }: RoomActionProps) {
  return (
    <NavItem aria-selected={selected} radii="400" variant="Background">
      <NavButton data-home-room-action={action} onClick={onSelect}>
        <NavItemContent>
          <Box as="span" alignItems="Center" gap="200" grow="Yes">
            <Avatar radii="400" size="200">
              <Icon size="100" src={icon} />
            </Avatar>
            <Text as="span" size="Inherit" truncate>
              {label}
            </Text>
          </Box>
        </NavItemContent>
      </NavButton>
    </NavItem>
  );
}

/** The Home navigation: room actions, the rooms outside spaces, threads, and recently opened. */






  const homeRooms = useVisibleRooms(useHomeRooms());
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const selectedRoomId = useSelectedRoom();
  const createSelected = useHomeCreateSelected();
  const searchSelected = useHomeSearchSelected();
  const [joinOpen, setJoinOpen] = useState(false);

  const roomsCategoryId = makeNavCategoryId('home', 'room');
  const closedCategoriesAtom = useClosedNavCategoriesAtom();
  const [closedCategories, setClosedCategories] = useAtom(closedCategoriesAtom);
  const roomsClosed = closedCategories.has(roomsCategoryId);





    const items = sortRooms(mx, homeRooms);
    if (!roomsClosed) return items;
    // A collapsed category still shows the selected room.
    return items.filter((roomId) => roomId === selectedRoomId);






    overscan: 10,
  });

  const handleJoinOpen = (roomIdOrAlias: string, viaServers?: string[], eventId?: string) => {
    setJoinOpen(false);
    navigate(
      withSearchParam(getHomeRoomPath(roomIdOrAlias, eventId), {
        viaServers: viaServers && viaServers.length > 0 ? viaServers.join(',') : undefined,
      })
    );
  };

  const roomActions = (
    <NavCategory>
      <RoomAction
        action="create"
        icon={Icons.Plus}
        label={t('nav.createRoom')}
        selected={createSelected}
        onSelect={() => navigate(getHomeCreatePath())}
      />
      <RoomAction
        action="join"
        icon={Icons.Link}
        label={t('nav.joinWithAddress')}
        onSelect={() => setJoinOpen(true)}
      />
      <RoomAction
        action="search"
        icon={Icons.Search}
        label={t('nav.messageSearch')}
        selected={searchSelected}
        onSelect={() => navigate(getHomeSearchPath())}
      />
    </NavCategory>
  );

  return (
    <PageNav>
      <HomeHeader roomIds={homeRooms} />
      {joinOpen && (
        <JoinAddressPrompt onOpen={handleJoinOpen} onCancel={() => setJoinOpen(false)} />
      )}
      {homeRooms.length === 0 ? (
        <NavEmptyLayout
          icon={<Icon size="600" src={Icons.Hash} />}
          title={
            <Text size="H5" align="Center">
              {t('nav.noRooms')}
            </Text>
          }
          content={
            <Text size="T300" align="Center">
              {t('nav.noRoomsDescription')}
            </Text>
          }
          options={roomActions}
        />
      ) : (
        <PageNavContent scrollRef={scrollRef}>
          <Box direction="Column" gap="300">
            {roomActions}
            <NavCategory>
              <NavCategoryHeader>
                <RoomNavCategoryButton
                  closed={roomsClosed}
                  data-category-id={roomsCategoryId}
                  onClick={handleCategoryClick}
                >
                  {t('nav.rooms')}
                </RoomNavCategoryButton>
              </NavCategoryHeader>
              <div style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((item) => {
                  const roomId = sortedRooms[item.index];
                  const room = mx.getRoom(roomId);
                  if (!room) return null;
                  return (
                    <VirtualTile
                      key={item.index}















          </Box>
        </PageNavContent>
      )}
      <RecentlyOpenedNavCategory />
    </PageNav>
  );
}
