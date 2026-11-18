import { shortcutLetter } from '../lib/keyboard';

// The keys that start a message in a conversation's composer from anywhere in its view: the room's
// (`RoomView`) and a second thread's beside it (`SecondThreadPanel`).

// Dialogs, menus and lists keep their own typing (fields, type-ahead), and so does a region
// marked `data-keeps-typing`.
const OWNS_TYPING_SELECTOR =
  '[role="dialog"], [role="menu"], [role="listbox"], [data-keeps-typing]';
export const focusOwnsTyping = (): boolean =>
  typeof document !== 'undefined' && !!document.activeElement?.closest?.(OWNS_TYPING_SELECTOR);

// Paste (Cmd+V, Ctrl+V), with Shift too for paste as plain text, but no Alt combination. The V is
// the layout's (Dvorak's sits on the physical period key), or the key's own on a non-Latin layout.
export const isPasteKey = (evt: KeyboardEvent): boolean =>
  (evt.ctrlKey || evt.metaKey) && !evt.altKey && shortcutLetter(evt) === 'v';
// A letter or digit without a modifier other than Shift.
export const isTypingKey = (evt: KeyboardEvent): boolean =>
  !evt.ctrlKey && !evt.metaKey && !evt.altKey && /^(Key[A-Z]|Digit\d)$/.test(evt.code ?? '');
