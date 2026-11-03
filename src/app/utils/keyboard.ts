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

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof (target as Element).tagName !== 'string') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
};

/**
 * Focus-trap `escapeDeactivates` helper: stops the key from reaching handlers outside the trap and
 * returns true, or returns false (and leaves the event alone) when an editable element has focus,
 * so the field keeps its own Escape handling and the trap stays active.
 */
export const stopPropagation = (event: Pick<Event, 'stopPropagation' | 'target'>): boolean => {
  if (isEditableTarget(event.target)) return false;
  event.stopPropagation();
  return true;
};

/** Keeps arrow keys in a menu from scrolling the page behind it. */
export const preventScrollWithArrowKey = (event: KeyboardEvent | ReactKeyboardEvent): void => {
  if (isHotkey(['arrowup', 'arrowdown', 'arrowleft', 'arrowright'], event as KeyboardEvent)) {
    event.preventDefault();
  }
};
