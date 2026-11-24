import type { MouseEvent, ReactNode, Ref } from 'react';
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
  label: string;
  closeLabel?: string;
  shortcut?: ShortcutId;
  rtl?: boolean;
  onBack: () => void;
  onClose?: () => void;
};

/** Back (or Close for a second thread column) button shared by `ThreadContextBanner` and the tour. */
export function ThreadBannerBackButton({
  phone,
  label,
  closeLabel,
  shortcut,
  rtl = false,
  onBack,
  onClose,
}: ThreadBannerBackButtonProps) {
  if (onClose) {
    const close = closeLabel ?? label;
    return (
      <IconTooltip label={close} align={rtl ? 'End' : 'Start'}>
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            className={toolbarCss.MessageOptionsButton}
            variant="SurfaceVariant"
            fill="None"
            aria-label={close}
            onClick={onClose}
          >
            <Icon src={Icons.Cross} />
          </IconButton>
        )}
      </IconTooltip>
    );
  }
  if (phone) {
    return <PhoneBackButton label={label} onBack={onBack} />;
  }
  // At the banner's start, so its tooltip opens toward the banner, not past it.
  // folds aligns to physical edges, and right-to-left puts the button on the right.
  return (
    <IconTooltip label={label} shortcut={shortcut} align={rtl ? 'End' : 'Start'}>
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          className={toolbarCss.MessageOptionsButton}
          variant="SurfaceVariant"
          fill="None"
          aria-label={label}
          {...shortcutAttributes(shortcut)}
          onClick={onBack}
        >
          <Icon data-directional src={Icons.ArrowLeft} />
        </IconButton>
      )}
    </IconTooltip>
  );
}

export type ThreadBannerActionsProps = {
  before?: ReactNode;
  moreLabel?: string;
  moreButtonRef?: Ref<HTMLButtonElement>;
  canOpenMenu?: boolean;
  menuOpen?: boolean;
  onOpenMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
  showPinButton?: boolean;
  isPinned?: boolean;
  pinLabel?: string;
  pinnedLabel?: string;
  pinDisabled?: boolean;
  onTogglePin?: () => void;
  showResolveButton?: boolean;
  isResolved?: boolean;
  resolveLabel?: string;
  resolveAriaLabel?: string;
  resolveHint?: string;
  resolveShortcut?: ShortcutId;
  resolveDescribedBy?: string;
  resolveDisabled?: boolean;
  onToggleResolve?: () => void;
};

/** Right-side actions (`More`, `Pin`, `Resolve`) shared by `ThreadContextBanner` and the tour. */
export function ThreadBannerActions({
  before,
  moreLabel,
  moreButtonRef,
  canOpenMenu = true,
  menuOpen = false,
  onOpenMenu,
  showPinButton = false,
  isPinned = false,
  pinLabel,
  pinnedLabel,
  pinDisabled = false,
  onTogglePin,
  showResolveButton = !isPinned,
  isResolved = false,
  resolveLabel,
  resolveAriaLabel,
  resolveHint,
  resolveShortcut,
  resolveDescribedBy,
  resolveDisabled = false,
  onToggleResolve,
}: ThreadBannerActionsProps) {
  const { t } = useTranslation();
  const resolvedMoreLabel = moreLabel ?? t('threadActions.more');
  const resolvedPinLabel = pinLabel ?? t(isPinned ? 'threadNav.unpin' : 'threadNav.pin');
  const resolvedPinnedLabel = pinnedLabel ?? t('threadNav.pinned');
  const resolvedResolveLabel = resolveLabel ?? t(isResolved ? 'thread.resolved' : 'thread.resolve');
  const resolvedResolveAriaLabel = resolveAriaLabel ?? resolvedResolveLabel;
  return (
    <Box className={css.RowActions} alignItems="Center" gap="100" shrink="No">
      {before}
      <IconTooltip label={resolvedMoreLabel}>
        {(triggerRef) => (
          <IconButton
            ref={(node: HTMLButtonElement | null) => {
              triggerRef(node);
              if (typeof moreButtonRef === 'function') moreButtonRef(node);
              else if (moreButtonRef && 'current' in moreButtonRef) {
                (moreButtonRef as { current: HTMLButtonElement | null }).current = node;
              }
            }}
            className={toolbarCss.MessageOptionsButton}
            variant="SurfaceVariant"
            fill="None"
            aria-label={resolvedMoreLabel}
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
        <IconTooltip label={resolvedPinLabel}>
          {(triggerRef) => (
            <IconButton
              ref={triggerRef}
              aria-label={resolvedPinLabel}
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
          <Box as="span" role="img" aria-label={resolvedPinnedLabel} title={resolvedPinnedLabel}>
            <Icon src={Icons.Pin} size="100" filled />
          </Box>
        )
      )}
      {showResolveButton && (
        // Resolve is in More, but a resolved status stays visible for readers.
        <IconTooltip label={resolvedResolveLabel} hint={resolveHint} shortcut={resolveShortcut}>
          {(triggerRef) => (
            <IconButton
              ref={triggerRef}
              aria-label={resolvedResolveAriaLabel}
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
