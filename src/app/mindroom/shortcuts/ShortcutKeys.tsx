import { Text } from 'folds';
import { ariaShortcut, formatShortcut, type ShortcutId } from './shortcuts';

// Plain styles: menus and rail buttons across the app show these, and their tests stub folds.
const keysStyle = { fontFamily: 'inherit', whiteSpace: 'nowrap', unicodeBidi: 'isolate' } as const;
const labelRowStyle = { display: 'inline-flex', alignItems: 'center', gap: '0.75em' } as const;
// The keys themselves come from the global `kbd[data-keys]::after` rule in src/index.css.
const hintStyle = { ...keysStyle, direction: 'ltr', fontSize: '0.75rem', opacity: 0.65 } as const;

/** A shortcut's keys in quiet text, as tooltips show them after the label. */
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

/**
 * A menu row's shortcut, drawn by CSS from `data-keys`: the row's text and its accessible name
 * stay the action's name, and the control's aria-keyshortcuts gives the keys.
 */
export function ShortcutHint({ id }: { id: ShortcutId }) {
  return <kbd style={hintStyle} dir="ltr" aria-hidden="true" data-keys={formatShortcut(id)} />;
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
