import React, { MouseEventHandler, forwardRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Text,
  config,
  toRem,
} from 'folds';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import {
  NavButton,
  NavCategory,
  NavEmptyCenter,
  NavEmptyLayout,
  NavItem,
  NavItemContent,
  NavLink,
} from '../../../components/nav';
import {
  encodeSearchParamValueArray,
  getExplorePath,
  getCreatePath,
  getHomeCreatePath,
  getHomeRoomPath,
  getHomeSearchPath,
  withSearchParam,
} from '../../pathUtils';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import {
  useHomeCreateSelected,
  useHomeSearchSelected,
} from '../../../hooks/router/useHomeSelected';
import { useHomeNavigationRooms } from './useHomeRooms';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { PageNav, PageNavHeader, PageNavContent } from '../../../components/page';
import { stopPropagation } from '../../../utils/keyboard';
import { useRoomsNotificationPreferencesContext } from '../../../hooks/useRoomsNotificationPreferences';
import { UseStateProvider } from '../../../components/UseStateProvider';
import { JoinAddressPrompt } from '../../../components/join-address-prompt';
import { _RoomSearchParams } from '../../paths';
import { RecentThreadsPageNav } from '../../../mindroom/recent-threads/RecentThreadsPanel';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import { useSimpleMode } from '../../../mindroom/settings/useMindroomAccountSettings';
import { RoomFolderNav } from '../../../mindroom/room-folders/RoomFolderNav';
import { useRoomFolders } from '../../../mindroom/room-folders/RoomFoldersProvider';
import { RoomFolderPrompt } from '../../../mindroom/room-folders/RoomFolderPrompt';

type HomeMenuProps = {
  requestClose: () => void;
};
const HomeMenu = forwardRef<HTMLDivElement, HomeMenuProps>(({ requestClose }, ref) => {
  const { roomIds } = useHomeNavigationRooms();

  return (
    <Menu ref={ref} style={{ maxWidth: toRem(160), width: '100vw' }}>
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        <MindroomMarkRoomsReadMenuItem roomIds={roomIds} onClose={requestClose} />
      </Box>
    </Menu>
  );
});

type HomeCreateMenuProps = {
  requestClose: () => void;
  onCreateFolder: () => void;
};
const HomeCreateMenu = forwardRef<HTMLDivElement, HomeCreateMenuProps>(
  ({ requestClose, onCreateFolder }, ref) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const open = (path: string) => {
      requestClose();
      navigate(path);
    };

    return (
      <Menu ref={ref} style={{ maxWidth: toRem(180), width: '100vw' }}>
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          <MenuItem size="300" radii="300" onClick={() => open(getHomeCreatePath())}>
            <Icon size="100" src={Icons.Hash} />
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {t('nav.createRoom')}
            </Text>
          </MenuItem>
          <MenuItem
            size="300"
            radii="300"
            onClick={() => {
              requestClose();
              onCreateFolder();
            }}
          >
            <Icon size="100" src={Icons.Category} />
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {t('nav.createRoomFolder')}
            </Text>
          </MenuItem>
          <MenuItem size="300" radii="300" onClick={() => open(getCreatePath())}>
            <Icon size="100" src={Icons.Space} />
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {t('nav.createSpace')}
            </Text>
          </MenuItem>
        </Box>
      </Menu>
    );
  }
);

function HomeHeader({ onCreateFolder }: { onCreateFolder: () => void }) {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [createMenuAnchor, setCreateMenuAnchor] = useState<RectCords>();

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  return (
    <>
      <PageNavHeader>
        <Box alignItems="Center" grow="Yes" gap="300">
          <Box grow="Yes">
            <Text size="H4" truncate>
              {t('nav.home')}
            </Text>
          </Box>
          <Box>
            <IconButton
              aria-label={t('nav.create')}
              aria-pressed={!!createMenuAnchor}
              variant="Background"
              onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                const anchor = event.currentTarget.getBoundingClientRect();
                setCreateMenuAnchor((currentAnchor) => (currentAnchor ? undefined : anchor));
              }}
            >
              <Icon src={Icons.Plus} size="200" />
            </IconButton>
            <IconButton
              aria-label={t('nav.homeOptions')}
              aria-pressed={!!menuAnchor}
              variant="Background"
              onClick={handleOpenMenu}
            >
              <Icon src={Icons.VerticalDots} size="200" />
            </IconButton>
          </Box>
        </Box>
      </PageNavHeader>
      <PopOut
        anchor={createMenuAnchor}
        position="Bottom"
        align="End"
        offset={6}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => setCreateMenuAnchor(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
              isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
              escapeDeactivates: stopPropagation,
            }}
          >
            <HomeCreateMenu
              requestClose={() => setCreateMenuAnchor(undefined)}
              onCreateFolder={onCreateFolder}
            />
          </FocusTrap>
        }
      />
      <PopOut
        anchor={menuAnchor}
        position="Bottom"
        align="End"
        offset={6}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => setMenuAnchor(undefined),
              clickOutsideDeactivates: true,
              isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
              isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
              escapeDeactivates: stopPropagation,
            }}
          >
            <HomeMenu requestClose={() => setMenuAnchor(undefined)} />
          </FocusTrap>
        }
      />
    </>
  );
}

