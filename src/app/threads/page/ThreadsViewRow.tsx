import { useMemo } from 'react';
import { Box, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { CrossRoomThreadIndexEntry } from '../cross-room/crossRoomThreadIndex';
import { buildCompactThreadCardViewModelFromRecord } from '../overview/compactThreadCardViewModel';
import { CompactThreadCard } from '../overview/CompactThreadCard';
import { useInitializeShownThread } from '../useInitializeShownThread';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { useThreadRootLiveCallRow } from '../overview/useThreadRootLiveCallRow';
import { LazyCallRow } from '../../calls/transcription/LazyCallRow';
import * as css from './ThreadsView.css';
import { ownDirectionLine, revealDirectionControls } from '../../ui/directional';

type ThreadsViewRowProps = {
  entry: CrossRoomThreadIndexEntry;
};

/** One thread on the Threads page: its room and space above the thread's card. */
export function ThreadsViewRow({ entry }: ThreadsViewRowProps) {
  const { t, i18n } = useTranslation();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const { navigateRoomThread } = useRoomNavigate();
  // A card on screen loads its thread's latest page, as in the room's Compact view.
  const shownRef = useInitializeShownThread(entry.roomId, entry.threadRootId);

  const room = mx.getRoom(entry.roomId);
  // A live call's row shows in its card as in the room's compact list.
  const callRow = useThreadRootLiveCallRow(room, entry.threadRootId);
  const spaceName = entry.parentSpaceIds
    .map((spaceId) => mx.getRoom(spaceId))
    .find((space) => space?.isSpaceRoom())?.name;

  const viewModel = useMemo(
    () =>
      room
        ? buildCompactThreadCardViewModelFromRecord({
            record: entry.threadRecord,
            room,
            currentUserId: mx.getUserId() ?? '',
            mx,
            useAuthentication,
            t,
            locale: i18n.language,
          } as Parameters<typeof buildCompactThreadCardViewModelFromRecord>[0])
        : undefined,
    [room, entry.threadRecord, mx, useAuthentication, t, i18n.language]
  );

  return (
    <div className={css.Row} ref={shownRef}>
      <Box className={css.RowChrome}>
        <span className={css.Chip}>
          <Icon size="50" src={Icons.Hash} />
          <Text size="T200" priority="300" truncate {...ownDirectionLine}>
            {revealDirectionControls(room?.name ?? entry.roomName)}
          </Text>
        </span>
        {spaceName && (
          <span className={css.Chip}>
            <Icon size="50" src={Icons.Space} />
            <Text size="T200" priority="300" truncate {...ownDirectionLine}>
              {revealDirectionControls(spaceName)}
            </Text>
          </span>
        )}
      </Box>
      {viewModel && (
        <CompactThreadCard
          viewModel={viewModel}
          onClick={() => navigateRoomThread(entry.roomId, entry.threadRootId)}
          attachment={callRow && <LazyCallRow {...callRow} />}
        />
      )}
    </div>
  );
}
