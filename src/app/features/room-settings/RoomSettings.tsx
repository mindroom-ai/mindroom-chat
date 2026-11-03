import React, { useCallback, useState } from 'react';
import { Box, Icon, IconButton, Icons, Text, config } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import { PageNav, PageNavContent, PageNavHeader, PageRoot } from '../../components/page';
import { SequenceCard } from '../../components/sequence-card';
import { useRoomName } from '../../hooks/useRoomMeta';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { RoomSettingsPage } from '../../state/roomSettings';
import { SettingsMenu } from '../settings/frame.css';
import { SettingsPageFrame } from '../settings/SettingsPageFrame';
import { SequenceCardStyle } from '../settings/styles.css';
import { OfflineRoomSettings } from './general/OfflineRoomSettings';

/** The pages this dialog has so far; a request for another one opens General. */
const OFFERED_PAGES = [RoomSettingsPage.GeneralPage] as const;
type OfferedPage = (typeof OFFERED_PAGES)[number];

const PAGE_LABEL_KEYS: Record<OfferedPage, 'featureUi.roomSettings.navigation.general'> = {
  [RoomSettingsPage.GeneralPage]: 'featureUi.roomSettings.navigation.general',
};

const PAGE_ICONS = {
  [RoomSettingsPage.GeneralPage]: Icons.Setting,
} as const;

const isOffered = (page: RoomSettingsPage | undefined): page is OfferedPage =>
  OFFERED_PAGES.some((offered) => offered === page);

/** Phones open on the menu unless a page was asked for; wider screens open on a page. */
const firstPage = (
  requested: RoomSettingsPage | undefined,
  screen: ScreenSize
): OfferedPage | undefined => {
  if (isOffered(requested)) return requested;
  return screen === ScreenSize.Mobile ? undefined : RoomSettingsPage.GeneralPage;
};

type GeneralProps = { room: Room; requestClose: () => void };

/** The room's General page: for now, what this device keeps of the room offline. */
function General({ room, requestClose }: GeneralProps) {
  const { t } = useTranslation();
  return (
    <SettingsPageFrame
      title={t('featureUi.roomSettings.navigation.general')}
      requestClose={requestClose}
    >
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <OfflineRoomSettings roomId={room.roomId} />
      </SequenceCard>
    </SettingsPageFrame>
  );
}

/** The room settings dialog: the room's name and page menu beside the selected page. */
export function RoomSettings(props: {
  room: Room;
  /** The page asked for, such as from a link into the dialog. */
  openOn?: RoomSettingsPage;
  requestClose: () => void;
}) {
  const { room, openOn, requestClose } = props;
  const { t } = useTranslation();
  const screen = useScreenSizeContext();
  const roomName = useRoomName(room);
  const [page, setPage] = useState<OfferedPage | undefined>(() => firstPage(openOn, screen));
  const phone = screen === ScreenSize.Mobile;

  // On phones a page goes back to the menu; elsewhere it closes the dialog.
  const closePage = useCallback(
    () => (phone ? setPage(undefined) : requestClose()),
    [phone, requestClose]
  );

  const entries = OFFERED_PAGES.map((offered) => {
    const current = offered === page;
    return (
      <MenuItem
        key={offered}
        radii="500"
        variant="Background"
        before={<Icon size="100" src={PAGE_ICONS[offered]} filled={current} />}
        aria-pressed={current}
        onClick={() => setPage(offered)}
      >
        <Text
          size="T300"
          style={current ? { fontWeight: config.fontWeight.W600 } : undefined}
          truncate
        >
          {t(PAGE_LABEL_KEYS[offered])}
        </Text>
      </MenuItem>
    );
  });

  const nav = (
    <PageNav size="300">
      <PageNavHeader outlined={false}>
        <Box grow="Yes" alignItems="Center">
          <Text size="H4" truncate>
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
      <Box grow="Yes" direction="Column">
        <PageNavContent>
          <div className={SettingsMenu}>{entries}</div>
        </PageNavContent>
      </Box>
    </PageNav>
  );

  return (
    <PageRoot nav={(!phone || page === undefined) && nav}>
      {page === RoomSettingsPage.GeneralPage && (
        <General room={room} requestClose={closePage} />
      )}
    </PageRoot>
  );
}
