import { Fragment, type CSSProperties, type ReactNode, type Ref } from 'react';
import classNames from 'classnames';
import { Icons, Line, config, toRem, type IconSrc } from 'folds';
import type { TFunction } from 'i18next';
import { Menu } from '../ui/glass/GlassPrimitives';
import { MenuEntry, MenuGroup, MenuSwitchEntry } from '../ui/MenuEntry';
import type { ShortcutId } from '../shortcuts/shortcuts';
import * as css from './ThreadActionsMenu.css';

export type ThreadActionMenuItem = {
  action: string;
  label: string;
  icon: IconSrc;
  onSelect: () => void;
  /** Resolve, snooze and pin wait for the previous save. */
  mutates?: boolean;
  shortcut?: ShortcutId;
  /** A switch: checked while on; toggles in place without closing the menu. */
  checked?: boolean;
};

export type ThreadActionMenuGroup = {
  id: string;
  label?: string;
  items: readonly ThreadActionMenuItem[];
};

// As the original's thread menu measures: at least 220px wide, with the banner's 12px corners. A
// screen narrower than that at a large Page Zoom (320px at 150%) keeps a 0.5rem margin on each side.
const threadActionsMenuStyle: CSSProperties = {
  minWidth: `min(${toRem(220)}, calc(100vw - 1rem))`,
  maxWidth: 'calc(100vw - 1rem)',
  borderRadius: config.radii.R500,
};

export type ThreadActionMenuGroupsOptions = {
  t: TFunction;
  /** Card-only open actions (Open thread, Open beside). */
  openItems?: readonly ThreadActionMenuItem[];
  showTags: boolean;
  tagsEditable?: boolean;
  canSummarize: boolean;
  includeRegenerate?: boolean;
  canEditState: boolean;
  canPin: boolean;
  pinned: boolean;
  isResolved: boolean;
  snoozed: boolean;
  resolveShortcut?: ShortcutId;
  /** Open-thread fork actions (Fork thread, Fork to room). */
  forkItems?: readonly ThreadActionMenuItem[];
  /** When defined, adds the Show Tool Calls switch under View. */
  showToolCalls?: boolean;
  /** Additional View actions (Show beside, Show in full, Hide details). */
  viewItems?: readonly ThreadActionMenuItem[];
  onTags?: () => void;
  onEditSummary?: () => void;
  onRegenerate?: () => void;
  onResolve?: () => void;
  onSnooze?: () => void;
  onPin?: () => void;
  onCopy?: () => void;
  onToggleToolCalls?: () => void;
};

const noop = () => undefined;

/**
 * Builds the Thread options menu groups in canonical order: open (card menu) and triage (resolve,
 * snooze, pin) unlabelled on top, followed by Details (tags, summary), Fork & Share / Share (fork,
 * copy link), and View (tool calls switch, layout, hide details). Shared by `ThreadActionsMenu`
 * and the interface tour.
 */
