import { memo, useCallback, useMemo } from 'react';
import { Box, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import type { ThreadWorkflowBucket } from '../../event-store/threads/threadWorkflow';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import type { CrossRoomThreadIndexEntry } from '../../threads/cross-room/crossRoomThreadIndex';
import type {
  CompactThreadSection,
  CompactThreadSectionId,
} from '../../threads/overview/compactThreadSections';
import * as compactCss from '../../threads/overview/CompactRoomView.css';
import { CompactSectionHeader } from '../../threads/overview/CompactSectionHeader';
import { CompactThreadCard } from '../../threads/overview/CompactThreadCard';
import {
  buildCompactThreadCardViewModelFromRecord,
  getForkedFrom,
} from '../../threads/overview/compactThreadCardViewModel';
import { ThreadCardBadges } from '../../threads/overview/ThreadCardBadges';
import { ownDirectionLine } from '../../ui/directional';
import { RoomDot } from './RoomDot';
import type { SpaceRoomItem } from './spaceThreadsModel';
import * as css from './SpaceThreads.css';

export type SpaceThreadsEmptyKey = 'no-rooms' | 'no-threads' | 'no-matching';

const EMPTY_MESSAGE_KEYS = {
  'no-rooms': 'spaceThreads.empty.noRooms',
  'no-threads': 'spaceThreads.empty.noThreads',
  'no-matching': 'mindroomUi.threads.roomThreadOverview.noThreadsMatchCurrentFilters',
} as const;

export function SpaceThreadsNotice({
  message,
  loading,
  emptyKey,
}: {
  message: string;
  loading?: boolean;
  emptyKey?: SpaceThreadsEmptyKey;
}) {
  return (
    <div
      className={compactCss.EmptyState}
      data-space-threads-loading={loading ? 'true' : undefined}
      data-space-threads-empty={emptyKey}
    >
      <Text size="T300" priority="400">
        {message}
      </Text>
    </div>
  );
}

type SpaceThreadCardRowProps = {
  entry: CrossRoomThreadIndexEntry;
  room: Room;
  roomName: string;
  accentColor: string;
  showRoomBadge: boolean;
  snoozeNow: number;
  metaVersion: number;
  onOpenThread: (roomId: string, threadRootId: string) => void;
};

const SpaceThreadCardRow = memo(function SpaceThreadCardRow({
  entry,
  room,
  roomName,
  accentColor,
  showRoomBadge,
  snoozeNow,
  metaVersion,
  onOpenThread,
}: SpaceThreadCardRowProps) {
  const { t, i18n } = useTranslation();
  const mx = useMatrixClient();
  const myUserId = mx.getSafeUserId();
  const useAuthentication = useMediaAuthentication();

  const viewModel = useMemo(() => {
    void metaVersion;
    return buildCompactThreadCardViewModelFromRecord({
      record: entry.threadRecord,
      room,
      forkedFrom: getForkedFrom(room, entry.threadRootId),
      now: snoozeNow,
      currentUserId: myUserId,
      mx,
      useAuthentication,
      t,
      locale: i18n.language,
    });
  }, [
    entry.threadRecord,
    entry.threadRootId,
    i18n.language,
    metaVersion,
    mx,
    myUserId,
    room,
    snoozeNow,
    t,
    useAuthentication,
  ]);

  const badges = useMemo(() => {
    const confirmed = isConfirmedMatrixEventId(entry.threadRootId);
    if (!showRoomBadge && !confirmed) return undefined;
    return (
      <>
        {showRoomBadge && (
          <span className={css.RoomBadge} data-space-thread-room-badge={entry.roomId}>
            <RoomDot color={accentColor} />
            <span className={css.RoomBadgeName} {...ownDirectionLine}>
              {roomName}
            </span>
          </span>
        )}
        {confirmed && <ThreadCardBadges room={room} threadId={entry.threadRootId} />}
      </>
    );
  }, [accentColor, entry.roomId, entry.threadRootId, room, roomName, showRoomBadge]);

  const handleClick = useCallback(
    () => onOpenThread(entry.roomId, entry.threadRootId),
    [entry.roomId, entry.threadRootId, onOpenThread]
  );

  return (
    <div className={compactCss.CardShell}>
      <CompactThreadCard
        room={room}
        roomName={showRoomBadge ? roomName : undefined}
        viewModel={viewModel}
        badges={badges}
        onClick={handleClick}
      />
    </div>
  );
});

export type SpaceThreadsListProps = {
  entryKeys: readonly string[];
  entryByKey: ReadonlyMap<string, CrossRoomThreadIndexEntry>;
  sections?: readonly CompactThreadSection[];
  foldedSections: readonly CompactThreadSectionId[];
  singleBucketTab?: ThreadWorkflowBucket;
  onToggleSectionFold: (id: CompactThreadSectionId) => void;
  roomsById: ReadonlyMap<string, SpaceRoomItem>;
  showRoomBadge: boolean;
  snoozeNow: number;
  metaVersion: number;
  showLoading: boolean;
  emptyKey?: SpaceThreadsEmptyKey;
  onOpenThread: (roomId: string, threadRootId: string) => void;
};

export function SpaceThreadsList({
  entryKeys,
  entryByKey,
  sections,
  foldedSections,
  singleBucketTab,
  onToggleSectionFold,
  roomsById,
  showRoomBadge,
  snoozeNow,
  metaVersion,
  showLoading,
  emptyKey,
  onOpenThread,
}: SpaceThreadsListProps) {
  const { t } = useTranslation();

  const renderCard = (key: string) => {
    const entry = entryByKey.get(key);
    const roomItem = entry ? roomsById.get(entry.roomId) : undefined;
    if (!entry || !roomItem) return null;
    return (
      <SpaceThreadCardRow
        key={entry.key}
        entry={entry}
        room={roomItem.room}
        roomName={roomItem.name}
        accentColor={roomItem.accentColor}
        showRoomBadge={showRoomBadge}
        snoozeNow={snoozeNow}
        metaVersion={metaVersion}
        onOpenThread={onOpenThread}
      />
    );
  };

  return (
    <div className={css.ThreadListScroll} data-space-threads-list="true">
      {showLoading && <SpaceThreadsNotice message={t('spaceThreads.loading')} loading />}
      {emptyKey && (
        <SpaceThreadsNotice message={t(EMPTY_MESSAGE_KEYS[emptyKey])} emptyKey={emptyKey} />
      )}
      {sections
        ? sections.map((section) => {
            const fixedOpen = section.id === singleBucketTab;
            const closed = !fixedOpen && foldedSections.includes(section.id);
            return (
              <Box key={section.id} direction="Column" gap="200">
                <CompactSectionHeader
                  id={section.id}
                  count={section.rootIds.length}
                  closed={closed}
                  fixedOpen={fixedOpen}
                  onToggle={onToggleSectionFold}
                />
                {!closed && section.rootIds.map(renderCard)}
              </Box>
            );
          })
        : entryKeys.map(renderCard)}
    </div>
  );
}
