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
import type { ThreadWorkflowBucket } from '../../event-store/threads/threadWorkflow';
import type { CompactThreadCardViewModel, ThreadRecord } from '../../event-store/threads/types';
import { InsetScrollbar } from '../../ui/InsetScrollbar';
import { MOST_ROWS_IN_MOTION, useListMotion } from '../../ui/listMotion';
import { type ScrollAnchorMemory, useScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { CompactRoomEmptyState, type CompactRoomEmptyStateConfig } from './CompactRoomEmptyState';
import * as css from './CompactRoomView.css';
import {
  CompactCardList,
  PinnedThreadsSection,
  renderCompactBlockRow,
  renderCompactSections,
} from './CompactThreadCardChrome';
import {
  type CompactFocusRequest,
  compactFocusPlace,
  isCompactFocusRequestOpen,
  meetCompactFocusRequest,
} from './compactFocusRequest';
import { useCompactThreadCardViewModels } from './compactThreadCardViewModel';
import type { CompactThreadSection, CompactThreadSectionId } from './compactThreadSections';
import { useCompactScrollFallback } from './useCompactScrollFallback';
import { useVirtualCompactList } from './useVirtualCompactList';

export type CompactRoomVerticalBodyProps = {
  room: Room;
  groups: Record<string, string[]>;
  heldSections: CompactThreadSection[] | undefined;
  folded: CompactThreadSectionId[];
  singleBucketTab: ThreadWorkflowBucket | undefined;
  sectionCounts: ReadonlyMap<CompactThreadSectionId, number>;
  shownRows: string[];
  pinnedRootIds: string[];
  threadRootIds: string[];
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
  memory: ScrollAnchorMemory;
  focusRequest?: CompactFocusRequest;
  focusScope?: string;
  filterBarShown: boolean;
  indexPending?: boolean;
  unreachable: boolean;
  menuProtectedId?: string;
  pinError: boolean;
  emptyState?: CompactRoomEmptyStateConfig;
  canToggle: boolean;
  updatingThreadRootIds: ReadonlySet<string>;
  viewModelByRootRef: MutableRefObject<ReadonlyMap<string, CompactThreadCardViewModel>>;
  listProps: Omit<ComponentPropsWithoutRef<'div'>, 'children'>;
  scrollbarClassName: string;
  sectionRowKey: (id: CompactThreadSectionId) => string;
  sectionOfRow: (key: string) => CompactThreadSectionId | undefined;
  onToggleFold: (id: CompactThreadSectionId) => void;
  onThreadClick: (threadRootId: string, summaryText?: string) => void;
  onSetResolved: (threadRootId: string, resolved: boolean) => void;
  onRestoreFocus: () => void;
  renderCard: (
    viewModel: CompactThreadCardViewModel,
    scrollRootRef: RefObject<HTMLDivElement | null>
  ) => ReactNode;
};

/** Vertical virtualized list body, mounted exclusively when Columns mode is inactive. */
export function CompactRoomVerticalBody({
  room,
  groups,
  heldSections,
  folded,
  singleBucketTab,
  sectionCounts,
  shownRows,
  pinnedRootIds,
  threadRootIds,
  threadRecordMap,
  memory,
  focusRequest,
  focusScope,
  filterBarShown,
  indexPending,
  unreachable,
  menuProtectedId,
  pinError,
  emptyState,
  canToggle,
  updatingThreadRootIds,
  viewModelByRootRef,
  listProps,
  scrollbarClassName,
  sectionRowKey,
  sectionOfRow,
  onToggleFold,
  onThreadClick,
  onSetResolved,
  onRestoreFocus,
  renderCard,
}: CompactRoomVerticalBodyProps) {
  const { t } = useTranslation();
  const viewRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { roomId } = room;

  useCompactScrollFallback(shownRows, viewRef, sectionOfRow);
  const requestKey = focusRequest && `${focusRequest.entryKey ?? ''} ${focusRequest.eventId}`;
  const mountRequestKeyRef = useRef(requestKey);
  const placing = useRef<string>(undefined);
  const asked = useRef<[key?: string, top?: number, input?: number]>([]);
  const pushed =
    focusRequest?.pushed &&
    requestKey !== mountRequestKeyRef.current &&
    isCompactFocusRequestOpen(memory, focusRequest);
  // One destination owns the window: the address while its card is in the shown order (one in a
  // folded section or outside the filter is not), else the card the keys go to.
  const address =
    !!pushed && Object.values(groups).some((group) => group.includes(focusRequest.eventId));
  const blocks = useVirtualCompactList({
    groups,
    scrollRef: viewRef,
    contentRef,
    memory,
    roomId,
    keyScope: `${roomId}|${requestKey ?? ''}|${focusScope ?? ''}`,
    target: address ? focusRequest.eventId : undefined,
    protectedId: menuProtectedId,
    records: threadRecordMap,
    // A read the homeserver cannot answer only retries: the list places on the cards it has.
    indexPending: indexPending && !unreachable,
  });
  const cardViewModels = useCompactThreadCardViewModels({
    room,
    threadRootIds: blocks.liveIds,
    threadRecordMap,
  });
  const modelByRootId = useMemo(
    () => new Map(cardViewModels.map((model) => [model.id.threadRootId, model])),
    [cardViewModels]
  );

  useLayoutEffect(() => {
    viewModelByRootRef.current = modelByRootId;
  }, [modelByRootId, viewModelByRootRef]);

  // Discovery changes mounts, not the logical order that drives motion.
  const listMotion = useListMotion(
    contentRef,
    shownRows.length > MOST_ROWS_IN_MOTION
      ? undefined
      : `${filterBarShown}|${shownRows.join(',')}|${pinnedRootIds.join(',')}`
  );

  // Opening a card remounts this view, and threads that got replies meanwhile
  // sort above the cards that were in view, so restore by those cards.
  const placeList = useScrollAnchorMemory({
    ...blocks.scrollAnchorProps,
    ready: cardViewModels.length > 0 && blocks.placeReady,
  });

  // A link followed to the mounted list (a pin's) places its card once the card shows, as a mount
  // with that request does; the one the list mounted with had that mount. A replaced entry (a
  // thread beside the list closing) or a step back or forward leaves the list where it is.
  const focusShown =
    (address ? blocks.targetReady : blocks.placeReady) &&
    !!focusRequest &&
    modelByRootId.has(focusRequest.eventId);
  useLayoutEffect(() => {
    if (requestKey !== mountRequestKeyRef.current) mountRequestKeyRef.current = undefined;
    const view = viewRef.current;
    const now = [view?.scrollTop, blocks.progress.input] as const;
    if (address && asked.current[0] !== requestKey) asked.current = [requestKey, ...now];
    if (!focusRequest || !focusShown) return;
    // A newer address retires a Back that still waits; a reader whose input scrolled it stays.
    if (address) blocks.retireBack();
    const stayed = now.some((value, i) => value === asked.current[i + 1]);
    const place = pushed && view && stayed && compactFocusPlace(focusRequest, view);
    if (place && placing.current !== requestKey) {
      placing.current = requestKey;
      placeList(place);
    } else {
      placing.current = undefined;
      meetCompactFocusRequest(memory, focusRequest);
    }
  });

  const renderModelCard = (id: string) => {
    const model = modelByRootId.get(id);
    return model ? renderCard(model, viewRef) : null;
  };
  const showRichEmptyState =
    threadRootIds.length === 0 && emptyState !== undefined && threadRecordMap.size > 0;

  return (
    <Box
      ref={viewRef}
      className={css.View}
      data-compact-room-view="true"
      // For e2e: the cards the list has, which is more than it mounts.
      data-compact-card-count={blocks.ids.length}
      data-cards-pending={!blocks.extentComplete || undefined}
      tabIndex={-1}
    >
      <CompactCardList
        ref={contentRef}
        scrollRef={viewRef}
        liveIds={blocks.liveIds}
        className={showRichEmptyState ? css.CardsEmpty : undefined}
        {...listProps}
      >
        {listMotion}
        {pinError && (
          <Text role="alert" size="T200">
            {t('thread.pinFailed')}
          </Text>
        )}
        {!!groups.pinned?.length && (
          <PinnedThreadsSection>
            {blocks.rows[0]?.map((row) => renderCompactBlockRow(row, viewRef, renderModelCard))}
          </PinnedThreadsSection>
        )}
        {threadRootIds.length === 0 ? (
          showRichEmptyState ? (
            <CompactRoomEmptyState
              room={room}
              threadRecordMap={threadRecordMap}
              filterState={emptyState.filterState}
              now={emptyState.now}
              canCompose={emptyState.canCompose}
              indexPending={indexPending && !unreachable}
              canToggle={canToggle}
              updatingThreadRootIds={updatingThreadRootIds}
              onThreadClick={onThreadClick}
              onSetResolved={onSetResolved}
              onReset={emptyState.onReset}
              onToggleForMe={emptyState.onToggleForMe}
              onShowSnoozed={emptyState.onShowSnoozed}
              onRestoreFocus={onRestoreFocus}
            />
          ) : (
            <Box className={css.EmptyState}>
              <Text size="T300" priority="300">
                {t('mindroomUi.threads.compactRoomView.noThreads')}
              </Text>
            </Box>
          )
        ) : (
          renderCompactSections({
            sections: heldSections,
            rows: blocks.rows.slice(1),
            folded,
            singleBucketTab,
            onToggle: onToggleFold,
            scrollRef: viewRef,
            renderCard: renderModelCard,
            getCount: (section) => sectionCounts.get(section.id) ?? 0,
            motionKey: sectionRowKey,
          })
        )}
      </CompactCardList>
      <InsetScrollbar
        scrollRef={viewRef}
        contentRef={contentRef}
        className={scrollbarClassName}
        label={t('threadNav.messages')}
        beforeEnd={blocks.extentComplete ? blocks.prepareEnd : undefined}
      />
    </Box>
  );
}
