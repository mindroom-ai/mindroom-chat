/** Symbols for modifier and special keys, as macOS menus and keyboard hints write them. */
export const KeySymbol = {
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  Backspace: '⌫',
  CapsLock: '⇪',
  Command: '⌘',
  Control: '⌃',
  Delete: '⌦',
  Enter: '↵',
  Escape: '⎋',
  Option: '⌥',
  Shift: '⇧',
  Tab: '⇥',
} as const;

export type KeySymbol = (typeof KeySymbol)[keyof typeof KeySymbol];
