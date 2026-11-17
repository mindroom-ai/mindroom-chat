import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import isHotkey from 'is-hotkey';

type KeyEventLike = Pick<
  KeyboardEvent | ReactKeyboardEvent,
  'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'preventDefault'
> & { which?: number };

const isPlainKey = (event: KeyEventLike, key: string): boolean =>
  event.key === key && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

/**
 * Autocomplete menus accept the highlighted item with Tab or Enter. Calls `callback` and keeps the
 * key from moving focus or submitting the form.
 */
export const onTabPress = (event: KeyEventLike, callback: () => void): void => {
  if (isPlainKey(event, 'Tab') || isPlainKey(event, 'Enter')) {
    event.preventDefault();
    callback();
  }
};

type EscapeEventLike = Pick<Event, 'stopPropagation'> &
  Partial<Pick<Event, 'defaultPrevented'>> & {
    /** Set while an input method composes text; Escape then cancels the composition. */
    isComposing?: boolean;
  };

/**
 * Focus-trap `escapeDeactivates` helper: closes the trap and keeps the key from reaching handlers
 * outside it, also when a text field inside has focus. A field that used the key itself (it closed
 * its own suggestions and called `preventDefault`) or an input method still composing keeps the
 * trap open.
 */
export const stopPropagation = (event: EscapeEventLike): boolean => {
  if (event.defaultPrevented || event.isComposing) return false;
  event.stopPropagation();
  return true;
};

/** Keeps arrow keys in a menu from scrolling the page behind it. */
export const preventScrollWithArrowKey = (event: KeyboardEvent | ReactKeyboardEvent): void => {
  if (isHotkey(['arrowup', 'arrowdown', 'arrowleft', 'arrowright'], event as KeyboardEvent)) {
    event.preventDefault();
  }
};

/**
 * The letter a shortcut names, lowercased: from `key`, or from `code` when that is another
 * script's letter (a Cyrillic or Greek layout, say), as Chromium does for its own shortcuts.
 * Symbols and dead keys on a letter key, such as BÉPO's period on V, name none.
 */
export const shortcutLetter = (event: Pick<KeyboardEvent, 'key' | 'code'>): string | undefined => {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  if (!/^\p{L}$/u.test(event.key)) return undefined;
  return event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : undefined;
};
