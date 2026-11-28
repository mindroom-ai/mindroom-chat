import {
  type ComponentPropsWithoutRef,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { Box, Text } from 'folds';
import * as css from './CompactRoomView.css';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { CompactThreadCardViewModel, ThreadRecord } from '../../event-store/threads/types';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { findCompactCard } from './compactCardKeys';
import {
  type CompactFocusRequest,
  isCompactFocusRequestOpen,
  meetCompactFocusRequest,
} from './compactFocusRequest';
import { useCompactThreadCardViewModels } from './compactThreadCardViewModel';
import { CompactThreadColumns, type CompactColumnSignal } from './CompactThreadColumns';
import type { CompactThreadSection, CompactThreadSectionId } from './compactThreadSections';
import { useCompactColumnsBoard } from './useCompactColumnsBoard';

export type CompactRoomColumnsBodyProps = {
  room: Room;
  cardCount: number;
  sections: readonly CompactThreadSection[];
  folded: readonly CompactThreadSectionId[];
  fullOrder: readonly CompactThreadSectionId[];
  sectionCounts: ReadonlyMap<CompactThreadSectionId, number>;
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  memory: ScrollAnchorMemory;
  focusRequest?: CompactFocusRequest;
  pinError: boolean;
  viewModelByRootRef: MutableRefObject<ReadonlyMap<string, CompactThreadCardViewModel>>;
  boardProps: Omit<ComponentPropsWithoutRef<'div'>, 'children'>;
  onToggleFold: (id: CompactThreadSectionId) => void;
  onReorder: (order: CompactThreadSectionId[]) => void;
  renderCard: (
    viewModel: CompactThreadCardViewModel,
    scrollRootRef: RefObject<HTMLDivElement | null>
  ) => ReactNode;
};

/**
 * Columns-mode body for CompactRoomView. Mounted exclusively while Columns mode is active so
 * the vertical virtualizer (`useVirtualCompactList`) never runs against the multi-column DOM.
 */
export function CompactRoomColumnsBody({
  room,
  cardCount,
  sections,
  folded,
  fullOrder,
  sectionCounts,
  threadRecordMap,
  memory,
  focusRequest,
  pinError,
  viewModelByRootRef,
  boardProps,
  onToggleFold,
  onReorder,
  renderCard,
}: CompactRoomColumnsBodyProps) {
  const { t } = useTranslation();
  const viewRef = useRef<HTMLDivElement>(null);
  const board = useCompactColumnsBoard({
    viewRef,
    scopeKey: room.roomId,
    sections,
    folded,
    scrollMemory: memory,
  });
  const cardViewModels = useCompactThreadCardViewModels({
    room,
    threadRootIds: board.visibleIds,
    threadRecordMap,
  });
  const modelByRootId = useMemo(
    () => new Map(cardViewModels.map((model) => [model.id.threadRootId, model])),
    [cardViewModels]
  );

  useLayoutEffect(() => {
    viewModelByRootRef.current = modelByRootId;
  }, [modelByRootId, viewModelByRootRef]);

  // Deep-link reveal: if `focusRequest` targets a card in an open column, expand that column's
  // progressive cap to include it, scroll it into view inside its column body, and mark it met.
  const openFocusEventId =
    focusRequest &&
    isCompactFocusRequestOpen(memory, focusRequest) &&
    board.allOpenIds.includes(focusRequest.eventId)
      ? focusRequest.eventId
      : undefined;
  const { visibleIds, revealCard } = board;
  useLayoutEffect(() => {
    if (!focusRequest || !openFocusEventId) return;
    if (!visibleIds.includes(openFocusEventId)) {
      revealCard(openFocusEventId);
      return;
    }
    const card = findCompactCard(viewRef.current, openFocusEventId);
    if (!card) return;
    card.scrollIntoView?.({ block: 'nearest' });
    meetCompactFocusRequest(memory, focusRequest);
  }, [focusRequest, memory, openFocusEventId, revealCard, viewRef, visibleIds]);

  const getSignal = useCallback(
    (section: CompactThreadSection): CompactColumnSignal | undefined => {
      if (section.id === 'working') {
        return {
          streaming: section.rootIds.some(
            (id) => threadRecordMap.get(id)?.status.isStreaming === true
          ),
        };
      }
      if (section.id === 'needsYou') {
        return {
          unread: section.rootIds.some((id) => threadRecordMap.get(id)?.status.isUnread === true),
        };
      }
      return undefined;
    },
    [threadRecordMap]
  );

  const renderModelCard = (id: string, scrollRootRef: RefObject<HTMLDivElement | null>) => {
    const model = modelByRootId.get(id);
    return model ? renderCard(model, scrollRootRef) : null;
  };

  return (
    <Box
      ref={viewRef}
      className={css.ViewColumns}
      data-compact-room-view="true"
      data-compact-card-count={cardCount}
      tabIndex={-1}
    >
      {pinError && (
        <Text role="alert" size="T200">
          {t('thread.pinFailed')}
        </Text>
      )}
      <CompactThreadColumns
        {...boardProps}
        sections={sections}
        folded={folded}
        fullOrder={fullOrder}
        columnLimits={board.limits}
        onShowMore={board.showMore}
        scrollPositions={board.scrollPositions}
        scrollScopeKey={room.roomId}
        getCount={(section) => sectionCounts.get(section.id) ?? 0}
        getSignal={getSignal}
        onToggleFold={onToggleFold}
        onReorder={onReorder}
        renderCard={renderModelCard}
      />
    </Box>
  );
}
