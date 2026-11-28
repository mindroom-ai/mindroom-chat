import { type ReactNode, type RefObject, useCallback, useRef } from 'react';
import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { CrossRoomThreadIndexEntry } from '../../threads/cross-room/crossRoomThreadIndex';
import {
  CompactThreadColumns,
  type CompactColumnSignal,
} from '../../threads/overview/CompactThreadColumns';
import type {
  CompactThreadSection,
  CompactThreadSectionId,
} from '../../threads/overview/compactThreadSections';
import { useCompactColumnsBoard } from '../../threads/overview/useCompactColumnsBoard';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import * as css from './SpaceThreads.css';

const NOOP_REORDER = () => undefined;

export type SpaceThreadsColumnsBodyProps = {
  cardCount: number;
  sections: readonly CompactThreadSection[];
  foldedSections: readonly CompactThreadSectionId[];
  sectionOrder?: readonly CompactThreadSectionId[];
  entryByKey: ReadonlyMap<string, CrossRoomThreadIndexEntry>;
  scrollMemory: ScrollAnchorMemory;
  scrollMemoryKey: string;
  pinError: boolean;
  cardIdOf: (card: HTMLElement) => string | undefined;
  onToggleSectionFold: (id: CompactThreadSectionId) => void;
  onReorderSections?: (order: CompactThreadSectionId[]) => void;
  renderCard: (key: string, rowScrollRef: RefObject<HTMLDivElement | null>) => ReactNode;
};

/**
 * Columns-mode body for SpaceThreadsList. Mounted exclusively while Columns mode is active so
 * `useVirtualCompactList` never observes or measures cards inside the multi-column board.
 */
export function SpaceThreadsColumnsBody({
  cardCount,
  sections,
  foldedSections,
  sectionOrder,
  entryByKey,
  scrollMemory,
  scrollMemoryKey,
  pinError,
  cardIdOf,
  onToggleSectionFold,
  onReorderSections,
  renderCard,
}: SpaceThreadsColumnsBodyProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const board = useCompactColumnsBoard({
    viewRef: scrollRef,
    scopeKey: scrollMemoryKey,
    sections,
    folded: foldedSections,
    scrollMemory,
    idOf: cardIdOf,
  });

  const getSignal = useCallback(
    (section: CompactThreadSection): CompactColumnSignal | undefined => {
      if (section.id === 'working') {
        return {
          streaming: section.rootIds.some(
            (key) => entryByKey.get(key)?.threadRecord.status.isStreaming === true
          ),
        };
      }
      if (section.id === 'needsYou') {
        return {
          unread: section.rootIds.some((key) => {
            const entry = entryByKey.get(key);
            return Boolean(entry?.isUnread || entry?.threadRecord.status.isUnread);
          }),
        };
      }
      return undefined;
    },
    [entryByKey]
  );

  return (
    <div
      ref={scrollRef}
      className={css.ThreadListColumns}
      data-space-threads-list="true"
      data-compact-card-count={cardCount}
      tabIndex={-1}
    >
      {pinError && (
        <Text role="alert" size="T200">
          {t('thread.pinFailed')}
        </Text>
      )}
      <CompactThreadColumns
        sections={sections}
        folded={foldedSections}
        fullOrder={sectionOrder}
        columnLimits={board.limits}
        onShowMore={board.showMore}
        columnStates={board.columnStates}
        scrollScopeKey={scrollMemoryKey}
        getSignal={getSignal}
        onToggleFold={onToggleSectionFold}
        onReorder={onReorderSections ?? NOOP_REORDER}
        renderCard={renderCard}
      />
    </div>
  );
}
