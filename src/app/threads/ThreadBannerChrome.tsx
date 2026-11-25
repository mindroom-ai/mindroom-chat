import type { MouseEvent, ReactNode, RefObject } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Box, Icon, IconButton, Icons } from 'folds';
import { shortcutAttributes } from '../shortcuts/ShortcutKeys';
import type { ShortcutId } from '../shortcuts/shortcuts';
import { IconTooltip } from '../ui/IconTooltip';
import { PhoneBackButton } from '../ui/page/PhoneBackButton';
import * as toolbarCss from '../messages/styles.css';
import * as css from './ThreadContextBanner.css';

export type ThreadBannerBackButtonProps = {
  phone: boolean;
  shortcut?: ShortcutId;
  onBack: () => void;
  onClose?: () => void;
};

/** Back (or Close for a second thread column) button shared by `ThreadContextBanner` and the tour. */
export function ThreadBannerBackButton({
  phone,
  shortcut,
  onBack,
  onClose,
}: ThreadBannerBackButtonProps) {
  const { t, i18n } = useTranslation();
  if (!onClose && phone) {
    return <PhoneBackButton label={t('thread.back')} onBack={onBack} />;
  }
  const label = t(onClose ? 'thread.close' : 'thread.back');
  const buttonShortcut = onClose ? undefined : shortcut;
  // At the banner's start, so its tooltip opens toward the banner, not past it.
  // folds aligns to physical edges, and right-to-left puts the button on the right.
  return (
    <IconTooltip
      label={label}
      shortcut={buttonShortcut}
      align={i18n.dir() === 'rtl' ? 'End' : 'Start'}
    >
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          className={toolbarCss.MessageOptionsButton}
          variant="SurfaceVariant"
          fill="None"
          aria-label={label}
          {...shortcutAttributes(buttonShortcut)}
          onClick={onClose ?? onBack}
        >
          {onClose ? <Icon src={Icons.Cross} /> : <Icon data-directional src={Icons.ArrowLeft} />}
        </IconButton>
      )}
    </IconTooltip>
  );
}

export type ThreadBannerActionsProps = {
  before?: ReactNode;
  moreButtonRef?: RefObject<HTMLButtonElement | null>;
  canOpenMenu?: boolean;
  menuOpen?: boolean;
  onOpenMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  showPinButton?: boolean;
  isPinned?: boolean;
  pinDisabled?: boolean;
  onTogglePin?: () => void;
  isResolved?: boolean;
  resolvedByLabel?: string;
  resolveHint?: string;
  resolveShortcut?: ShortcutId;
  resolveDescribedBy?: string;
  resolveDisabled?: boolean;
  onToggleResolve?: () => void;
};

/** Right-side actions (`More`, `Pin`, `Resolve`) shared by `ThreadContextBanner` and the tour. */
export function ThreadBannerActions({
  before,
  moreButtonRef,
  canOpenMenu = true,
  menuOpen = false,
  onOpenMenu,
  showPinButton = false,
  isPinned = false,
  pinDisabled = false,
  onTogglePin,
  isResolved = false,
  resolvedByLabel,
  resolveHint,
  resolveShortcut,
  resolveDescribedBy,
  resolveDisabled = false,
  onToggleResolve,
}: ThreadBannerActionsProps) {
  const { t } = useTranslation();
  const moreLabel = t('threadActions.more');
  const pinLabel = t(isPinned ? 'threadNav.unpin' : 'threadNav.pin');
  const pinnedLabel = t('threadNav.pinned');
  const resolveAriaLabel = t(isResolved ? 'thread.resolved' : 'thread.resolve');
  const resolveLabel = isResolved ? (resolvedByLabel ?? resolveAriaLabel) : resolveAriaLabel;
  return (
    <Box className={css.RowActions} alignItems="Center" gap="100" shrink="No">
      {before}
      <IconTooltip label={moreLabel}>
        {(triggerRef) => (
          <IconButton
            ref={(node: HTMLButtonElement | null) => {
              triggerRef(node);
              if (moreButtonRef) moreButtonRef.current = node;
            }}
            className={toolbarCss.MessageOptionsButton}
            variant="SurfaceVariant"
            fill="None"
            aria-label={moreLabel}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={!canOpenMenu}
            onClick={onOpenMenu}
          >
            <Icon src={Icons.VerticalDots} size="100" />
          </IconButton>
        )}
      </IconTooltip>
      {/* A compact banner pins from More; its row still says a thread is pinned. */}
      {showPinButton ? (
        <IconTooltip label={pinLabel}>
          {(triggerRef) => (
            <IconButton
              ref={triggerRef}
              aria-label={pinLabel}
              className={classNames(
                toolbarCss.MessageOptionsButton,
                !isPinned && css.CompactHidden
              )}
              variant="SurfaceVariant"
              fill="None"
              aria-pressed={isPinned}
              disabled={pinDisabled}
              onClick={onTogglePin}
            >
              <Icon src={Icons.Pin} size="100" filled={isPinned} />
            </IconButton>
          )}
        </IconTooltip>
      ) : (
        isPinned && (
          <Box as="span" role="img" aria-label={pinnedLabel} title={pinnedLabel}>
            <Icon src={Icons.Pin} size="100" filled />
          </Box>
        )
      )}
      {!isPinned && (
        // Resolve is in More, but a resolved status stays visible for readers.
        <IconTooltip label={resolveLabel} hint={resolveHint} shortcut={resolveShortcut}>
          {(triggerRef) => (
            <IconButton
              ref={triggerRef}
              aria-label={resolveAriaLabel}
              className={classNames(
                toolbarCss.MessageOptionsButton,
                isResolved ? css.ResolvedButton : css.CompactHidden
              )}
              variant="SurfaceVariant"
              fill="None"
              aria-describedby={resolveDescribedBy}
              onClick={onToggleResolve}
              disabled={resolveDisabled}
              {...shortcutAttributes(resolveShortcut)}
            >
              <Icon src={Icons.Check} size="100" />
            </IconButton>
          )}
        </IconTooltip>
      )}
    </Box>
  );
}
