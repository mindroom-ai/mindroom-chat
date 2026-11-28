import { type ReactNode, type RefObject, useRef } from 'react';
import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { ThreadWorkflowBucket } from '../../event-store/threads/threadWorkflow';
import type { CrossRoomThreadIndexEntry } from '../../threads/cross-room/crossRoomThreadIndex';
import {
  CompactCardList,
  renderCompactSections,
} from '../../threads/overview/CompactThreadCardChrome';
import type {
  CompactThreadSection,
  CompactThreadSectionId,
} from '../../threads/overview/compactThreadSections';
import { useVirtualCompactList } from '../../threads/overview/useVirtualCompactList';
import { type ScrollAnchorMemory, useScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import type { SpaceRoomItem } from './spaceThreadsModel';
import * as css from './SpaceThreads.css';

export type SpaceThreadsVerticalBodyProps = {
  groups: Record<string, string[]>;
  sections?: readonly CompactThreadSection[];
  foldedSections: readonly CompactThreadSectionId[];
  singleBucketTab?: ThreadWorkflowBucket;
  entryByKey: ReadonlyMap<string, CrossRoomThreadIndexEntry>;
  roomsById: ReadonlyMap<string, SpaceRoomItem>;
  scrollMemory: ScrollAnchorMemory;
  scrollMemoryKey: string;
  menuKey?: string;
  indexPending: boolean;
  pinError: boolean;
  getRowId: (row: Element) => string | undefined;
  notice?: ReactNode;
  onToggleSectionFold: (id: CompactThreadSectionId) => void;
  renderCard: (key: string, rowScrollRef: RefObject<HTMLDivElement | null>) => ReactNode;
};

/** Vertical virtualized list body for SpaceThreadsList, mounted only when Columns mode is off. */
export function SpaceThreadsVerticalBody({
  groups,
  sections,
  foldedSections,
  singleBucketTab,
  entryByKey,
  roomsById,
  scrollMemory,
  scrollMemoryKey,
  menuKey,
  indexPending,
  pinError,
  getRowId,
  notice,
  onToggleSectionFold,
  renderCard,
}: SpaceThreadsVerticalBodyProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const blocks = useVirtualCompactList({
    groups,
    scrollRef,
    contentRef,
    memory: scrollMemory,
    roomId: scrollMemoryKey,
    protectedId: menuKey,
    records: entryByKey,
    indexPending,
    getRowId,
  });

  useScrollAnchorMemory({
    ...blocks.scrollAnchorProps,
    ready:
      blocks.placeReady &&
      blocks.liveIds.some((key) => roomsById.has(entryByKey.get(key)?.roomId ?? '')),
  });

  return (
    <div
      ref={scrollRef}
      className={css.ThreadListScroll}
      data-space-threads-list="true"
      data-compact-card-count={blocks.ids.length}
      data-cards-pending={!blocks.extentComplete || undefined}
      tabIndex={-1}
    >
      <CompactCardList ref={contentRef} scrollRef={scrollRef} liveIds={blocks.liveIds}>
        {pinError && (
          <Text role="alert" size="T200">
            {t('thread.pinFailed')}
          </Text>
        )}
        {notice}
        {renderCompactSections({
          sections,
          rows: blocks.rows,
          folded: foldedSections,
          singleBucketTab,
          onToggle: onToggleSectionFold,
          scrollRef,
          renderCard: (key) => renderCard(key, scrollRef),
        })}
      </CompactCardList>
    </div>
  );
}
