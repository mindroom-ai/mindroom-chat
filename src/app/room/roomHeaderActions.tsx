import type { MouseEvent, ReactNode } from 'react';
import { Icon, IconButton, Icons, Tooltip, type IconSrc, type RectCords } from 'folds';
import { TooltipProvider } from '../ui/directional';
import { MenuEntry } from '../ui/MenuEntry';
import { ShortcutLabel, shortcutAttributes } from '../shortcuts/ShortcutKeys';
import type { ShortcutId } from '../shortcuts/shortcuts';
import { HeaderActionButton as headerActionButton } from './RoomViewHeader.css';

/** Where an action of the room header shows: see `showsInRow`. */
type HeaderActionPlacement = 'row' | 'menu' | 'auto';

/**
 * The room header's one overflow rule: an action shows in the header's row when its placement is
 * `row`, or `auto` on a screen wider than a phone's; otherwise the room menu offers it.
 */
export const showsInRow = (placement: HeaderActionPlacement, phone: boolean): boolean =>
  placement === 'row' || (placement === 'auto' && !phone);

/**
 * An action of the open room's header, which the header draws: an icon button in its row, or an
 * entry of its room menu, as its placement and the screen decide (`showsInRow`).
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
   * Runs it. An action with a `popup` gets where its control was, for what it opens: its button,
   * or the room menu's button.
   */
  run: (anchor: RectCords | undefined) => void;
  /** Drawn over its button's corner, such as a count; on phones a dot on the menu's button. */
  badge?: ReactNode;
  /** What it opens, which its button and its menu entry announce. */
  popup?: 'menu' | 'dialog';
  /** Whether what its button opens is open. */
  expanded?: boolean;
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

export type RoomHeaderEntry = RoomHeaderAction | RoomHeaderControls;

/** Whether the header draws the entry's controls, rather than the entry itself. */
export const drawnByHeader = (entry: RoomHeaderEntry): entry is RoomHeaderAction => 'run' in entry;

const rectOf = (event: MouseEvent<HTMLElement>): RectCords => {
  const { x, y, width, height } = event.currentTarget.getBoundingClientRect();
  return { x, y, width, height };
};

/** An action's icon-only button, which names itself in a tooltip, as screen readers hear it. */
export function HeaderActionButton({
  action,
}: {
  action: Omit<RoomHeaderAction, 'id' | 'placement'>;
}) {
  const { label, icon, active, pressed, run, badge, popup, expanded, shortcut, marker } = action;
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
          onClick={(event: MouseEvent<HTMLButtonElement>) => run(popup ? rectOf(event) : undefined)}
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
