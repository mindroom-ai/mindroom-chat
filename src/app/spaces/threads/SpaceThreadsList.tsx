import { Box, Button, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { ThreadWorkflowBucket } from '../../event-store/threads/threadWorkflow';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import type { CrossRoomThreadIndexEntry } from '../../threads/cross-room/crossRoomThreadIndex';
import type { CompactThreadSectionId } from '../../threads/overview/compactThreadSections';
import * as compactCss from '../../threads/overview/CompactRoomView.css';
import { CompactThreadCard } from '../../threads/overview/CompactThreadCard';
import {
  buildCompactThreadCardViewModelFromRecord,
  getForkedFrom,
} from '../../threads/overview/compactThreadCardViewModel';
import { ThreadCardBadges } from '../../threads/overview/ThreadCardBadges';
import { ownDirectionLine } from '../../ui/directional';
import { getRoomAccentColor, type SpaceThreadSection } from './spaceThreadsModel';
import * as css from './SpaceThreads.css';

export type SpaceThreadsEmptyKey = 'no-rooms' | 'no-threads' | 'no-matching';

export type SpaceThreadsListProps = {
  entries: readonly CrossRoomThreadIndexEntry[];
  sections: readonly SpaceThreadSection[];
  sectionsEnabled: boolean;
  foldedSections: readonly CompactThreadSectionId[];
  singleBucketTab?: ThreadWorkflowBucket;
  onToggleSectionFold: (id: CompactThreadSectionId) => void;
  roomById: ReadonlyMap<string, Room>;
  roomNameById: ReadonlyMap<string, string>;
  roomAccentById: ReadonlyMap<string, string>;
  showRoomBadge: boolean;
  snoozeNow: number;
  showLoading: boolean;
  emptyKey?: SpaceThreadsEmptyKey;
  onOpenThread: (roomId: string, threadRootId: string) => void;
};

export function SpaceThreadsList({
  entries,
  sections,
  sectionsEnabled,
  foldedSections,
  singleBucketTab,
  onToggleSectionFold,
  roomById,
  roomNameById,
  roomAccentById,
  showRoomBadge,
  snoozeNow,
  showLoading,
  emptyKey,
  onOpenThread,
}: SpaceThreadsListProps) {
  const { t, i18n } = useTranslation();
  const mx = useMatrixClient();
  const myUserId = mx.getSafeUserId();
  const useAuthentication = useMediaAuthentication();

  const renderCard = (entry: CrossRoomThreadIndexEntry) => {
    const room = roomById.get(entry.roomId);
    if (!room) return null;
    const viewModel = buildCompactThreadCardViewModelFromRecord({
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
    const roomName = roomNameById.get(entry.roomId) ?? entry.roomName;
    const accentColor = roomAccentById.get(entry.roomId) ?? getRoomAccentColor(entry.roomId);
    return (
      <div key={entry.key} className={compactCss.CardShell}>
        <CompactThreadCard
          room={room}
          roomName={showRoomBadge ? roomName : undefined}
          viewModel={viewModel}
          badges={
            <>
              {showRoomBadge && (
                <span className={css.RoomBadge} data-space-thread-room-badge={entry.roomId}>
                  <span
                    className={css.RoomDot}
                    style={{ backgroundColor: accentColor }}
                    aria-hidden="true"
                  />
                  <span className={css.RoomBadgeName} {...ownDirectionLine}>
                    {roomName}
                  </span>
                </span>
              )}
              <ThreadCardBadges room={room} threadId={entry.threadRootId} />
            </>
          }
          onClick={() => onOpenThread(entry.roomId, entry.threadRootId)}
        />
      </div>
    );
  };

  return (
    <div className={css.ThreadListScroll} data-space-threads-list="true">
      {showLoading && (
        <div className={compactCss.EmptyState} data-space-threads-loading="true">
          <Text size="T300" priority="400">
            {t('spaceThreads.loading')}
          </Text>
        </div>
      )}
      {emptyKey && (
        <div className={compactCss.EmptyState} data-space-threads-empty={emptyKey}>
          <Text size="T300" priority="400">
            {t(
              emptyKey === 'no-rooms'
                ? 'spaceThreads.empty.noRooms'
                : emptyKey === 'no-matching'
                  ? 'mindroomUi.threads.roomThreadOverview.noThreadsMatchCurrentFilters'
                  : 'spaceThreads.empty.noThreads'
            )}
          </Text>
        </div>
      )}
      {!showLoading &&
        (sectionsEnabled && sections.length > 0
          ? sections.map((section) => {
              const fixedOpen = section.id === singleBucketTab;
              const closed = !fixedOpen && foldedSections.includes(section.id);
              const label = (
                <Text size="B300">{`${t(`thread.workflow.${section.id}`)} · ${
                  section.entries.length
                }`}</Text>
              );
              return (
                <Box key={section.id} direction="Column" gap="200">
                  <div className={compactCss.SectionHeader} data-compact-section={section.id}>
                    <Button
                      as={fixedOpen ? 'div' : 'button'}
                      size="300"
                      variant="Secondary"
                      fill="None"
                      radii="300"
                      aria-expanded={fixedOpen ? undefined : !closed}
                      onClick={fixedOpen ? undefined : () => onToggleSectionFold(section.id)}
                      before={
                        fixedOpen ? undefined : (
                          <Icon
                            size="100"
                            src={closed ? Icons.ChevronRight : Icons.ChevronBottom}
                            data-directional={closed || undefined}
                          />
                        )
                      }
                    >
                      {label}
                    </Button>
                  </div>
                  {!closed && section.entries.map(renderCard)}
                </Box>
              );
            })
          : entries.map(renderCard))}
    </div>
  );
}
