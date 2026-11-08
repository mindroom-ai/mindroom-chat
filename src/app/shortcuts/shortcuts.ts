import type { ParseKeys } from 'i18next';
import { KeySymbol } from '../lib/key-symbol';
import { isIOS, isMacOS } from '../lib/user-agent';

/**
 * What a shortcut may do while a text field (the composer, the message editor, an input) has
 * the focus: `always` for chords with no text meaning, `empty` only while the field holds no
 * text (in text the keys move or select by paragraph), `never` for keys the field keeps.
 */
export type FieldPolicy = 'always' | 'empty' | 'never';

export type ShortcutGroup = 'general' | 'rooms' | 'composer' | 'settings';

type ShortcutDefinition = {
  /** `mod+shift+m`, `alt+up`, `escape`: `mod` is ⌘ on Apple platforms and Ctrl elsewhere. */
  keys: string;
  /** The action's name in the help dialog. */
  labelKey: ParseKeys;
  group: ShortcutGroup;
  field: FieldPolicy;
  /** Holding the keys repeats the action; other shortcuts act once per press. */
  repeats?: boolean;
  /**
   * Handled where the key lands (a focused row, the composer, the palette's own listener), so
   * the window listener leaves it alone. The table still names and formats it.
   */
  local?: boolean;
};

/**
 * Every keyboard shortcut of the app, in the order the help dialog lists them. Buttons, menu
 * items and the hints read their keys from here through `formatShortcut` and `ariaShortcut`.
 */
const DEFINITIONS = {
  palette: {
    keys: 'mod+k',
    labelKey: 'shortcuts.actions.palette',
    group: 'general',
    field: 'always',
    local: true,
  },
  messageSearch: {
    keys: 'mod+shift+f',
    labelKey: 'shortcuts.actions.messageSearch',
    group: 'general',
    field: 'always',
  },
  settings: {
    keys: 'mod+,',
    labelKey: 'shortcuts.actions.settings',
    group: 'general',
    field: 'always',
  },
  help: { keys: 'mod+/', labelKey: 'shortcuts.actions.help', group: 'general', field: 'always' },
  roomList: {
    keys: 'mod+\\',
    labelKey: 'shortcuts.actions.roomList',
    group: 'general',
    field: 'always',
  },
  // The open call view renders after the page, so Tab reaches it last: this moves the focus there.
  callView: {
    keys: 'mod+shift+l',
    labelKey: 'shortcuts.actions.callView',
    group: 'general',
    field: 'always',
  },
  previousRoom: {
    keys: 'alt+up',
    labelKey: 'shortcuts.actions.previousRoom',
    group: 'rooms',
    field: 'empty',
    repeats: true,
  },
  nextRoom: {
    keys: 'alt+down',
    labelKey: 'shortcuts.actions.nextRoom',
    group: 'rooms',
    field: 'empty',
    repeats: true,
  },
  previousUnread: {
    keys: 'alt+shift+up',
    labelKey: 'shortcuts.actions.previousUnread',
    group: 'rooms',
    field: 'empty',
    repeats: true,
  },
  nextUnread: {
    keys: 'alt+shift+down',
    labelKey: 'shortcuts.actions.nextUnread',
    group: 'rooms',
    field: 'empty',
    repeats: true,
  },
  moveRoomUp: {
    keys: 'mod+shift+up',
    labelKey: 'shortcuts.actions.moveRoomUp',
    group: 'rooms',
    field: 'never',
    local: true,
  },
  moveRoomDown: {
    keys: 'mod+shift+down',
    labelKey: 'shortcuts.actions.moveRoomDown',
    group: 'rooms',
    field: 'never',
    local: true,
  },
  members: {
    keys: 'mod+shift+m',
    labelKey: 'shortcuts.actions.members',
    group: 'rooms',
    field: 'always',
  },
  focusComposer: {
    keys: 'escape',
    labelKey: 'shortcuts.actions.focusComposer',
    group: 'rooms',
    field: 'never',
  },
  resolveThread: {
    keys: 'mod+shift+enter',
    labelKey: 'shortcuts.actions.resolveThread',
    group: 'rooms',
    field: 'empty',
  },
  send: {
    keys: 'enter',
    labelKey: 'composer.sendMessage',
    group: 'composer',
    field: 'never',
    local: true,
  },
  newLine: {
    keys: 'shift+enter',
    labelKey: 'shortcuts.actions.newLine',
    group: 'composer',
    field: 'never',
    local: true,
  },
  editLast: {
    keys: 'up',
    labelKey: 'shortcuts.actions.editLast',
    group: 'composer',
    field: 'never',
    local: true,
  },
  bold: {
    keys: 'mod+b',
    labelKey: 'sharedUi.toolbar.bold',
    group: 'composer',
    field: 'never',
    local: true,
  },
  italic: {
    keys: 'mod+i',
    labelKey: 'sharedUi.toolbar.italic',
    group: 'composer',
    field: 'never',
    local: true,
  },
  underline: {
    keys: 'mod+u',
    labelKey: 'sharedUi.toolbar.underline',
    group: 'composer',
    field: 'never',
    local: true,
  },
  strikeThrough: {
    keys: 'mod+shift+x',
    labelKey: 'sharedUi.toolbar.strikeThrough',
    group: 'composer',
    field: 'never',
    local: true,
  },
  inlineCode: {
    keys: 'mod+e',
    labelKey: 'shortcuts.actions.inlineCode',
    group: 'composer',
    field: 'never',
    local: true,
  },
  spoiler: {
    keys: 'mod+shift+h',
    labelKey: 'sharedUi.toolbar.spoiler',
    group: 'composer',
    field: 'never',
    local: true,
  },
  // The Settings dialog's own listener (SettingsSearch) moves focus to its search field.
  settingsSearch: {
    keys: '/',
    labelKey: 'featureUi.settings.search.placeholder',
    group: 'settings',
    field: 'never',
    local: true,
  },
} satisfies Record<string, ShortcutDefinition>;