export function buildThreadActionMenuGroups({
  t,
  openItems = [],
  showTags,
  tagsEditable = true,
  canSummarize,
  includeRegenerate = true,
  canEditState,
  canPin,
  pinned,
  isResolved,
  snoozed,
  resolveShortcut,
  forkItems = [],
  showToolCalls,
  viewItems = [],
  onTags,
  onEditSummary,
  onRegenerate,
  onResolve,
  onSnooze,
  onPin,
  onCopy,
  onToggleToolCalls,
}: ThreadActionMenuGroupsOptions): ThreadActionMenuGroup[] {
  const triageItems: ThreadActionMenuItem[] = [];
  if (canEditState && !pinned) {
    triageItems.push({
      action: 'resolve',
      mutates: true,
      label: isResolved ? t('threadActions.reopen') : t('thread.resolve'),
      icon: isResolved ? Icons.Reload : Icons.CheckTwice,
      shortcut: resolveShortcut,
      onSelect: onResolve ?? noop,
    });
  }
  // A resolved thread shows as resolved whether snoozed or not, so it offers neither. A pinned
  // thread takes no new snooze, but one set before the pin can still be lifted.
  if (canEditState && !isResolved && (snoozed || !pinned)) {
    triageItems.push({
      action: 'snooze',
      mutates: true,
      label: snoozed ? t('thread.unsnooze') : t('thread.snooze'),
      icon: Icons.Clock,
      onSelect: onSnooze ?? noop,
    });
  }
  if (canPin) {
    triageItems.push({
      action: 'pin',
      mutates: true,
      label: pinned ? t('threadNav.unpin') : t('threadNav.pin'),
      icon: Icons.Pin,
      onSelect: onPin ?? noop,
    });
  }

  const detailsItems: ThreadActionMenuItem[] = [];
  if (showTags) {
    detailsItems.push({
      action: 'tags',
      label: tagsEditable ? t('threadActions.tags') : t('thread.stats.tags'),
      icon: Icons.Bookmark,
      onSelect: onTags ?? noop,
    });
  }
  if (canSummarize) {
    detailsItems.push({
      action: 'editSummary',
      label: t('threadActions.editSummary'),
      icon: Icons.Pencil,
      onSelect: onEditSummary ?? noop,
    });
    if (includeRegenerate) {
      detailsItems.push({
        action: 'regenerate',
        label: t('threadActions.regenerate'),
        icon: Icons.Bulb,
        onSelect: onRegenerate ?? noop,
      });
    }
  }

  const shareItems: ThreadActionMenuItem[] = [
    ...forkItems,
    {
      action: 'copy',
      label: t('threadActions.copy'),
      icon: Icons.Link,
      onSelect: onCopy ?? noop,
    },
  ];

  const resolvedViewItems: ThreadActionMenuItem[] = [];
  if (showToolCalls !== undefined) {
    resolvedViewItems.push({
      action: 'toolCalls',
      label: t('mindroomUi.messages.showToolCalls'),
      icon: Icons.Terminal,
      checked: showToolCalls,
      onSelect: onToggleToolCalls ?? noop,
    });
  }
  resolvedViewItems.push(...viewItems);

  const hasForkAction = shareItems.some(
    (item) => item.action === 'fork' || item.action === 'forkToRoom'
  );
  return [
    { id: 'open', items: openItems },
    { id: 'triage', items: triageItems },
    { id: 'details', label: t('threadActions.detailsSection'), items: detailsItems },
    {
      id: 'share',
      label: hasForkAction
        ? t('threadActions.forkAndShareSection')
        : t('threadActions.shareSection'),
      items: shareItems,
    },
    { id: 'view', label: t('threadActions.viewSection'), items: resolvedViewItems },
  ].filter((group) => group.items.length > 0);
}

export type ThreadActionsMenuContentProps = {
  label: string;
  groups: readonly ThreadActionMenuGroup[];
  before?: ReactNode;
  saving?: boolean;
  ariaDescribedBy?: string;
  className?: string;
  ref?: Ref<HTMLDivElement>;
};

/** Pure presentational Thread options menu shared by `ThreadActionsMenu` and the interface tour. */
export function ThreadActionsMenuContent({
  label,
  groups,
  before,
  saving = false,
  ariaDescribedBy,
  className,
  ref,
}: ThreadActionsMenuContentProps) {
  return (
    <Menu
      ref={ref}
      role="menu"
      aria-label={label}
      aria-describedby={ariaDescribedBy}
      className={classNames(css.ThreadMenu, className)}
      style={threadActionsMenuStyle}
    >
      <div className={css.ThreadMenuRows}>
        {before}
        {groups.map((group, index) => (
          <Fragment key={group.id}>
            {index > 0 && <Line variant="Surface" size="300" />}
            <MenuGroup label={group.label}>
              {group.items.map((item) =>
                item.checked !== undefined ? (
                  <MenuSwitchEntry
                    key={item.action}
                    label={item.label}
                    checked={item.checked}
                    data-thread-action={item.action}
                    onToggle={() => item.onSelect()}
                  />
                ) : (
                  <MenuEntry
                    key={item.action}
                    role="menuitem"
                    label={item.label}
                    icon={item.icon}
                    shortcut={item.shortcut}
                    data-thread-action={item.action}
                    disabled={item.mutates && saving}
                    aria-busy={item.mutates && saving ? true : undefined}
                    onSelect={() => item.onSelect()}
                  />
                )
              )}
            </MenuGroup>
          </Fragment>
        ))}
      </div>
    </Menu>
  );
}
