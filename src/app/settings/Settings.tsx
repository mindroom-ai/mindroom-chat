import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Box,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  config,
} from 'folds';
import { MenuItem } from '../ui/glass/GlassPrimitives';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { PageNav, PageNavHeader, PageRoot } from '../ui/page/Page';
import { NavCategoryHeader } from '../ui/nav/NavCategoryHeader';
import { LogoutDialog } from '../account/LogoutDialog';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { getMxIdLocalPart } from '../matrix/matrix';
import { ArchivedRooms } from '../rooms/archive/ArchivedRoomsPage';
import { LocalMindroom } from '../local-mindroom/LocalMindroom';
import { ServerAccounts } from '../server-admin/ServerAccounts';
import { ComputersSettingsPage, ConnectionsSettingsPage } from './pages/AgentSettingsPages';
import {
  getSettingsMenuItems,
  resolveSettingsInitialPage,
  type SettingsMenuItem,
} from './settingsMenu';
import {
  SETTINGS_GROUPS,
  getShownSettings,
  type SettingsPageId,
} from '../preferences/settingsRegistry';
import { searchSettings, type SettingsSearchResult } from './settingsSearchIndex';
import { SettingsTargetContext, type SettingsTarget } from '../preferences/settingsTarget';
import { revealSetting } from './revealSetting';
import { SettingsSearch } from './SettingsSearch';
import { isMacOS } from '../lib/user-agent';
import { getCommandPaletteShortcutLabel } from '../command-palette/commandPaletteShortcut';
import type { SettingsPage } from '../navigation/settingsPages';
import { useSettingsContext } from './useSettingsContext';
import { About } from './pages/About';
import { Account } from '../account/settings/Account';
import { Appearance } from './pages/Appearance';
import { Chats } from './pages/Chats';
import { DeveloperTools } from './pages/DeveloperTools';
import { LanguageRegion } from './pages/LanguageRegion';
import { Notifications } from '../notifications/settings/Notifications';
import { PrivacySecurity } from './pages/PrivacySecurity';
import { Sidebar } from './pages/InterfaceSettings';
import { StorageOffline } from './pages/StorageOffline';
import { SettingsBreadcrumbRoot } from '../ui/settings/SettingsPageFrame';
import {
  SettingsMenu,
  SettingsMenuFooter,
  SettingsMenuGroup,
  SettingsMenuGroupLabel,
  SettingsMenuRow,
  SettingsMenuTitle,
} from '../ui/settings/frame.css';

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
    case 'server-accounts':
      return <ServerAccounts requestClose={requestClose} />;
    case 'storage':
      return <StorageOffline requestClose={requestClose} />;
    case 'developer-tools':
      return <DeveloperTools requestClose={requestClose} />;
    case 'about':
      return <About requestClose={requestClose} />;
  }
}

const MENU_TITLE_STYLE = { flexGrow: 1 };

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

// A group heading is as tall as its text and sits right on its rows; SettingsMenuGroup parts the
// groups, so the whole menu fits a 700 px dialog.
const GROUP_HEADING_STYLE = { minHeight: 0 };

type SettingsMenuListProps = {
  items: SettingsMenuItem[];
  activePage: SettingsPage | undefined;
  onSelect: (page: SettingsPageId) => void;
};

/**
 * The pages under their quiet group headings (You, This app, Agents & connections, ...), each a
 * 32 px row with its line icon, 4 px apart; the open page's row is filled.
 */
