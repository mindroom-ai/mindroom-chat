import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {
  DndContext,
  type DragEndEvent,
  type Modifier,
  MouseSensor,
  TouchSensor,
  type TouchSensorOptions,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import classNames from 'classnames';
import { Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { animateSortableLayoutDuringDrag } from '../../lib/sortableDrag';
import { motionAllowed } from '../../ui/listMotion';
import { ThreadStreamingDot } from '../ThreadStreamingDot';
import { useCompactCardSwipeList } from './CompactCardSwipe';
import { SwipeList } from './CompactCardSwipe.css';
import { handleCardArrowKey } from './compactCardKeys';
import { COMPACT_COLUMN_INITIAL_CARDS, mergeVisibleSectionOrder } from './compactColumnsLayout';
import { useCompactColumnDrag } from './useCompactColumnDrag';
import { useCompactColumnMotion } from './useCompactColumnMotion';
import type { CompactThreadSection, CompactThreadSectionId } from './compactThreadSections';
import * as css from './CompactThreadColumns.css';

const DRAG_ACTIVATION_DISTANCE_PX = 6;

const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

const silent = () => undefined;
const silentAnnouncements = {
  onDragStart: silent,
  onDragOver: silent,
  onDragEnd: silent,
  onDragCancel: silent,
};

/** Touch drags start only on the drag grip so wide tablets keep native horizontal board panning. */
class GripTouchSensor extends TouchSensor {
  static override activators = TouchSensor.activators.map((activator) => ({
    ...activator,
    handler: (event: ReactTouchEvent, options: TouchSensorOptions) =>
      event.target instanceof Element &&
      Boolean(event.target.closest('[data-compact-column-drag-grip]')) &&
      activator.handler(event, options),
  }));
}

type CompactColumnSignal = {
  streaming?: boolean;
  unread?: boolean;
};

export const getCompactColumnSignal = (
  { id, rootIds }: CompactThreadSection,
  hasStatus: (key: string, status: 'isStreaming' | 'isUnread') => boolean | undefined
): CompactColumnSignal | undefined => {
  if (id === 'working') return { streaming: rootIds.some((key) => hasStatus(key, 'isStreaming')) };
  if (id === 'needsYou') return { unread: rootIds.some((key) => hasStatus(key, 'isUnread')) };
  return undefined;
};

export type CompactThreadColumnsProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  sections: readonly CompactThreadSection[];
  folded: readonly CompactThreadSectionId[];
  /** Full persisted section order, used to preserve relative positions of hidden empty buckets. */
  fullOrder?: readonly CompactThreadSectionId[];
  /** Controlled per-column progressive card limits owned by `useCompactColumnsBoard`. */
  columnLimits?: ReadonlyMap<CompactThreadSectionId, number>;
  onShowMore?: (id: CompactThreadSectionId) => void;
  scrollTops?: Map<CompactThreadSectionId, number>;
  getCount?: (section: CompactThreadSection) => number;
  getSignal?: (section: CompactThreadSection) => CompactColumnSignal | undefined;
  onToggleFold: (id: CompactThreadSectionId) => void;
  onReorder: (order: CompactThreadSectionId[]) => void;
  renderCard: (id: string, scrollRootRef: RefObject<HTMLDivElement | null>) => ReactNode;
  boardRef?: Ref<HTMLDivElement>;
};

/** Subtle 6-dot drag handle on column headers and collapsed rails. */
function ColumnDragGrip() {
  return (
    <span className={css.DragGrip} data-compact-column-drag-grip="true" aria-hidden="true">
      <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" aria-hidden="true">
        <circle cx="2" cy="2" r="1.1" />
        <circle cx="6" cy="2" r="1.1" />
        <circle cx="2" cy="6" r="1.1" />
        <circle cx="6" cy="6" r="1.1" />
        <circle cx="2" cy="10" r="1.1" />
        <circle cx="6" cy="10" r="1.1" />
      </svg>
    </span>
  );
}

function ColumnSignalDot({
  id,
  signal,
}: {
  id: CompactThreadSectionId;
  signal?: CompactColumnSignal;
}) {
  if (id === 'working' && signal?.streaming) {
    return <ThreadStreamingDot aria-hidden="true" />;
  }
  if (id === 'needsYou' && signal?.unread) {
    return <span className={css.UnreadDot} data-column-unread-dot="true" aria-hidden="true" />;
  }
  return null;
}

function CompactOpenColumnBody({
  section,
  limit,
  onShowMore,
  scrollTops,
  renderCard,
}: {
  section: CompactThreadSection;
  limit: number;
  onShowMore?: (id: CompactThreadSectionId) => void;
  scrollTops?: Map<CompactThreadSectionId, number>;
  renderCard: (id: string, scrollRootRef: RefObject<HTMLDivElement | null>) => ReactNode;
}) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLButtonElement>(null);
  useCompactCardSwipeList(bodyRef);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !scrollTops) return undefined;
    body.scrollTop = scrollTops.get(section.id) ?? 0;
    const onScroll = () => {
      scrollTops.set(section.id, body.scrollTop);
    };
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => body.removeEventListener('scroll', onScroll);
  }, [scrollTops, section.id]);

  const visibleIds = section.rootIds.slice(0, limit);
  const remaining = Math.max(0, section.rootIds.length - visibleIds.length);

  useEffect(() => {
    if (remaining <= 0 || !onShowMore || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const root = bodyRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onShowMore(section.id);
        }
      },
      { root, rootMargin: '200px' }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [onShowMore, remaining, section.id]);

  return (
    <div
      ref={bodyRef}
      className={classNames(SwipeList, css.ColumnBody)}
      data-compact-column-body={section.id}
      onKeyDown={handleCardArrowKey}
    >
      {visibleIds.map((id) => renderCard(id, bodyRef))}
      {remaining > 0 && onShowMore && (
        <button
          ref={sentinelRef}
          type="button"
          className={css.ShowMoreButton}
          data-compact-column-show-more={section.id}
          onClick={() => onShowMore(section.id)}
        >
          <Text size="T200">{t('threadNav.showMoreInColumn', { count: remaining })}</Text>
        </button>
      )}
    </div>
  );
}

