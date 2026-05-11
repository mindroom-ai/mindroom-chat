import React from 'react';
import { useAtom } from 'jotai';
import { Box, Button, Icon, IconButton, Icons, Scroll, Text } from 'folds';
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
import { roomViewModeAtomFamily, type RoomViewMode } from '../../../mindroom/threads/roomViewMode';

const ROOM_VIEW_MODE_LABELS: Record<RoomViewMode, string> = {
  compact: 'Compact',
  threaded: 'Threads',
  classic: 'Classic',
};

function RoomTimelineMode() {
  const room = useRoom();
  const [viewMode, setViewMode] = useAtom(roomViewModeAtomFamily(room.roomId));

  return (
    <Box direction="Column" gap="200">
      <Text size="T300" priority="400">
        Timeline
      </Text>
      <Box gap="100" wrap="Wrap">
        {(Object.keys(ROOM_VIEW_MODE_LABELS) as RoomViewMode[]).map((mode) => (
          <Button
            key={mode}
            size="300"
            radii="300"
            variant={viewMode === mode ? 'Primary' : 'Secondary'}
            fill={viewMode === mode ? 'Solid' : 'Soft'}
            onClick={() => setViewMode(mode)}
            aria-pressed={viewMode === mode}
          >
            <Text size="B300">{ROOM_VIEW_MODE_LABELS[mode]}</Text>
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
              General
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
                <Text size="L400">Options</Text>
                <RoomJoinRules permissions={permissions} />
                <RoomTimelineMode />
                <RoomHistoryVisibility permissions={permissions} />
                <RoomEncryption permissions={permissions} />
                <RoomPublish permissions={permissions} />
              </Box>
              <Box direction="Column" gap="100">
                <Text size="L400">Addresses</Text>
                <RoomPublishedAddresses permissions={permissions} />
                <RoomLocalAddresses permissions={permissions} />
              </Box>
              <Box direction="Column" gap="100">
                <Text size="L400">Advanced Options</Text>
                <RoomUpgrade permissions={permissions} requestClose={requestClose} />
              </Box>
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
