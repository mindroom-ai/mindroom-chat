import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { NavCategoryHeader } from '../../components/nav';
import { UserAvatar } from '../../components/user-avatar';
import { LogoutDialog } from '../../components/LogoutDialog';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import { getMxIdLocalPart } from '../../utils/matrix';
import { ArchivedRooms } from '../../mindroom/rooms/ArchivedRoomsPage';
import { LocalMindroom } from '../../mindroom/local-mindroom/LocalMindroom';
import {
  ComputersSettingsPage,
  ConnectionsSettingsPage,
} from '../../mindroom/settings/AgentSettingsPages';
import {
  getSettingsMenuItems,
  resolveSettingsInitialPage,
  type SettingsMenuItem,
} from './settingsMenu';
import { SETTINGS_GROUPS, getShownSettings, type SettingsPageId } from './settingsRegistry';
import { searchSettings, type SettingsSearchResult } from './settingsSearch';
import { SettingsTargetContext, type SettingsTarget } from './settingsTarget';
import { revealSetting } from './revealSetting';
import { SettingsSearch } from './SettingsSearch';
import { isMacOS } from '../../utils/user-agent';
import { getCommandPaletteShortcutLabel } from '../../mindroom/command-palette/commandPaletteShortcut';
import type { SettingsPage } from './settingsPages';
import { useSettingsContext } from './useSettingsContext';
import { About } from './about';
import { Account } from './account';
import { Appearance } from './appearance/Appearance';
import { Chats } from './chats/Chats';
import { DeveloperTools } from './developer-tools';
import { LanguageRegion } from './language/LanguageRegion';
import { Notifications } from './notifications';
import { PrivacySecurity } from './privacy/PrivacySecurity';
import { Sidebar } from './sidebar/Sidebar';
import { StorageOffline } from './storage/StorageOffline';
import { SettingsMenu, SettingsMenuGroupLabel } from './frame.css';

type SettingsProps = {
  /** A page id, or an earlier one; settingsRegistry.ts resolves it. */
  initialPage?: SettingsPage;
  requestClose: () => void;
};

type PageContentProps = {
  page: SettingsPageId;
  requestClose: () => void;
  /** Closes the whole dialog, for pages that open a room. */
  closeDialog: () => void;
};

function SettingsPageContent({ page, requestClose, closeDialog }: PageContentProps) {
  switch (page) {
    case 'account':
      return <Account requestClose={requestClose} />;
    case 'notifications':
      return <Notifications requestClose={requestClose} />;
    case 'privacy':
      return <PrivacySecurity requestClose={requestClose} />;
    case 'appearance':
      return <Appearance requestClose={requestClose} />;
    case 'chats':
      return <Chats requestClose={requestClose} />;
    case 'sidebar':
      return <Sidebar requestClose={requestClose} />;
    case 'language':
      return <LanguageRegion requestClose={requestClose} />;
    case 'connections':
      return <ConnectionsSettingsPage requestClose={requestClose} />;
    case 'computers':
      return <ComputersSettingsPage requestClose={requestClose} />;
    case 'mindroom.local-mindroom':
      return <LocalMindroom requestClose={requestClose} onNavigate={closeDialog} />;
    case 'archived-rooms':
      return <ArchivedRooms requestClose={requestClose} onNavigate={closeDialog} />;
    case 'storage':
      return <StorageOffline requestClose={requestClose} />;
    case 'developer-tools':
      return <DeveloperTools requestClose={requestClose} />;
    case 'about':
      return <About requestClose={requestClose} />;
  }
}

/** The values some labels and descriptions fill in, so search reads them as the page does. */
const useSearchValues = () => {
  const userId = useMatrixClient().getUserId() ?? '';
  return useMemo(
    () => ({
      userId,
      username: getMxIdLocalPart(userId) ?? userId,
      sendKey: isMacOS() ? 'Cmd' : 'Ctrl',
      shortcut: getCommandPaletteShortcutLabel(),
    }),
    [userId]
  );
};

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
  onSelect: (page: SettingsPageId) => void;
};

