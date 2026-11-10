import { type ComponentProps, type MouseEventHandler, type ReactNode, useId } from 'react';
import classNames from 'classnames';
import { Box, Icon, Text, config, type IconSrc } from 'folds';
import { MenuItem } from './glass/GlassPrimitives';
import * as css from './MenuEntry.css';
import { ShortcutHint, shortcutAttributes } from '../shortcuts/ShortcutKeys';
import type { ShortcutId } from '../shortcuts/shortcuts';

type MenuEntryProps = Omit<
  ComponentProps<typeof MenuItem>,
  'size' | 'radii' | 'variant' | 'after' | 'onClick' | 'children'
> & {
  label: string;
  icon: IconSrc;
  /** Shown instead of the icon, such as a spinner while the entry works. */
  after?: ReactNode;
  onSelect: MouseEventHandler<HTMLButtonElement>;
  critical?: boolean;
  /** The icon points along the reading direction, so right-to-left languages mirror it. */
  directional?: boolean;
  /** The keyboard shortcut for the same action, shown before the icon. */
  shortcut?: ShortcutId;
  /**
   * Why the entry cannot be used here. The entry keeps its place, dimmed, says why under its
   * label, and stays reachable with the arrow keys, where a screen reader hears the reason as its
   * description; choosing it does nothing.
   */
  disabledReason?: string;
};

// The label takes the row's free width, so the icons line up, and starts at the leading edge
// (the item is a button, which would center it).
const labelStyle = { flexGrow: 1, textAlign: 'start' } as const;
// A disabled entry's label over its reason, which wraps rather than being cut off; the row grows
// to hold them (css.Unavailable), with a little space above and below.
const reasonColumnStyle = { minWidth: 0, textAlign: 'start', whiteSpace: 'normal' } as const;

/** One row of a menu: its label, then its shortcut's keys and its icon at the end of the line. */
export function MenuEntry({
  label,
  icon,
  after,
  onSelect,
  critical,
  directional,
  shortcut,
  disabledReason,
  className,
  ...props
}: MenuEntryProps) {
  const reasonId = useId();
  // A disabled entry dims its label and icon as folds dims a disabled item; its reason stays legible.
  const dimmed = disabledReason ? { opacity: config.opacity.Disabled } : undefined;
  const end = after ?? (
    <Icon size="100" src={icon} data-directional={directional || undefined} style={dimmed} />
  );
  const labelText = (
    <Text as="span" size="T300" truncate style={{ ...labelStyle, ...dimmed }}>
      {label}
    </Text>
  );
  return (
    <MenuItem
      size="300"
      radii="300"
      variant={critical ? 'Critical' : 'Surface'}
      className={classNames(className, disabledReason && css.Unavailable)}
      after={
        shortcut ? (
          <Box as="span" alignItems="Center" gap="200">
            <ShortcutHint id={shortcut} />
            {end}
          </Box>
        ) : (
          end
        )
      }
      onClick={disabledReason ? undefined : onSelect}
      {...shortcutAttributes(shortcut)}
      {...props}
      {...(disabledReason && { 'aria-disabled': true, 'aria-describedby': reasonId })}
    >
      {disabledReason ? (
        <Box
          as="span"
          direction="Column"
          grow="Yes"
          style={{ ...reasonColumnStyle, paddingBlock: config.space.S100 }}
        >
          {labelText}
          {/* The row's description, not part of its name. */}
          <Text as="span" id={reasonId} size="T200" priority="300" aria-hidden="true">
            {disabledReason}
          </Text>
        </Box>
      ) : (
        labelText
      )}
    </MenuItem>
  );
}

/** A run of menu rows; a menu with several groups puts a line between them. */
export function MenuGroup({ children }: { children: ReactNode }) {
  return (
    <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
      {children}
    </Box>
  );
}
