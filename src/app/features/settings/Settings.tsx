import React, { useCallback, useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  config,
} from 'folds';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { PageNav, PageNavContent, PageNavHeader, PageRoot } from '../../components/page';
import { UserAvatar } from '../../components/user-avatar';
import { LogoutDialog } from '../../components/LogoutDialog';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import { getMxIdLocalPart } from '../../utils/matrix';
import { useShowLocalMindroom } from '../../mindroom/local-mindroom/useShowLocalMindroom';
import { renderMindroomSettingsPage } from '../../mindroom/settings/settingsExtensions';
import { getSettingsMenuItems, resolveSettingsInitialPage } from './settingsMenu';
import { SettingsPages, type SettingsPage } from './settingsPages';
import { General } from './general';
import { Account } from './account';
import { Notifications } from './notifications';
import { Devices } from './devices';
import { EmojisStickers } from './emojis-stickers';
import { DeveloperTools } from './developer-tools';
import { About } from './about';

type SettingsProps = {
  initialPage?: SettingsPage;
  requestClose: () => void;
};

function SettingsPageContent({
  page,
  requestClose,
  showLocalMindroom,
}: {
  page: SettingsPage;
  requestClose: () => void;
  showLocalMindroom: boolean;
}) {
  switch (page) {
    case SettingsPages.GeneralPage:
      return <General requestClose={requestClose} />;
    case SettingsPages.AccountPage:
      return <Account requestClose={requestClose} />;
    case SettingsPages.NotificationPage:
      return <Notifications requestClose={requestClose} />;
    case SettingsPages.DevicesPage:
      return <Devices requestClose={requestClose} />;
    case SettingsPages.EmojisStickersPage:
      return <EmojisStickers requestClose={requestClose} />;
    case SettingsPages.DeveloperToolsPage:
      return <DeveloperTools requestClose={requestClose} />;
    case SettingsPages.AboutPage:
      return <About requestClose={requestClose} />;
    default:
      // MindRoom pages (archived rooms, Local MindRoom) close the dialog when they open a room.
      return <>{renderMindroomSettingsPage(page, showLocalMindroom, requestClose, requestClose)}</>;
  }
}

/** The settings dialog: account header and page menu beside the selected page. */





  const showLocalMindroom = useShowLocalMindroom();








    resolveSettingsInitialPage(initialPage, screenSize, showLocalMindroom)
  );
  const [logoutOpen, setLogoutOpen] = useState(false);

  const menuItems = useMemo(
    () => getSettingsMenuItems(showLocalMindroom, t),
    [showLocalMindroom, t]
  );
  const isMobile = screenSize === ScreenSize.Mobile;

  const handlePageRequestClose = useCallback(() => {
    if (isMobile) {
      setActivePage(undefined);
      return;
    }
    requestClose();
  }, [isMobile, requestClose]);

  const showNav = !isMobile || activePage === undefined;

  return (
    <PageRoot
      nav={
        showNav && (
          <PageNav size="300">
            <PageNavHeader outlined={false}>
              <Box grow="Yes" gap="200" alignItems="Center">
                <Avatar size="200" radii="300">
                  <UserAvatar



                    renderFallback={() => <Text size="H6">{displayName.slice(0, 1)}</Text>}
                  />
                </Avatar>
                <Text size="H4" truncate>
                  {t('settings.title')}
                </Text>
              </Box>
              {isMobile && (
                <IconButton
                  onClick={requestClose}
                  variant="Background"
                  aria-label={t('featureUi.settings.emojisStickers.globalPacks.close')}































                <Button
                  size="300"
                  radii="300"
                  variant="Critical"
                  fill="None"
                  onClick={() => setLogoutOpen(true)}
                  before={<Icon size="100" src={Icons.Power} />}
                >
                  <Text size="B400">{t('settings.logout')}</Text>
                </Button>
                {logoutOpen && (
                  <Overlay open backdrop={<OverlayBackdrop />}>
                    <OverlayCenter>
                      <FocusTrap
                        focusTrapOptions={{
                          initialFocus: false,
                          onDeactivate: () => setLogoutOpen(false),
                          clickOutsideDeactivates: true,
                        }}
                      >
                        <LogoutDialog handleClose={() => setLogoutOpen(false)} />
                      </FocusTrap>
                    </OverlayCenter>
                  </Overlay>
                )}
              </Box>
            </Box>
          </PageNav>
        )
      }
    >
      {activePage !== undefined && (
        <SettingsPageContent
          page={activePage}
          requestClose={handlePageRequestClose}
          showLocalMindroom={showLocalMindroom}
        />
      )}
    </PageRoot>
  );
}