/** The pages under their group headings (You, This app, Agents & connections, ...). */
function SettingsMenuList({ items, activePage, onSelect }: SettingsMenuListProps) {
  const { t } = useTranslation();
  const groups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => item.group === group.id),
  })).filter((group) => group.items.length > 0);

  return (
    <div className={SettingsMenu}>
      {groups.map((group) => (
        <div key={group.id} role="group" aria-labelledby={`settings-group-${group.id}`}>
          <NavCategoryHeader>
            <Text
              id={`settings-group-${group.id}`}
              as="span"
              size="O400"
              priority="300"
              className={SettingsMenuGroupLabel}
              truncate
            >
              {t(group.labelKey)}
            </Text>
          </NavCategoryHeader>
          {group.items.map(({ page, name, icon }) => {
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
          })}
        </div>
      ))}
    </div>
  );
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

/**
 * The settings dialog: the page menu under the account header, grouped as settingsRegistry.ts
 * says, beside the selected page; on phones the menu and a page take turns.
 */
export function Settings({ initialPage, requestClose }: SettingsProps) {
  const { t } = useTranslation();
  const viewport = useScreenSizeContext();
  const context = useSettingsContext();
  const { userId, displayName, avatarUrl } = useOwnProfile();
  const [activePage, setActivePage] = useState<SettingsPageId | undefined>(() =>
    resolveSettingsInitialPage(initialPage, viewport, context.localMindroom, context.native)
  );
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<SettingsTarget>();
  const pageRef = useRef<HTMLDivElement>(null);
  const searchValues = useSearchValues();
  const results = searchSettings(
    query,
    getShownSettings(context),
    (key, values) => t(key, values),
    searchValues
  );

  const selectPage = useCallback((page: SettingsPageId) => {
    setActivePage(page);
    setTarget(undefined);
  }, []);
  const openResult = useCallback((result: SettingsSearchResult) => {
    setActivePage(result.setting.page);
    setTarget((previous) => ({ id: result.setting.id, seq: (previous?.seq ?? 0) + 1 }));
  }, []);

  useEffect(() => (target ? revealSetting(pageRef.current, target.id) : undefined), [target]);

  const menuItems = useMemo(
    () => getSettingsMenuItems(context.localMindroom, t, context.native),
    [context.localMindroom, context.native, t]
  );
  const isMobile = viewport === ScreenSize.Mobile;

  // On mobile a page closes back to the menu; on desktop it closes the dialog.
  const handlePageRequestClose = useCallback(
    () => (isMobile ? setActivePage(undefined) : requestClose()),
    [isMobile, requestClose]
  );

  // The title rides on top of the menu, which scrolls beneath it; Logout stays below the list.
  const title = (
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
        <Text as="h2" size="H4" truncate>
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
  );
  const nav = (
    <PageNav size="300" label={t('settings.title')}>
      <Box grow="Yes" direction="Column" style={{ minHeight: 0 }}>
        <PageNavContent header={title}>
          <SettingsSearch
            query={query}
            onQueryChange={setQuery}
            results={results}
            onChoose={openResult}
          >
            <SettingsMenuList items={menuItems} activePage={activePage} onSelect={selectPage} />
          </SettingsSearch>
        </PageNavContent>
        <LogoutButton />
      </Box>
    </PageNav>
  );

  return (
    <PageRoot nav={(!isMobile || activePage === undefined) && nav}>
      {activePage !== undefined && (
        // `display: contents` keeps the page in the dialog's row; search looks for settings here.
        <div ref={pageRef} style={{ display: 'contents' }}>
          <SettingsTargetContext.Provider value={target}>
            <SettingsPageContent
              page={activePage}
              requestClose={handlePageRequestClose}
              closeDialog={requestClose}
            />
          </SettingsTargetContext.Provider>
        </div>
      )}
    </PageRoot>
  );
}
