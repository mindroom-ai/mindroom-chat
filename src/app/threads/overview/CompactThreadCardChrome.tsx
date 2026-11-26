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
import { isKeyboardFocus, navigationIn } from './compactCardKeys';
import * as css from './CompactRoomView.css';
import type { CompactBlockRow } from './useCompactBlocks';

export type CompactCardListProps = ComponentPropsWithoutRef<'div'> & {
  ref?: Ref<HTMLDivElement>;
};

/** Shared vertical list container for compact thread cards and flat section headers. */
export function CompactCardList({ ref, className, ...props }: CompactCardListProps) {
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
      {...props}
    />
  );
}

type CompactHeightGuardProps = {
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  liveIds: readonly string[];
};

/** Pins list height across React mutations on WebKit so replacing blocks does not clamp scrollTop. */
export class CompactHeightGuard extends Component<CompactHeightGuardProps> {
  override getSnapshotBeforeUpdate(prev: CompactHeightGuardProps): boolean {
    const [view, content] = [this.props.scrollRef.current, this.props.contentRef.current];
    if (!view?.scrollTop || !content || prev.liveIds === this.props.liveIds) return false;
    if (globalThis.CSS?.supports?.('overflow-anchor', 'auto')) return false;
    const height = content.getBoundingClientRect?.().height ?? 0;
    if (height <= 0) return false;
    content.style.minHeight = `${height}px`;
    content.getBoundingClientRect();
    return true;
  }

  override componentDidUpdate(_prev: CompactHeightGuardProps, _state: unknown, pinned: boolean) {
    if (pinned && this.props.contentRef.current) this.props.contentRef.current.style.minHeight = '';
  }

  override render = () => null;
}

export type CompactBlockSpacerProps = {
  row: Exclude<CompactBlockRow, string>;
  scrollRef: RefObject<HTMLElement | null>;
};

/** Accessible Tab stop and height placeholder for offscreen virtualized compact card blocks. */
export function CompactBlockSpacer({ row, scrollRef }: CompactBlockSpacerProps) {
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

/** Renders one virtualized compact block row: either a card via `renderCard` or a spacer button. */
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