export type ShortcutId = keyof typeof DEFINITIONS;

export const SHORTCUTS: Readonly<Record<ShortcutId, ShortcutDefinition>> = DEFINITIONS;

export const SHORTCUT_IDS = Object.keys(SHORTCUTS) as ShortcutId[];

/** ⌘ on macOS, iPhone and iPad (as is-hotkey reads `mod`), Ctrl elsewhere. */
export const usesCommandKey = (): boolean => isMacOS() || isIOS();

type ParsedKeys = { mod: boolean; alt: boolean; shift: boolean; key: string };

const parseKeys = (keys: string): ParsedKeys => {
  const parts = keys.split('+');
  const key = parts[parts.length - 1] ?? '';
  return {
    mod: parts.includes('mod'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    key,
  };
};

/** Keys written by name in the table, with their `KeyboardEvent.key`. */
const NAMED_KEYS: Record<string, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  enter: 'Enter',
  escape: 'Escape',
};

/** Where the punctuation keys sit on a US keyboard, for layouts that type something else there. */
const PUNCTUATION_CODES: Record<string, string> = {
  ',': 'Comma',
  '/': 'Slash',
  '\\': 'Backslash',
};

/**
 * A key that types no ASCII character: another script's letter (Cyrillic, Greek), a dead key.
 * Such a press is matched by its place on the keyboard (`code`) instead, as browsers do for
 * their own shortcuts; a key that types ASCII keeps its meaning (Ctrl and the German `-` key,
 * which sits where US keyboards have `/`, stays the browser's zoom).
 */
const typesNonAscii = (key: string): boolean => {
  if (key === 'Dead' || key === 'Unidentified') return true;
  const chars = [...key];
  return chars.length === 1 && (chars[0]?.codePointAt(0) ?? 0) > 0x7e;
};

export type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
>;