type SortableCompactColumnProps = {
  section: CompactThreadSection;
  closed: boolean;
  count: number;
  signal?: CompactColumnSignal;
  limit: number;
  dragDisabled: boolean;
  onShowMore?: (id: CompactThreadSectionId) => void;
  scrollTops?: Map<CompactThreadSectionId, number>;
  setColumnRef: (node: HTMLElement | null) => void;
  onClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  renderCard: (id: string, scrollRootRef: RefObject<HTMLDivElement | null>) => ReactNode;
};

function SortableCompactColumn({
  section,
  closed,
  count,
  signal,
  limit,
  dragDisabled,
  onShowMore,
  scrollTops,
  setColumnRef,
  onClick,
  onKeyDown,
  renderCard,
}: SortableCompactColumnProps) {
  const { t } = useTranslation();
  const { id } = section;
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } =
    useSortable({
      id,
      disabled: dragDisabled,
      animateLayoutChanges: animateSortableLayoutDuringDrag,
    });

  const setRefs = useCallback(
    (node: HTMLElement | null) => {
      setNodeRef(node);
      setColumnRef(node);
    },
    [setColumnRef, setNodeRef]
  );

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: motionAllowed() ? transition : undefined,
  };
  const sectionName = t(`thread.workflow.${id}`);
  const headingText = `${sectionName} · ${count}`;

  return (
    <section
      ref={setRefs}
      style={style}
      className={classNames(css.Column, closed && css.ColumnCollapsed)}
      data-compact-column={id}
      data-collapsed={closed ? 'true' : undefined}
      data-dragging={isDragging ? 'true' : undefined}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className={closed ? css.ColumnRail : css.ColumnHeader}
        data-compact-column-rail={closed ? id : undefined}
        data-compact-column-header={closed ? undefined : id}
        aria-expanded={!closed}
        aria-label={t(closed ? 'threadNav.expandColumn' : 'threadNav.collapseColumn', {
          section: sectionName,
          count,
        })}
        {...listeners}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <span key={String(closed)} className={css.ColumnTriggerSurface} aria-hidden="true" />
        <ColumnDragGrip key={closed ? 'rail' : 'header'} />
        <Icon
          size="100"
          src={closed ? Icons.ChevronRight : Icons.ChevronBottom}
          data-directional={closed ? 'true' : undefined}
          aria-hidden="true"
        />
        {closed && <ColumnSignalDot id={id} signal={signal} />}
        <Text size="B300" className={closed ? css.RailLabel : css.HeaderLabel}>
          {headingText}
        </Text>
        {!closed && (
          <>
            <ColumnSignalDot id={id} signal={signal} />
            <Text size="T200" className={css.FoldCue} aria-hidden="true">
              {t('threadNav.foldColumn')}
            </Text>
          </>
        )}
      </button>
      {!closed && (
        <CompactOpenColumnBody
          section={section}
          limit={limit}
          onShowMore={onShowMore}
          scrollTops={scrollTops}
          renderCard={renderCard}
        />
      )}
    </section>
  );
}

