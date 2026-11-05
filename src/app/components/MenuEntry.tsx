import { type ComponentProps, type MouseEventHandler, type ReactNode } from 'react';
import { Box, Icon, Text, config, type IconSrc } from 'folds';
import { MenuItem } from './glass/GlassPrimitives';
import { ShortcutHint, shortcutAttributes } from '../mindroom/shortcuts/ShortcutKeys';
import type { ShortcutId } from '../mindroom/shortcuts/shortcuts';

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
};

// The label takes the row's free width, so the icons line up, and starts at the leading edge
// (the item is a button, which would center it).
const labelStyle = { flexGrow: 1, textAlign: 'start' } as const;

/** One row of a menu: its label, then its shortcut's keys and its icon at the end of the line. */
export function MenuEntry({
  label,
  icon,
  after,
  onSelect,
  critical,
  directional,
  shortcut,
  ...props
}: MenuEntryProps) {
  const end = after ?? <Icon size="100" src={icon} data-directional={directional || undefined} />;
  return (
    <MenuItem
      size="300"
      radii="300"
      variant={critical ? 'Critical' : 'Surface'}
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
      onClick={onSelect}
      {...shortcutAttributes(shortcut)}
      {...props}
    >
      <Text as="span" size="T300" truncate style={labelStyle}>
        {label}
      </Text>
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
