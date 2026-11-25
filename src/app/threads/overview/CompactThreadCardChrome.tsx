import type { ComponentPropsWithoutRef, MouseEvent, ReactNode } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import { IconTooltip } from '../../ui/IconTooltip';
import * as css from './CompactRoomView.css';

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