function SettingsMenuList({ items, activePage, onSelect }: SettingsMenuListProps) {
  const { t } = useTranslation();
  const groups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => item.group === group.id),
  })).filter((group) => group.items.length > 0);

  return (
    <div className={SettingsMenu}>
      {groups.map((group) => (
        <div
          key={group.id}
          role="group"
          aria-labelledby={`settings-group-${group.id}`}
          className={SettingsMenuGroup}
        >
          <NavCategoryHeader style={GROUP_HEADING_STYLE}>
            <Text
              id={`settings-group-${group.id}`}
              as="span"
              size="T200"
              priority="300"
              className={SettingsMenuGroupLabel}
              truncate
            >
              {t(group.labelKey)}
            </Text>
          </NavCategoryHeader>
          {group.items.map(({ page, name, icon }) => {
            const current = page === activePage;
            const labelStyle = current ? { fontWeight: config.fontWeight.W500 } : undefined;
            return (
              <MenuItem
                key={page}
                size="300"
                radii="400"
                variant="Background"
                className={SettingsMenuRow}
                before={<Icon size="100" src={icon} />}
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

  // A row like the menu's, in the danger color, under the menu.
  return (
    <div className={SettingsMenuFooter}>
      <MenuItem
        size="300"
        radii="400"
        variant="Critical"
        className={SettingsMenuRow}
        before={<Icon size="100" src={Icons.Power} />}
        onClick={() => setConfirming(true)}
      >
        <Text size="T300" truncate>
          {t('settings.logout')}
        </Text>
      </MenuItem>
      {confirming ? confirmation : null}
    </div>
  );
}

/**
 * The settings dialog: the page menu under its search field, grouped as settingsRegistry.ts says,
 * beside the selected page, whose title bar reads "Settings / <page>"; on phones the menu and a
 * page take turns, and the menu carries the dialog's title.
 */
export function Settings({ initialPage, requestClose }: SettingsProps) {
  const { t } = useTranslation();
  const viewport = useScreenSizeContext();
  const context = useSettingsContext();
  const [activePage, setActivePage] = useState<SettingsPageId | undefined>(() =>
    resolveSettingsInitialPage(
      initialPage,
      viewport,
      context.localMindroom,
      context.native,
      context.serverAdmin
    )
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
    () => getSettingsMenuItems(context.localMindroom, t, context.native, context.serverAdmin),
    [context.localMindroom, context.native, context.serverAdmin, t]
  );
  const isMobile = viewport === ScreenSize.Mobile;

  // On mobile a page closes back to the menu; on desktop it closes the dialog.
  const handlePageRequestClose = useCallback(
    () => (isMobile ? setActivePage(undefined) : requestClose()),
    [isMobile, requestClose]
  );

  // The dialog is named by its title: in each page's title bar on wider screens, and on a phone
  // in the menu's own title bar, which also holds the close button over the search field. Pages
  // come and go, so the title keeps one ID for the dialog's label to point at.
  const titleId = useId();
  const dialogTitle = useMemo(() => ({ label: t('settings.title'), id: titleId }), [t, titleId]);
  const closeLabel = t('featureUi.settings.emojisStickers.globalPacks.close');
  const menuTitle = isMobile && (
    <PageNavHeader outlined={false} className={SettingsMenuTitle}>
      <Text as="h2" id={titleId} size="H4" truncate style={MENU_TITLE_STYLE}>
        {dialogTitle.label}
      </Text>
      <IconButton variant="Background" aria-label={closeLabel} onClick={requestClose}>
        <Icon src={Icons.Cross} />
      </IconButton>
    </PageNavHeader>
  );
  // The menu scrolls beneath the search field; Logout stays below the list.
  const nav = (
    <PageNav size="300" label={t('settings.title')}>
      <Box grow="Yes" direction="Column" style={{ minHeight: 0 }}>
        <SettingsSearch
          query={query}
          onQueryChange={setQuery}
          results={results}
          onChoose={openResult}
          title={menuTitle}
          keyHint={!isMobile}
        >
          <SettingsMenuList items={menuItems} activePage={activePage} onSelect={selectPage} />
        </SettingsSearch>
        <LogoutButton />
      </Box>
    </PageNav>
  );

  return (
    <PageRoot nav={(!isMobile || activePage === undefined) && nav}>
      {activePage !== undefined && (
        // `display: contents` keeps the page in the dialog's row; search looks for settings here.
        <div ref={pageRef} style={{ display: 'contents' }}>
          <SettingsBreadcrumbRoot.Provider value={dialogTitle}>
            <SettingsTargetContext.Provider value={target}>
              <SettingsPageContent
                page={activePage}
                requestClose={handlePageRequestClose}
                closeDialog={requestClose}
              />
            </SettingsTargetContext.Provider>
          </SettingsBreadcrumbRoot.Provider>
        </div>
      )}
    </PageRoot>
  );
}
