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
import {
  getSettingsMenuItems,
  resolveSettingsInitialPage,
  type SettingsMenuItem,
} from './settingsMenu';
import { SettingsPages, type SettingsPage } from './settingsPages';
import { About } from './about';
import { Account } from './account';
import { DeveloperTools } from './developer-tools';
import { Devices } from './devices';
import { EmojisStickers } from './emojis-stickers';
import { General } from './general';
import { Notifications } from './notifications';
import { SettingsMenu } from './frame.css';

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

const AVATAR_PX = 96;

/** The signed-in user's ID, display name (localpart as fallback) and avatar URL. */
function useOwnProfile() {
  const mx = useMatrixClient();
  const authenticated = useMediaAuthentication();
  const userId = mx.getUserId() ?? '';
  const { displayName, avatarUrl: avatarMxc } = useUserProfile(userId);
  const thumbnail = (mxc: string) =>
    mxcUrlToHttp(mx, mxc, authenticated, AVATAR_PX, AVATAR_PX, 'crop') ?? undefined;
  return {
    userId,
    displayName: displayName ?? getMxIdLocalPart(userId) ?? userId,
    avatarUrl: avatarMxc ? thumbnail(avatarMxc) : undefined,
  };
}

type SettingsMenuListProps = {
  items: SettingsMenuItem[];
  activePage: SettingsPage | undefined;
  onSelect: (page: SettingsPage) => void;
};

function SettingsMenuList({ items, activePage, onSelect }: SettingsMenuListProps) {
  const entries = items.map(({ page, name, icon }) => {
    const current = page === activePage;
    const labelStyle = current ? { fontWeight: config.fontWeight.W600 } : undefined;
    return (
      <MenuItem
        key={page}
        radii="500"
        variant="Background"
        before={<Icon size="100" src={icon} filled={current} />}
        aria-pressed={current}
        onClick={() => onSelect(page)}
      >
        <Text size="T300" style={labelStyle} truncate>
          {name}
        </Text>
      </MenuItem>
    );
  });
  return <div className={SettingsMenu}>{entries}</div>;
}

function LogoutButton() {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const dismiss = () => setConfirming(false);

  const confirmation = (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            clickOutsideDeactivates: true,
            initialFocus: false,
            onDeactivate: dismiss,
          }}
        >
          <LogoutDialog handleClose={dismiss} />
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );

  return (
    <Box direction="Column" shrink="No" style={{ padding: config.space.S200 }}>
      <Button
        variant="Critical"
        fill="None"
        size="300"
        radii="300"
        before={<Icon size="100" src={Icons.Power} />}
        onClick={() => setConfirming(true)}
      >
        <Text size="B400">{t('settings.logout')}</Text>
      </Button>
      {confirming ? confirmation : null}
    </Box>
  );
}

/** The settings dialog: account header and page menu beside the selected page. */
export function Settings({ initialPage, requestClose }: SettingsProps) {
  const { t } = useTranslation();
  const viewport = useScreenSizeContext();
  const showLocalMindroom = useShowLocalMindroom();
  const { userId, displayName, avatarUrl } = useOwnProfile();
  const [activePage, setActivePage] = useState<SettingsPage | undefined>(() =>
    resolveSettingsInitialPage(initialPage, viewport, showLocalMindroom)
  );

  const menuItems = useMemo(
    () => getSettingsMenuItems(showLocalMindroom, t),
    [showLocalMindroom, t]
  );
  const isMobile = viewport === ScreenSize.Mobile;

  // On mobile a page closes back to the menu; on desktop it closes the dialog.
  const handlePageRequestClose = useCallback(
    () => (isMobile ? setActivePage(undefined) : requestClose()),
    [isMobile, requestClose]
  );

  const nav = (
    <PageNav size="300">
      <PageNavHeader outlined={false}>
        <Box grow="Yes" gap="200" alignItems="Center">
          <Avatar size="200" radii="300">
            <UserAvatar
              alt={displayName}
              src={avatarUrl}
              userId={userId}
              renderFallback={() => <Text size="H6">{displayName.charAt(0)}</Text>}
            />
          </Avatar>
          <Text size="H4" truncate>
            {t('settings.title')}
          </Text>
        </Box>
        {isMobile && (
          <IconButton
            variant="Background"
            aria-label={t('featureUi.settings.emojisStickers.globalPacks.close')}
            onClick={requestClose}
          >
            <Icon src={Icons.Cross} />
          </IconButton>
        )}
      </PageNavHeader>
      <Box grow="Yes" direction="Column">
        <PageNavContent>
          <SettingsMenuList items={menuItems} activePage={activePage} onSelect={setActivePage} />
        </PageNavContent>
        <LogoutButton />
      </Box>
    </PageNav>
  );

  return (
    <PageRoot nav={(!isMobile || activePage === undefined) && nav}>
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