/**
 * Transposed collapsible workflow columns board with 90°-angled collapsed rails, `@dnd-kit`
 * drag-to-reorder (with horizontal auto-scroll), and smooth collapse/expand FLIP glides.
 * Reused by both CompactRoomView and SpaceThreadsList.
 */
export function CompactThreadColumns({
  sections,
  folded,
  fullOrder,
  columnLimits,
  onShowMore,
  scrollTops,
  getCount,
  getSignal,
  onToggleFold,
  onReorder,
  renderCard,
  boardRef,
  className,
  ...rest
}: CompactThreadColumnsProps) {
  const internalBoardRef = useRef<HTMLDivElement>(null);
  const setBoardRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalBoardRef.current = node;
      if (typeof boardRef === 'function') boardRef(node);
      else if (boardRef) (boardRef as { current: HTMLDivElement | null }).current = node;
    },
    [boardRef]
  );

  const sectionIds = useMemo(() => sections.map((section) => section.id), [sections]);
  const foldedSet = useMemo(() => new Set(folded), [folded]);
  const foldedSignature = useMemo(
    () => sectionIds.filter((id) => foldedSet.has(id)).join(','),
    [foldedSet, sectionIds]
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
    useSensor(GripTouchSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } })
  );

  const { rtl, readRtl, handleDragStart, stopPan } = useCompactColumnDrag(internalBoardRef);
  const { setColumnRef, handleHeaderClick, handleHeaderKeyDown } = useCompactColumnMotion({
    boardRef: internalBoardRef,
    readRtl,
    sectionIds,
    fullOrder,
    foldedSignature,
    onToggleFold,
    onReorder,
  });

  // The strategy reads rects left to right; DOM and saved order stay in reading order.
  const sortableIds = useMemo(
    () => (rtl ? [...sectionIds].reverse() : sectionIds),
    [rtl, sectionIds]
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      stopPan();
      if (!over || active.id === over.id) return;
      const from = sectionIds.indexOf(active.id as CompactThreadSectionId);
      const to = sectionIds.indexOf(over.id as CompactThreadSectionId);
      if (from < 0 || to < 0 || from === to) return;
      const nextVisible = arrayMove(sectionIds, from, to);
      onReorder(fullOrder ? mergeVisibleSectionOrder(fullOrder, nextVisible) : nextVisible);
    },
    [fullOrder, onReorder, sectionIds, stopPan]
  );

  const openCount = sections.reduce(
    (count, section) => count + (foldedSet.has(section.id) ? 0 : 1),
    0
  );
  const dragDisabled = sectionIds.length <= 1;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis]}
      accessibility={{ announcements: silentAnnouncements }}
      autoScroll={!rtl}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={stopPan}
    >
      <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
        <div
          ref={setBoardRef}
          className={classNames(css.Board, className)}
          data-compact-columns-board="true"
          data-open-count={openCount}
          {...rest}
        >
          {sections.map((section) => {
            const { id } = section;
            return (
              <SortableCompactColumn
                key={id}
                section={section}
                closed={foldedSet.has(id)}
                count={getCount ? getCount(section) : section.rootIds.length}
                signal={getSignal?.(section)}
                limit={columnLimits?.get(id) ?? COMPACT_COLUMN_INITIAL_CARDS}
                dragDisabled={dragDisabled}
                onShowMore={onShowMore}
                scrollTops={scrollTops}
                setColumnRef={setColumnRef(id)}
                onClick={handleHeaderClick(id)}
                onKeyDown={handleHeaderKeyDown(id)}
                renderCard={renderCard}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
