import {
  Component,
  useCallback,
  useRef,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import { IconTooltip } from '../../ui/IconTooltip';
import { useCompactCardSwipeList } from './CompactCardSwipe';
import { SwipeList } from './CompactCardSwipe.css';
import type { ThreadWorkflowBucket } from '../../event-store/threads/threadWorkflow';
import { handleCardArrowKey, isKeyboardFocus, navigationIn } from './compactCardKeys';
import * as css from './CompactRoomView.css';
import { CompactSectionHeader } from './CompactSectionHeader';
import type { CompactThreadSection, CompactThreadSectionId } from './compactThreadSections';
import type { CompactBlockRow } from './useCompactBlocks';

class CompactHeightGuard extends Component<{
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  liveIds: readonly string[];
}> {
  override getSnapshotBeforeUpdate(prev: CompactHeightGuard['props']): boolean {
    const [view, content] = [this.props.scrollRef.current, this.props.contentRef.current];
    if (!view?.scrollTop || !content || prev.liveIds === this.props.liveIds) return false;
    if (globalThis.CSS?.supports?.('overflow-anchor', 'auto')) return false;
    const height = content.getBoundingClientRect?.().height ?? 0;
    if (height <= 0) return false;
    content.style.minHeight = `${height}px`;
    content.getBoundingClientRect();
    return true;
  }
  override componentDidUpdate(_prev: unknown, _state: unknown, pinned: boolean) {
    if (pinned && this.props.contentRef.current) this.props.contentRef.current.style.minHeight = '';
  }
  override render = () => null;
}

export type CompactCardListProps = ComponentPropsWithoutRef<'div'> & {
  ref?: Ref<HTMLDivElement>;
  scrollRef: RefObject<HTMLDivElement | null>;
  liveIds: readonly string[];
};

/** Shared vertical list container for compact thread cards and flat section headers. */
export function CompactCardList(props: CompactCardListProps) {
  const { ref, className, scrollRef, liveIds, children, ...rest } = props;
  const listRef = useRef<HTMLDivElement>(null);
  useCompactCardSwipeList(listRef);
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as { current: HTMLDivElement | null }).current = node;
    },
    [ref]
  );
  return (
    <Box
      ref={setRef}
      className={classNames(SwipeList, css.Cards, className)}
      direction="Column"
      gap="100"
      shrink="No"
      onKeyDown={handleCardArrowKey}
      {...rest}
    >
      <CompactHeightGuard scrollRef={scrollRef} contentRef={listRef} liveIds={liveIds} />
      {children}
    </Box>
  );
}

function CompactBlockSpacer(props: {
  row: Exclude<CompactBlockRow, string>;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const { row, scrollRef } = props;
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={t('threadNav.moreThreads', { count: row.ids.length })}
      data-compact-spacer={row.key}
      className={css.Spacer}
      style={{ height: row.height }}
      onClick={() => navigationIn(scrollRef.current)?.focus(row.ids[0])}
      onFocus={({ currentTarget: spacer, relatedTarget: from }) => {
        const below =
          from && spacer.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING;
        if (isKeyboardFocus(spacer))
          navigationIn(scrollRef.current)?.focus(row.ids.at(below ? -1 : 0), !!below);
      }}
    />
  );
}

export const renderCompactBlockRow = (
  row: CompactBlockRow,
  scrollRef: RefObject<HTMLElement | null>,
  renderCard: (id: string) => ReactNode
): ReactNode =>
  typeof row === 'string' ? (
    renderCard(row)
  ) : (
    <CompactBlockSpacer key={`spacer:${row.key}`} row={row} scrollRef={scrollRef} />
  );

export const sectionBlockGroups = (
  sections: readonly CompactThreadSection[],
  folded: readonly CompactThreadSectionId[],
  singleBucketTab?: ThreadWorkflowBucket
): Record<string, string[]> =>
  Object.fromEntries(
    sections.map(({ id, rootIds }) => [
      id,
      id !== singleBucketTab && folded.includes(id) ? [] : [...rootIds],
    ])
  );