function HomeEmpty() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <NavEmptyCenter>
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
        options={
          <>
            <Button onClick={() => navigate(getHomeCreatePath())} variant="Secondary" size="300">
              <Text size="B300" truncate>
                {t('nav.createRoom')}
              </Text>
            </Button>
            <Button
              onClick={() => navigate(getExplorePath())}
              variant="Secondary"
              fill="Soft"
              size="300"
            >
              <Text size="B300" truncate>
                {t('nav.exploreCommunityRooms')}
              </Text>
            </Button>
          </>
        }
      />
    </NavEmptyCenter>
  );
}

function HomeContent() {
  const { t } = useTranslation();
  useNavToActivePathMapper('home');
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const { roomIds: rooms, spaceIds } = useHomeNavigationRooms();
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const navigate = useNavigate();

  const selectedRoomId = useSelectedRoom();
  const simpleMode = useSimpleMode();
  const createRoomSelected = useHomeCreateSelected();
  const searchSelected = useHomeSearchSelected();
  const { folders, createFolder } = useRoomFolders();
  const noRoomToDisplay = rooms.length === 0 && spaceIds.length === 0 && folders.length === 0;
  const [createFolderPrompt, setCreateFolderPrompt] = useState(false);

  return (
    <PageNav>
      <HomeHeader onCreateFolder={() => setCreateFolderPrompt(true)} />
      {createFolderPrompt && (
        <RoomFolderPrompt onSubmit={createFolder} onCancel={() => setCreateFolderPrompt(false)} />
      )}
      <RecentThreadsPageNav>
        {noRoomToDisplay ? (
          <HomeEmpty />
        ) : (
          <PageNavContent scrollRef={setScrollElement}>
            <Box direction="Column" gap="300">
              <NavCategory>
                {!simpleMode && (
                  <NavItem variant="Background" radii="400" aria-selected={createRoomSelected}>
                    <NavButton onClick={() => navigate(getHomeCreatePath())}>
                      <NavItemContent>
                        <Box as="span" grow="Yes" alignItems="Center" gap="200">
                          <Avatar size="200" radii="400">
                            <Icon src={Icons.Plus} size="100" />
                          </Avatar>
                          <Box as="span" grow="Yes">
                            <Text as="span" size="Inherit" truncate>
                              {t('nav.createRoom')}
                            </Text>
                          </Box>
                        </Box>
                      </NavItemContent>
                    </NavButton>
                  </NavItem>
                )}
                {!simpleMode && (
                  <UseStateProvider initial={false}>
                    {(open, setOpen) => (
                      <>
                        <NavItem variant="Background" radii="400">
                          <NavButton onClick={() => setOpen(true)}>
                            <NavItemContent>
                              <Box as="span" grow="Yes" alignItems="Center" gap="200">
                                <Avatar size="200" radii="400">
                                  <Icon src={Icons.Link} size="100" />
                                </Avatar>
                                <Box as="span" grow="Yes">
                                  <Text as="span" size="Inherit" truncate>
                                    {t('nav.joinWithAddress')}
                                  </Text>
                                </Box>
                              </Box>
                            </NavItemContent>
                          </NavButton>
                        </NavItem>
                        {open && (
                          <JoinAddressPrompt
                            onCancel={() => setOpen(false)}
                            onOpen={(roomIdOrAlias, viaServers, eventId) => {
                              setOpen(false);
                              const path = getHomeRoomPath(roomIdOrAlias, eventId);
                              navigate(
                                viaServers
                                  ? withSearchParam<_RoomSearchParams>(path, {
                                      viaServers: encodeSearchParamValueArray(viaServers),
                                    })
                                  : path
                              );
                            }}
                          />
                        )}
                      </>
                    )}
                  </UseStateProvider>
                )}
                <NavItem variant="Background" radii="400" aria-selected={searchSelected}>
                  <NavLink to={getHomeSearchPath()}>
                    <NavItemContent>
                      <Box as="span" grow="Yes" alignItems="Center" gap="200">
                        <Avatar size="200" radii="400">
                          <Icon src={Icons.Search} size="100" filled={searchSelected} />
                        </Avatar>
                        <Box as="span" grow="Yes">
                          <Text as="span" size="Inherit" truncate>
                            {t('nav.messageSearch')}
                          </Text>
                        </Box>
                      </Box>
                    </NavItemContent>
                  </NavLink>
                </NavItem>
              </NavCategory>
              <RoomFolderNav
                roomIds={rooms}
                spaceIds={spaceIds}
                selectedRoomId={selectedRoomId}
                notificationPreferences={notificationPreferences}
                roomToUnread={roomToUnread}
                scrollElement={scrollElement}
              />
            </Box>
          </PageNavContent>
        )}
      </RecentThreadsPageNav>
    </PageNav>
  );
}

export function Home() {
  return <HomeContent />;
}
