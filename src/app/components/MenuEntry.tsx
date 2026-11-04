import { type ComponentProps, type MouseEventHandler, type ReactNode } from 'react';
import { Icon, Text, type IconSrc } from 'folds';
import { MenuItem } from './glass/GlassPrimitives';

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
};

// The label takes the row's free width, so the icons line up, and starts at the leading edge
// (the item is a button, which would center it).
const labelStyle = { flexGrow: 1, textAlign: 'start' } as const;

/** One row of a menu: its label, then its icon at the end of the line. */
export function MenuEntry({
  label,
  icon,
  after,
  onSelect,
  critical,
  directional,
  ...props
}: MenuEntryProps) {
  return (
    <MenuItem
      size="300"
      radii="300"
      variant={critical ? 'Critical' : 'Surface'}
      after={after ?? <Icon size="100" src={icon} data-directional={directional || undefined} />}
      onClick={onSelect}
      {...props}
    >
      <Text as="span" size="T300" truncate style={labelStyle}>
        {label}
      </Text>
    </MenuItem>
  );
}