export const renderCompactSections = (p: {
  sections?: readonly CompactThreadSection[];
  rows: readonly (readonly CompactBlockRow[])[];
  folded: readonly CompactThreadSectionId[];
  singleBucketTab?: ThreadWorkflowBucket;
  onToggle: (id: CompactThreadSectionId) => void;
  scrollRef: RefObject<HTMLElement | null>;
  renderCard: (id: string) => ReactNode;
  getCount?: (section: CompactThreadSection) => number;
  motionKey?: (id: CompactThreadSectionId) => string;
}): ReactNode[] =>
  p.rows.flatMap((groupRows, index) => {
    const section = p.sections?.[index];
    const header = section && (
      <CompactSectionHeader
        key={`section:${section.id}`}
        id={section.id}
        count={p.getCount ? p.getCount(section) : section.rootIds.length}
        closed={section.id !== p.singleBucketTab && p.folded.includes(section.id)}
        fixedOpen={section.id === p.singleBucketTab}
        onToggle={p.onToggle}
        motionRow={p.motionKey?.(section.id)}
      />
    );
    const cards = groupRows.map((row) => renderCompactBlockRow(row, p.scrollRef, p.renderCard));
    return header ? [header, ...cards] : cards;
  });

export type CompactCardActionsProps = {
  pinned: boolean;
  showResolveAction: boolean;
  showPinAction: boolean;
  actionsDisabled?: boolean;
  menuOpen?: boolean;
  onResolve?: () => void;
  onPin?: () => void;
  onOpenMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
};

/** Hover quick actions (Resolve, Pin) and Thread options button on a compact thread card. */
export function CompactCardActions({
  pinned,
  showResolveAction,
  showPinAction,
  actionsDisabled = false,
  menuOpen = false,
  onResolve,
  onPin,
  onOpenMenu,
}: CompactCardActionsProps) {
  const { t } = useTranslation();
  const resolveLabel = t('thread.resolve');
  const pinLabel = t(pinned ? 'threadNav.unpin' : 'threadNav.pin');
  const moreLabel = t('threadActions.more');
  return (
    <div className={css.CardAction}>
      {showResolveAction && (
        <IconTooltip label={resolveLabel} position="Top">
          {(triggerRef) => (
            <IconButton
              ref={triggerRef}
              className={css.CardQuickAction}
              type="button"
              size="300"
              variant="Secondary"
              fill="None"
              radii="300"
              aria-label={resolveLabel}
              disabled={actionsDisabled}
              onClick={onResolve}
              data-compact-thread-resolve="true"
            >
              <Icon size="100" src={Icons.Check} />
            </IconButton>
          )}
        </IconTooltip>
      )}
      {showPinAction && (
        <IconTooltip label={pinLabel} position="Top">
          {(triggerRef) => (
            <IconButton
              ref={triggerRef}
              className={css.CardQuickAction}
              type="button"
              size="300"
              variant="Secondary"
              fill="None"
              radii="300"
              aria-label={pinLabel}
              disabled={actionsDisabled}
              onClick={onPin}
              data-compact-thread-pin="true"
            >
              <Icon size="100" src={Icons.Pin} filled={pinned} />
            </IconButton>
          )}
        </IconTooltip>
      )}
      <IconTooltip label={moreLabel} position="Top">
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            className={css.CardMenuButton}
            type="button"
            size="300"
            variant="Secondary"
            fill="None"
            radii="300"
            aria-label={moreLabel}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={onOpenMenu}
            data-compact-thread-more="true"
          >
            <Icon size="100" src={Icons.HorizontalDots} />
          </IconButton>
        )}
      </IconTooltip>
    </div>
  );
}

export type PinnedThreadsSectionProps = ComponentPropsWithoutRef<'section'> & {
  children: ReactNode;
};

/** The Pinned section heading and container above the rest of a room's compact thread cards. */
export function PinnedThreadsSection({ children, className, ...props }: PinnedThreadsSectionProps) {
  const { t } = useTranslation();
  const heading = t('threadNav.pinned');
  return (
    <Box
      as="section"
      direction="Column"
      gap="100"
      className={classNames(css.PinnedSection, className)}
      aria-label={heading}
      data-pinned-threads="true"
      {...props}
    >
      <Box alignItems="Center" gap="100">
        <Icon src={Icons.Pin} size="100" />
        <Text as="h2" size="L400">
          {heading}
        </Text>
      </Box>
      {children}
    </Box>
  );
}
