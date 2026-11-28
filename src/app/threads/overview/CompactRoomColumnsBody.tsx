import {
  type ComponentPropsWithoutRef,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { Box, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { CompactThreadCardViewModel, ThreadRecord } from '../../event-store/threads/types';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import * as css from './CompactRoomView.css';
import { findCompactCard } from './compactCardKeys';
import {
  type CompactFocusRequest,
  isCompactFocusRequestOpen,
  meetCompactFocusRequest,
} from './compactFocusRequest';
import { useCompactThreadCardViewModels } from './compactThreadCardViewModel';
import { CompactThreadColumns, getCompactColumnSignal } from './CompactThreadColumns';
import type { CompactThreadSection, CompactThreadSectionId } from './compactThreadSections';
import { useCompactColumnsBoard } from './useCompactColumnsBoard';

export type CompactRoomColumnsBodyProps = {
  room: Room;
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

  // Honor both initial mount `?focusEvent=1` links (including fresh-tab `entryKey: "default"`)
  // and subsequent pushed links while avoiding overrides when returning to saved column scroll.
  const requestKey = focusRequest && `${focusRequest.entryKey ?? ''} ${focusRequest.eventId}`;
  const mountRequestKeyRef = useRef(requestKey);
  const mountRequestHandledRef = useRef(false);
  const isMountRequest = !!focusRequest && requestKey === mountRequestKeyRef.current;
  const isDefaultEntry = !focusRequest?.entryKey || focusRequest.entryKey === 'default';
  const focusRequestActive =
    !!focusRequest &&
    (isMountRequest
      ? !mountRequestHandledRef.current &&
        !(focusRequest.returned && board.hadSavedColumnsOnMount) &&
        (isDefaultEntry || isCompactFocusRequestOpen(memory, focusRequest))
      : !!focusRequest.pushed && isCompactFocusRequestOpen(memory, focusRequest));
  const openFocusEventId =
    focusRequestActive && board.allOpenIds.includes(focusRequest.eventId)
      ? focusRequest.eventId
      : undefined;

  const { visibleIds, revealCard } = board;
  useLayoutEffect(() => {
    if (requestKey !== mountRequestKeyRef.current) mountRequestKeyRef.current = undefined;
    if (!focusRequest || !openFocusEventId) return;
    if (!visibleIds.includes(openFocusEventId)) {
      revealCard(openFocusEventId);
      return;
    }
    const card = findCompactCard(viewRef.current, openFocusEventId);
    if (!card) return;
    card.scrollIntoView?.({ block: 'nearest' });
    if (isMountRequest) mountRequestHandledRef.current = true;
    meetCompactFocusRequest(memory, focusRequest);
  }, [
    focusRequest,
    isMountRequest,
    memory,
    openFocusEventId,
    requestKey,
    revealCard,
    viewRef,
    visibleIds,
  ]);

  const renderModelCard = (id: string, scrollRootRef: RefObject<HTMLDivElement | null>) => {
    const model = modelByRootId.get(id);
    return model ? renderCard(model, scrollRootRef) : null;
  };

  return (
    <Box
      ref={viewRef}
      className={css.ViewColumns}
      data-compact-room-view="true"
      data-compact-card-count={board.allOpenIds.length}
      tabIndex={-1}
    >
      {pinError && (
        <Text role="alert" size="T200">
          {t('thread.pinFailed')}
        </Text>
      )}
      <CompactThreadColumns
        {...boardProps}
        boardRef={board.boardRef}
        sections={sections}
        folded={folded}
        fullOrder={fullOrder}
        columnLimits={board.limits}
        onShowMore={board.showMore}
        scrollTops={board.scrollTops}
        getCount={(section) => sectionCounts.get(section.id) ?? 0}
        getSignal={(section) =>
          getCompactColumnSignal(section, (id, status) => threadRecordMap.get(id)?.status[status])
        }
        onToggleFold={onToggleFold}
        onReorder={onReorder}
        renderCard={renderModelCard}
      />
    </Box>
  );
}
