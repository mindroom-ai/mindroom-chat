import React from 'react';
import { Box, Button, Icon, IconButton, Icons, Scroll, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { useRoom } from '../../../hooks/useRoom';
import {
  RoomProfile,
  RoomEncryption,
  RoomHistoryVisibility,
  RoomJoinRules,
  RoomLocalAddresses,
  RoomPublishedAddresses,
  RoomPublish,
  RoomUpgrade,
} from '../../common-settings/general';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import {
  getAvailableRoomViewModes,
  type RoomViewMode,
} from '../../../mindroom/threads/roomViewMode';
import { useRoomViewMode } from '../../../mindroom/threads/useRoomViewMode';
import { useSimpleMode } from '../../../mindroom/settings/useMindroomAccountSettings';

const ROOM_VIEW_MODE_LABELS = {
  compact: 'featureUi.roomSettings.general.compact',
  threaded: 'featureUi.roomSettings.general.threads',
  classic: 'featureUi.roomSettings.general.classic',
} as const satisfies Record<RoomViewMode, string>;

function RoomTimelineMode() {
  const { t } = useTranslation();
  const room = useRoom();
  const simpleMode = useSimpleMode();
  const { setViewMode, viewMode } = useRoomViewMode(room.roomId);

  return (
    <Box direction="Column" gap="200">
      <Text size="T300" priority="400">
        {t('featureUi.roomSettings.general.timeline')}
      </Text>
      <Box gap="100" wrap="Wrap">
        {getAvailableRoomViewModes(simpleMode).map((mode) => (
          <Button
            key={mode}
            size="300"
            radii="300"
            variant={viewMode === mode ? 'Primary' : 'Secondary'}
            fill={viewMode === mode ? 'Solid' : 'Soft'}
            onClick={() => setViewMode(mode)}
            aria-pressed={viewMode === mode}
          >
            <Text size="B300">{t(ROOM_VIEW_MODE_LABELS[mode])}</Text>
          </Button>
        ))}
      </Box>
    </Box>
  );
}

type GeneralProps = {
  requestClose: () => void;
};
export function General({ requestClose }: GeneralProps) {
  const { t } = useTranslation();
  const room = useRoom();
  const powerLevels = usePowerLevels(room);
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);

  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              {t('featureUi.roomSettings.general.general')}
            </Text>
          </Box>
          <Box shrink="No">
            <IconButton onClick={requestClose} variant="Surface">
              <Icon src={Icons.Cross} />
            </IconButton>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <Box direction="Column" gap="700">
              <RoomProfile permissions={permissions} />
              <Box direction="Column" gap="100">
                <Text size="L400">{t('featureUi.roomSettings.general.options')}</Text>
                <RoomJoinRules permissions={permissions} />
                <RoomTimelineMode />
                <RoomHistoryVisibility permissions={permissions} />
                <RoomEncryption permissions={permissions} />
                <RoomPublish permissions={permissions} />
              </Box>
              <Box direction="Column" gap="100">
                <Text size="L400">{t('featureUi.roomSettings.general.addresses')}</Text>
                <RoomPublishedAddresses permissions={permissions} />
                <RoomLocalAddresses permissions={permissions} />
              </Box>
              <Box direction="Column" gap="100">
                <Text size="L400">{t('featureUi.roomSettings.general.advancedOptions')}</Text>
                <RoomUpgrade permissions={permissions} requestClose={requestClose} />
              </Box>
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