/** Whether the key event is the chord `keys` on a platform that does (`apple`) or does not use ⌘. */
export const matchesKeys = (event: KeyEventLike, keys: string, apple: boolean): boolean => {
  const spec = parseKeys(keys);
  const mod = apple ? event.metaKey : event.ctrlKey;
  const otherMod = apple ? event.ctrlKey : event.metaKey;
  if (otherMod || mod !== spec.mod || event.altKey !== spec.alt) return false;
  const named = NAMED_KEYS[spec.key];
  if (named) return event.shiftKey === spec.shift && event.key === named;
  const byCode = typesNonAscii(event.key);
  if (/^[a-z]$/.test(spec.key)) {
    if (event.shiftKey !== spec.shift) return false;
    return byCode
      ? event.code === `Key${spec.key.toUpperCase()}`
      : event.key.toLowerCase() === spec.key;
  }
  // Some layouts need Shift for the character itself (German types `/` with Shift and 7).
  if (event.key === spec.key) return spec.shift ? event.shiftKey : true;
  return byCode && event.shiftKey === spec.shift && event.code === PUNCTUATION_CODES[spec.key];
};

export const matchesShortcut = (
  event: KeyEventLike,
  id: ShortcutId,
  apple: boolean = usesCommandKey()
): boolean => matchesKeys(event, SHORTCUTS[id].keys, apple);

/**
 * The place a focused room row or rail entry moves for the key: ⌘ (Ctrl elsewhere) with Shift
 * and the up or down arrow. Alt and the arrows open the room above or below instead.
 */
export const moveStep = (event: KeyEventLike): -1 | 1 | undefined => {
  if (matchesShortcut(event, 'moveRoomUp')) return -1;
  if (matchesShortcut(event, 'moveRoomDown')) return 1;
  return undefined;
};

/** An input method is composing text, so the key belongs to it. */
export const isComposingKey = (event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode'>) =>
  event.isComposing || event.keyCode === 229 || event.key === 'Process';

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** The fillers a rich text editor keeps in an empty line, which are no text. */
const FILLER = /[\u200b\ufeff]/g;

/** Whether editable content holds text, a mention or a picture; its placeholder does not count. */
const editableHasContent = (root: Element): boolean => {
  if (root.querySelector('img')) return true;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const inPlaceholder = !!node.parentElement?.closest('[data-slate-placeholder]');
    if (!inPlaceholder && (node.nodeValue ?? '').replace(FILLER, '') !== '') return true;
  }
  return false;
};

const EDITABLE_SELECTOR =
  '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

export type FieldState = 'none' | 'empty' | 'text';

/** Whether the key's target is a text field, and whether that field holds text. */
export const fieldStateOf = (target: EventTarget | null): FieldState => {
  if (!(target instanceof Element)) return 'none';
  if (target instanceof HTMLInputElement) {
    if (NON_TEXT_INPUTS.has(target.type)) return 'none';
    return target.value === '' ? 'empty' : 'text';
  }
  if (target instanceof HTMLTextAreaElement) return target.value === '' ? 'empty' : 'text';
  // A select uses the arrow keys (Alt and the down arrow opens it on Windows).
  if (target instanceof HTMLSelectElement) return 'text';
  const editable = target.closest(EDITABLE_SELECTOR);
  if (!editable) return 'none';
  return editableHasContent(editable) ? 'text' : 'empty';
};

/** What else holds the keyboard when a shortcut is pressed. */
export type ShortcutContext = {
  apple: boolean;
  /** An input method composes text (or just finished, for Safari's late Enter). */
  composing: boolean;
  /** The agent's Computer screen has the focus and takes every key. */
  computer: boolean;
  /** An open dialog, menu or popover: only the help dialog's own toggle passes. */
  overlay: 'none' | 'help' | 'other';
  /** Which shortcuts have a handler right now. */
  registered: (id: ShortcutId) => boolean;
};

export type ShortcutKeyEvent = KeyEventLike &
  Pick<KeyboardEvent, 'isComposing' | 'keyCode' | 'defaultPrevented' | 'target'>;

