import type { MouseEvent, ReactNode } from 'react';
import { Icon, IconButton, Icons, Tooltip, type IconSrc } from 'folds';
import { TooltipProvider } from '../ui/directional';
import { MenuEntry } from '../ui/MenuEntry';
import { ShortcutLabel, shortcutAttributes } from '../shortcuts/ShortcutKeys';
import type { ShortcutId } from '../shortcuts/shortcuts';
import { setOverlayOpenerFallback } from '../lib/overlayFocus';
import { HeaderActionButton as headerActionButton } from './RoomViewHeader.css';

/** Where an action of the room header shows: see `showsInRow`. */
type HeaderActionPlacement = 'row' | 'menu' | 'auto';

/**
 * Before phone promotions, `row` is always in the row and `auto` is there off phones.
 * The room menu offers the rest, even when some get a phone shortcut in the row.
 */
export const showsInRow = (placement: HeaderActionPlacement, phone: boolean): boolean =>
  placement === 'row' || (placement === 'auto' && !phone);

/**
 * An action the open room's header draws as an icon button, a menu entry, or both on phones.
 */
export type RoomHeaderAction = {
  /** Names it among the header's actions. */
  id: string;
  label: string;
  icon: IconSrc;
  placement: HeaderActionPlacement;
  /** Tints its button, for a mode that is on. */
  active?: boolean;
  /** For a toggle: its button is pressed and its menu entry checked while it is on. */
  pressed?: boolean;
  /**
   * Runs it. An action with a `popup` gets its opener: its button,
   * or the room menu's button.
   */
  run: (opener: HTMLButtonElement | undefined) => void;
  /** Drawn over its button's corner, or as a dot on More Options when only in the menu. */
  badge?: ReactNode;
  /** What it opens, which its button and its menu entry announce. */
  popup?: 'menu' | 'dialog';
  /** Whether what its button opens is open. */
  expanded?: boolean;
  /** A fallback for a panel that restores focus through the overlay manager. */
  focusFallback?: () => HTMLElement | false;
  /** The keyboard shortcut for the same action, shown in its button's tooltip. */
  shortcut?: ShortcutId;
  /** A data attribute its button and its menu entry carry. */
  marker?: `data-${string}`;
};

/**
 * An action whose controls draw themselves, as they keep state of their own: its buttons for the
 * row and its entries for the room menu, placed by the same rule.
 */
type RoomHeaderControls = {
  id: string;
  placement: HeaderActionPlacement;
  row?: ReactNode;
  menu?: ReactNode;
};

export type RoomHeaderEntry = (RoomHeaderAction | RoomHeaderControls) & {
  /** Only applies to `auto` actions in the phone promotion priority list. Defaults to true. */
  phoneEligible?: boolean;
};

/** Whether the header draws the entry's controls, rather than the entry itself. */
export const drawnByHeader = (entry: RoomHeaderEntry): entry is RoomHeaderAction => 'run' in entry;

/** An action's icon-only button, which names itself in a tooltip, as screen readers hear it. */
export function HeaderActionButton({
  action,
}: {
  action: Omit<RoomHeaderAction, 'id' | 'placement'>;
}) {
  const {
    label,
    icon,
    active,
    pressed,
    run,
    badge,
    popup,
    expanded,
    focusFallback,
    shortcut,
    marker,
  } = action;
  return (
    <TooltipProvider
      position="Bottom"
      offset={4}
      tooltip={
        <Tooltip>
          <ShortcutLabel label={label} id={shortcut} size="T200" />
        </Tooltip>
      }
    >
      {(anchorRef) => (
        <IconButton
          ref={anchorRef}
          size="400"
          radii="300"
          variant={active ? 'Primary' : 'Surface'}
          fill={active ? 'Soft' : 'None'}
          aria-label={label}
          aria-pressed={pressed}
          aria-haspopup={popup}
          aria-expanded={expanded}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            if (focusFallback) setOverlayOpenerFallback(event.currentTarget, focusFallback);
            run(popup ? event.currentTarget : undefined);
          }}
          className={headerActionButton}
          style={badge ? { position: 'relative' } : undefined}
          {...shortcutAttributes(shortcut)}
          {...(marker && { [marker]: '' })}
        >
          <Icon size="400" src={icon} />
          {badge}
        </IconButton>
      )}
    </TooltipProvider>
  );
}

/** An action's entry in the room menu: a checkbox for a toggle, whose check shows while it is on. */
export function HeaderActionEntry({
  action,
  onSelect,
}: {
  action: RoomHeaderAction;
  onSelect: () => void;
}) {
  const { label, icon, pressed, popup, marker } = action;
  const toggle = pressed !== undefined && {
    role: 'menuitemcheckbox',
    'aria-checked': pressed,
    after: pressed ? <Icon size="100" src={Icons.Check} /> : undefined,
  };
  return (
    <MenuEntry
      icon={icon}
      label={label}
      aria-haspopup={popup}
      onSelect={onSelect}
      {...toggle}
      {...(marker && { [marker]: '' })}
    />
  );
}
