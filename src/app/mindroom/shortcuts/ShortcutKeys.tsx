import { Text } from 'folds';
import { ariaShortcut, formatShortcut, type ShortcutId } from './shortcuts';

// Plain styles: menus and rail buttons across the app show these, and their tests stub folds.
const keysStyle = { fontFamily: 'inherit', whiteSpace: 'nowrap', unicodeBidi: 'isolate' } as const;
const labelRowStyle = { display: 'inline-flex', alignItems: 'center', gap: '0.75em' } as const;

/** A shortcut's keys in quiet text, as tooltips and menu rows show them. */
export function ShortcutKeys({ id }: { id: ShortcutId }) {
  // Screen readers hear the keys from the control's aria-keyshortcuts, not in its name.
  return (
    <Text
      as="kbd"
      size="L400"
      priority="300"
      dir="ltr"
      aria-hidden="true"
      data-shortcut-keys=""
      style={keysStyle}
    >
      {formatShortcut(id)}
    </Text>
  );
}

type ShortcutLabelProps = {
  label: string;
  /** Without one, only the label shows. */
  id?: ShortcutId;
  size?: 'T200' | 'T300';
};

/** A tooltip's text: the action's name, then its keys. */
export function ShortcutLabel({ label, id, size = 'T300' }: ShortcutLabelProps) {
  if (!id) return <Text size={size}>{label}</Text>;
  return (
    <span style={labelRowStyle}>
      <Text as="span" size={size}>
        {label}
      </Text>
      <ShortcutKeys id={id} />
    </span>
  );
}

/** `aria-keyshortcuts` for the control that performs the shortcut's action; the hints find it. */
export const shortcutAttributes = (id: ShortcutId | undefined) =>
  id ? { 'aria-keyshortcuts': ariaShortcut(id) } : {};