const FIELD_ALLOWS: Record<FieldState, (policy: FieldPolicy) => boolean> = {
  none: () => true,
  empty: (policy) => policy !== 'never',
  text: (policy) => policy === 'always',
};

/**
 * The shortcut a key press asks for, when nothing else owns the key: a field or menu that used
 * it already, an input method, the Computer screen, an open overlay, or a text field whose own
 * keys these are.
 */
export const findShortcut = (
  event: ShortcutKeyEvent,
  context: ShortcutContext
): ShortcutId | undefined => {
  if (event.defaultPrevented || context.composing || isComposingKey(event)) return undefined;
  if (context.computer) return undefined;
  const id = SHORTCUT_IDS.find(
    (candidate) =>
      !SHORTCUTS[candidate].local &&
      context.registered(candidate) &&
      matchesKeys(event, SHORTCUTS[candidate].keys, context.apple)
  );
  if (!id) return undefined;
  if (context.overlay === 'other' || (context.overlay === 'help' && id !== 'help'))
    return undefined;
  return FIELD_ALLOWS[fieldStateOf(event.target)](SHORTCUTS[id].field) ? id : undefined;
};

const MAC_SYMBOLS: Record<string, string> = {
  mod: KeySymbol.Command,
  alt: KeySymbol.Option,
  shift: KeySymbol.Shift,
  up: KeySymbol.ArrowUp,
  down: KeySymbol.ArrowDown,
  enter: KeySymbol.Enter,
  escape: 'Esc',
};

const OTHER_NAMES: Record<string, string> = {
  mod: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  up: KeySymbol.ArrowUp,
  down: KeySymbol.ArrowDown,
  enter: 'Enter',
  escape: 'Esc',
};

const ORDER = ['mod', 'alt', 'shift'] as const;

/** The key caps of a chord, modifiers first: `['⌘', '⇧', 'M']` or `['Ctrl', 'Shift', 'M']`. */
export const keyCapsOf = (keys: string, apple: boolean): string[] => {
  const spec = parseKeys(keys);
  const names = apple ? MAC_SYMBOLS : OTHER_NAMES;
  const caps: string[] = ORDER.filter((modifier) => spec[modifier]).map(
    (modifier) => names[modifier] ?? modifier
  );
  caps.push(names[spec.key] ?? spec.key.toUpperCase());
  return caps;
};

export const shortcutKeyCaps = (id: ShortcutId, apple: boolean = usesCommandKey()): string[] =>
  keyCapsOf(SHORTCUTS[id].keys, apple);

/** The shortcut as the platform writes it: `⌘⇧M` on Apple platforms, `Ctrl+Shift+M` elsewhere. */
export const formatShortcut = (id: ShortcutId, apple: boolean = usesCommandKey()): string =>
  shortcutKeyCaps(id, apple).join(apple ? '' : '+');

const ARIA_NAMES: Record<string, string> = {
  alt: 'Alt',
  shift: 'Shift',
  up: 'ArrowUp',
  down: 'ArrowDown',
  enter: 'Enter',
  escape: 'Escape',
};

/** The `aria-keyshortcuts` value: `Meta+Shift+M` on Apple platforms, `Control+Shift+M` elsewhere. */
export const ariaShortcut = (id: ShortcutId, apple: boolean = usesCommandKey()): string => {
  const spec = parseKeys(SHORTCUTS[id].keys);
  const parts: string[] = [];
  if (spec.mod) parts.push(apple ? 'Meta' : 'Control');
  if (spec.alt) parts.push('Alt');
  if (spec.shift) parts.push('Shift');
  parts.push(ARIA_NAMES[spec.key] ?? spec.key.toUpperCase());
  return parts.join('+');
};

/** The shortcut an `aria-keyshortcuts` value stands for, for buttons that set it themselves. */
export const shortcutOfAria = (
  value: string,
  apple: boolean = usesCommandKey()
): ShortcutId | undefined => SHORTCUT_IDS.find((id) => ariaShortcut(id, apple) === value);
