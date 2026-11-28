import {
  type CSSProperties,
  type FocusEventHandler,
  type PointerEventHandler,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import classNames from 'classnames';
import { Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { ThreadStreamingDot } from '../ThreadStreamingDot';
import { useCompactCardSwipeList } from './CompactCardSwipe';
import { SwipeList } from './CompactCardSwipe.css';
import { handleCardArrowKey } from './compactCardKeys';
import { COMPACT_COLUMN_INITIAL_CARDS } from './compactColumnsLayout';
import { useCompactColumnLimits } from './useCompactColumnsAvailable';
import { useCompactColumnMotion } from './useCompactColumnMotion';
import type { CompactThreadSection, CompactThreadSectionId } from './compactThreadSections';
import * as css from './CompactThreadColumns.css';

export type CompactColumnSignal = {
  streaming?: boolean;
  unread?: boolean;
};

export type CompactThreadColumnsProps = {
  sections: readonly CompactThreadSection[];
  folded: readonly CompactThreadSectionId[];
  /** Full persisted section order, used to preserve relative positions of hidden empty buckets. */
  fullOrder?: readonly CompactThreadSectionId[];
  /** Optional controlled per-column progressive card limits (lifted when parent needs visible IDs). */
  columnLimits?: Readonly<Partial<Record<CompactThreadSectionId, number>>>;
  onShowMore?: (id: CompactThreadSectionId) => void;
  getCount?: (section: CompactThreadSection) => number;
  getSignal?: (section: CompactThreadSection) => CompactColumnSignal | undefined;
  onToggleFold: (id: CompactThreadSectionId) => void;
  onReorder: (order: CompactThreadSectionId[]) => void;
  renderCard: (id: string, scrollRootRef: RefObject<HTMLDivElement | null>) => ReactNode;
  scopeKey?: string;
  className?: string;
  style?: CSSProperties;
  boardRef?: Ref<HTMLDivElement>;
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
  onFocus?: FocusEventHandler<HTMLDivElement>;
  onBlur?: FocusEventHandler<HTMLDivElement>;
  'data-order-held'?: boolean;
};

/** Subtle 6-dot drag handle on column headers and collapsed rails. */
function ColumnDragGrip() {
  return (
    <span className={css.DragGrip} aria-hidden="true">
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
  renderCard,
}: {
  section: CompactThreadSection;
  limit: number;
  onShowMore: (id: CompactThreadSectionId) => void;
  renderCard: (id: string, scrollRootRef: RefObject<HTMLDivElement | null>) => ReactNode;
}) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLButtonElement>(null);
  useCompactCardSwipeList(bodyRef);

  const visibleIds = section.rootIds.slice(0, limit);
  const remaining = Math.max(0, section.rootIds.length - visibleIds.length);

  useEffect(() => {
    if (remaining <= 0 || typeof IntersectionObserver === 'undefined') return undefined;
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
      {remaining > 0 && (
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

/**
 * Transposed collapsible workflow columns board with 90°-angled collapsed rails and smooth FLIP
 * drag-to-reorder. Reused by both CompactRoomView and SpaceThreadsList.
 */
export function CompactThreadColumns({
  sections,
  folded,
  fullOrder,
  columnLimits,
  onShowMore,
  getCount,
  getSignal,
  onToggleFold,
  onReorder,
  renderCard,
  scopeKey = '',
  className,
  style,
  boardRef,
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
  onFocus,
  onBlur,
  'data-order-held': dataOrderHeld,
}: CompactThreadColumnsProps) {
  const { t } = useTranslation();
  const internalBoardRef = useRef<HTMLDivElement>(null);
  const setBoardRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalBoardRef.current = node;
      if (typeof boardRef === 'function') boardRef(node);
      else if (boardRef) (boardRef as { current: HTMLDivElement | null }).current = node;
    },
    [boardRef]
  );

  const internalLimits = useCompactColumnLimits(scopeKey);
  const effectiveLimits = columnLimits ?? internalLimits.limits;
  const effectiveShowMore = onShowMore ?? internalLimits.showMore;

  const sectionById = useMemo(
    () => new Map(sections.map((section) => [section.id, section] as const)),
    [sections]
  );
  const sectionIds = useMemo(() => sections.map((section) => section.id), [sections]);
  const foldedSet = useMemo(() => new Set(folded), [folded]);
  const foldedSignature = useMemo(
    () => sectionIds.filter((id) => foldedSet.has(id)).join(','),
    [foldedSet, sectionIds]
  );

  const {
    effectiveOrder,
    draggingId,
    setColumnRef,
    handleHeaderPointerDown,
    handleHeaderClick,
    handleHeaderKeyDown,
  } = useCompactColumnMotion({
    boardRef: internalBoardRef,
    sectionIds,
    fullOrder,
    foldedSignature,
    onToggleFold,
    onReorder,
  });

  const openCount = effectiveOrder.reduce((count, id) => count + (foldedSet.has(id) ? 0 : 1), 0);

  return (
    <div
      ref={setBoardRef}
      className={classNames(css.Board, className)}
      style={style}
      data-compact-columns-board="true"
      data-open-count={openCount}
      data-order-held={dataOrderHeld || undefined}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {effectiveOrder.map((id) => {
        const section = sectionById.get(id);
        if (!section) return null;
        const closed = foldedSet.has(id);
        const count = getCount ? getCount(section) : section.rootIds.length;
        const signal = getSignal?.(section);
        const sectionName = t(`thread.workflow.${id}`);
        const headingText = `${sectionName} · ${count}`;
        const dragging = draggingId === id;

        return (
          <section
            key={id}
            ref={setColumnRef(id)}
            className={classNames(css.Column, closed && css.ColumnCollapsed)}
            data-compact-column={id}
            data-collapsed={closed ? 'true' : undefined}
            data-dragging={dragging ? 'true' : undefined}
          >
            {closed ? (
              <button
                type="button"
                className={css.ColumnRail}
                data-compact-column-rail={id}
                aria-expanded={false}
                aria-label={t('threadNav.expandColumn', { section: sectionName, count })}
                onPointerDown={handleHeaderPointerDown(id)}
                onClick={handleHeaderClick(id)}
                onKeyDown={handleHeaderKeyDown(id)}
              >
                <ColumnDragGrip />
                <Icon size="100" src={Icons.ChevronRight} data-directional="true" aria-hidden="true" />
                <ColumnSignalDot id={id} signal={signal} />
                <Text size="B300" className={css.RailLabel}>
                  {headingText}
                </Text>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={css.ColumnHeader}
                  data-compact-column-header={id}
                  aria-expanded={true}
                  aria-label={t('threadNav.collapseColumn', { section: sectionName, count })}
                  onPointerDown={handleHeaderPointerDown(id)}
                  onClick={handleHeaderClick(id)}
                  onKeyDown={handleHeaderKeyDown(id)}
                >
                  <ColumnDragGrip />
                  <Icon size="100" src={Icons.ChevronBottom} aria-hidden="true" />
                  <Text size="B300" className={css.HeaderLabel}>
                    {headingText}
                  </Text>
                  <ColumnSignalDot id={id} signal={signal} />
                  <Text size="T200" className={css.FoldCue} aria-hidden="true">
                    {t('threadNav.foldColumn')}
                  </Text>
                </button>
                <CompactOpenColumnBody
                  section={section}
                  limit={effectiveLimits[id] ?? COMPACT_COLUMN_INITIAL_CARDS}
                  onShowMore={effectiveShowMore}
                  renderCard={renderCard}
                />
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
