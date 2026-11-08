import React, { useCallback, useState } from 'react';
import { Box, Icon, IconButton, Icons, Text, config } from 'folds';
import type { IconSrc } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { MenuItem } from '../../ui/glass/GlassPrimitives';
import { PageNav, PageNavContent, PageNavHeader, PageRoot } from '../../ui/page/Page';
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { RoomSettingsPage } from '../../navigation/roomSettingsState';
import { RoomSettingsMenuTitle, SettingsMenu, SettingsMenuRow } from '../../ui/settings/frame.css';
import { SettingsCard } from '../../ui/settings/SettingsCard';
import { SettingsPageFrame } from '../../ui/settings/SettingsPageFrame';
import { OfflineRoomSettings } from './general/OfflineRoomSettings';
import { RoomProfileEditor } from './general/RoomProfileEditor';
import { RoomAvatarTile } from './general/RoomAvatarTile';
import { RoomAccessOptions } from './general/RoomAccessOptions';
import { RoomAddresses } from './general/RoomAddresses';
import { RoomUpgrade } from './general/RoomUpgrade';
import { RoomMembersPage } from './RoomMembersPage';
import { RoomPermissionsPage } from './permissions/RoomPermissionsPage';
import { RoomPacksPage } from './RoomPacksPage';
import { RoomDeveloperToolsPage } from './developer-tools/RoomDeveloperToolsPage';
import { revealDirectionControls } from '../../ui/directional';

const NAVIGATION = 'featureUi.roomSettings.navigation';

/** The dialog's pages in menu order, with their names and icons. */
const PAGES: Array<{ page: RoomSettingsPage; label: string; icon: IconSrc }> = [
  { page: RoomSettingsPage.GeneralPage, label: 'general', icon: Icons.Setting },
  { page: RoomSettingsPage.MembersPage, label: 'members', icon: Icons.User },
  { page: RoomSettingsPage.PermissionsPage, label: 'permissions', icon: Icons.Lock },
  { page: RoomSettingsPage.EmojisStickersPage, label: 'emojisStickers', icon: Icons.Smile },
  { page: RoomSettingsPage.DeveloperToolsPage, label: 'developerTools', icon: Icons.Terminal },
];

const isPage = (page: string | undefined): page is RoomSettingsPage =>
  PAGES.some((entry) => entry.page === page);

/** Phones open on the menu unless a page was asked for; wider screens open on a page. */
const firstPage = (
  requested: string | undefined,
  screen: ScreenSize
): RoomSettingsPage | undefined => {
  if (isPage(requested)) return requested;
  return screen === ScreenSize.Mobile ? undefined : RoomSettingsPage.GeneralPage;
};

type PageProps = {
  room: Room;
  space: boolean;
  requestClose: () => void;
  /** Closes the whole dialog, such as when another room opens from it. */
  closeDialog: () => void;
};

/** A titled group of tiles on the General page. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {title}
      </Text>
      <SettingsCard>{children}</SettingsCard>
    </Box>
  );
}

/**
 * The picture, name and topic; who may join and see history; the addresses; for a room what this
 * device keeps of it offline; and the room version with its upgrade.
 */
function General({ room, space, requestClose, closeDialog }: PageProps) {
  const { t } = useTranslation();
  return (
    <SettingsPageFrame title={t(`${NAVIGATION}.general`)} requestClose={requestClose}>
      <Section title={t('featureUi.commonSettings.general.roomProfile.profile')}>
        <RoomAvatarTile room={room} space={space} />
        <RoomProfileEditor room={room} />
      </Section>
      <Section title={t('featureUi.roomSettings.general.options')}>
        <RoomAccessOptions room={room} space={space} />
      </Section>
      <RoomAddresses room={room} />
      {!space && (
        <SettingsCard>
          <OfflineRoomSettings roomId={room.roomId} />
        </SettingsCard>
      )}
      <Section title={t('featureUi.roomSettings.general.advancedOptions')}>
        <RoomUpgrade room={room} space={space} onOpened={closeDialog} />
      </Section>
    </SettingsPageFrame>
  );
}

function SelectedPage({ page, ...props }: PageProps & { page: RoomSettingsPage }) {
  switch (page) {
    case RoomSettingsPage.MembersPage:
      return <RoomMembersPage room={props.room} requestClose={props.requestClose} />;
    case RoomSettingsPage.PermissionsPage:
      return (
        <RoomPermissionsPage
          room={props.room}
          requestClose={props.requestClose}
          space={props.space}
        />
      );
    case RoomSettingsPage.EmojisStickersPage:
      return <RoomPacksPage room={props.room} requestClose={props.requestClose} />;
    case RoomSettingsPage.DeveloperToolsPage:
      return <RoomDeveloperToolsPage room={props.room} requestClose={props.requestClose} />;
    default:
      return <General {...props} />;
  }
}

/**
 * The settings dialog of a room or a space: its name over the page menu, beside the selected
 * page. On phones the menu and a page take turns.
 */
export function RoomSettings(props: {
  room: Room;
  /** The page asked for, such as from a link into the dialog. */
  openOn?: string;
  /** A space has no offline copy, so its General page only edits the name and topic. */
  space?: boolean;
  requestClose: () => void;
}) {
  const { room, openOn, space = false, requestClose } = props;
  const { t } = useTranslation();
  const screen = useScreenSizeContext();
  const roomName = revealDirectionControls(useRoomName(room));
  const [page, setPage] = useState<RoomSettingsPage | undefined>(() => firstPage(openOn, screen));
  const phone = screen === ScreenSize.Mobile;

  // On phones a page goes back to the menu; elsewhere it closes the dialog.
  const closePage = useCallback(
    () => (phone ? setPage(undefined) : requestClose()),
    [phone, requestClose]
  );

  const entries = PAGES.map((entry) => {
    const current = entry.page === page;
    return (
      <MenuItem
        key={entry.page}
        size="300"
        radii="400"
        variant="Background"
        className={SettingsMenuRow}
        before={<Icon size="100" src={entry.icon} filled={current} />}
        aria-pressed={current}
        onClick={() => setPage(entry.page)}
      >
        <Text
          size="T300"
          style={current ? { fontWeight: config.fontWeight.W600 } : undefined}
          truncate
        >
          {t(`${NAVIGATION}.${entry.label}` as never)}
        </Text>
      </MenuItem>
    );
  });

  // The page menu scrolls beneath the room's name.
  const title = (
    <PageNavHeader outlined={false} className={phone ? undefined : RoomSettingsMenuTitle}>
      <Box grow="Yes" alignItems="Center">
        <Text as="h2" size="H4" truncate>
          {roomName}
        </Text>
      </Box>
      {phone && (
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
    <PageNav size="300" label={roomName}>
      <PageNavContent header={title}>
        <div className={SettingsMenu}>{entries}</div>
      </PageNavContent>
    </PageNav>
  );

  return (
    <PageRoot nav={(!phone || page === undefined) && nav}>
      {page !== undefined && (
        <SelectedPage
          key={page}
          page={page}
          room={room}
          space={space}
          requestClose={closePage}
          closeDialog={requestClose}
        />
      )}
    </PageRoot>
  );
}
