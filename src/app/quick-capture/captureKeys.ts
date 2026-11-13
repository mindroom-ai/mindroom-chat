/** The part of the widget that has the keyboard. */
export type CaptureZone = 'input' | 'list' | 'reply' | 'picker';

export type CaptureKeyAction =
  | { kind: 'send'; open: boolean }
  | { kind: 'toList' }
  | { kind: 'toInput'; text?: string }
  | { kind: 'move'; by: 1 | -1 }
  | { kind: 'peek' }
  | { kind: 'resolve' }
  | { kind: 'reply' }
  | { kind: 'copy' }
  | { kind: 'open' }
  | { kind: 'pick' }
  | { kind: 'picker' }
  | { kind: 'escape' }
  | { kind: 'screenshot'; target: 'window' | 'screen' };

type CaptureKeyEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>;

export type CaptureKeyContext = {
  zone: CaptureZone;
  inputEmpty: boolean;
  /** The caret is in the input's last line, so the down arrow has nowhere to go in it. */
  caretOnLastLine: boolean;
  /** The selected row is the list's first. */
  firstRow: boolean;
  /** ⌘ is the platform's command key (macOS, iOS); Ctrl elsewhere. */
  apple: boolean;
};

/** The list's own keys; `n` goes back to the input without typing. */
const LIST_KEYS = new Map<string, CaptureKeyAction>([
  [' ', { kind: 'peek' }],
  ['x', { kind: 'resolve' }],
  ['r', { kind: 'reply' }],
  ['c', { kind: 'copy' }],
  ['Enter', { kind: 'open' }],
  ['n', { kind: 'toInput' }],
]);

/** A key that types one character, as opposed to Enter, Tab or an arrow. */
const isCharacter = (key: string): boolean => [...key].length === 1;

const inputAction = (
  { key, shiftKey }: CaptureKeyEvent,
  mod: boolean,
  { inputEmpty, caretOnLastLine }: CaptureKeyContext
): CaptureKeyAction | undefined => {
  if (key === 'Enter') return shiftKey ? undefined : { kind: 'send', open: mod };
  if (mod && shiftKey) {
    const letter = key.toLowerCase();
    if (letter === 'a') return { kind: 'screenshot', target: 'window' };
    if (letter === 's') return { kind: 'screenshot', target: 'screen' };
    return undefined;
  }
  if (mod || shiftKey) return undefined;
  if (key === 'Tab' && inputEmpty) return { kind: 'picker' };
  if (key === 'ArrowDown' && caretOnLastLine) return { kind: 'toList' };
  return undefined;
};

const listAction = (
  { key, shiftKey }: CaptureKeyEvent,
  mod: boolean,
  { firstRow }: CaptureKeyContext
): CaptureKeyAction | undefined => {
  // Shift changes a character key itself; with a named key it is a chord the list has none of.
  if (mod || (shiftKey && !isCharacter(key))) return undefined;
  if (key === 'ArrowDown' || key === 'j') return { kind: 'move', by: 1 };
  if (key === 'ArrowUp' || key === 'k') {
    return firstRow ? { kind: 'toInput' } : { kind: 'move', by: -1 };
  }
  const action = LIST_KEYS.get(key);
  if (action) return action;
  return isCharacter(key) ? { kind: 'toInput', text: key } : undefined;
};

/**
 * What a key press does in the zone that has the keyboard; undefined leaves the key to the
 * field (typing, a new line, Tab). `mod` is ⌘ on Apple platforms and Ctrl elsewhere; the other
 * platform's key, and Alt, make any key here a chord the widget does not use.
 */
export const captureKeyAction = (
  event: CaptureKeyEvent,
  context: CaptureKeyContext
): CaptureKeyAction | undefined => {
  const mod = context.apple ? event.metaKey : event.ctrlKey;
  const otherMod = context.apple ? event.ctrlKey : event.metaKey;
  if (event.altKey || otherMod) return undefined;
  if (event.key === 'Escape') return mod ? undefined : { kind: 'escape' };
  switch (context.zone) {
    case 'input':
      return inputAction(event, mod, context);
    case 'list':
      return listAction(event, mod, context);
    case 'reply':
      return event.key === 'Enter' && !mod && !event.shiftKey
        ? { kind: 'send', open: false }
        : undefined;
    case 'picker':
      if (mod || event.shiftKey) return undefined;
      if (event.key === 'ArrowDown') return { kind: 'move', by: 1 };
      if (event.key === 'ArrowUp') return { kind: 'move', by: -1 };
      return event.key === 'Enter' ? { kind: 'pick' } : undefined;
  }
};
