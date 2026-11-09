// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  SHORTCUT_IDS,
  ariaShortcut,
  fieldStateOf,
  findShortcut,
  formatShortcut,
  matchesKeys,
  moveStep,
  shortcutOfAria,
  type ShortcutContext,
  type ShortcutId,
  type ShortcutKeyEvent,
} from './shortcuts';

type Press = Partial<ShortcutKeyEvent> & { key: string };

const press = ({ key, ...rest }: Press): ShortcutKeyEvent => ({
  key,
  code: '',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  isComposing: false,
  keyCode: 0,
  defaultPrevented: false,
  target: document.body,
  ...rest,
});

const context = (overrides: Partial<ShortcutContext> = {}): ShortcutContext => ({
  apple: false,
  composing: false,
  computer: false,
  overlay: 'none',
  registered: () => true,
  ...overrides,
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('matchesKeys', () => {
  it('reads mod as Command on Apple platforms and Ctrl elsewhere', () => {
    expect(
      matchesKeys(press({ key: 'm', metaKey: true, shiftKey: true }), 'mod+shift+m', true)
    ).toBe(true);
    expect(
      matchesKeys(press({ key: 'M', ctrlKey: true, shiftKey: true }), 'mod+shift+m', false)
    ).toBe(true);
    // The other platform's modifier is a different chord.
    expect(
      matchesKeys(press({ key: 'm', ctrlKey: true, shiftKey: true }), 'mod+shift+m', true)
    ).toBe(false);
    expect(
      matchesKeys(press({ key: 'm', metaKey: true, shiftKey: true }), 'mod+shift+m', false)
    ).toBe(false);
  });

  it('needs exactly the modifiers of the chord', () => {
    expect(matchesKeys(press({ key: 'ArrowDown', altKey: true }), 'alt+down', false)).toBe(true);
    expect(
      matchesKeys(press({ key: 'ArrowDown', altKey: true, shiftKey: true }), 'alt+down', false)
    ).toBe(false);
    expect(
      matchesKeys(press({ key: 'ArrowDown', altKey: true, ctrlKey: true }), 'alt+down', false)
    ).toBe(false);
    expect(matchesKeys(press({ key: 'ArrowDown' }), 'alt+down', false)).toBe(false);
  });

  it("matches another script's letter by its place on the keyboard", () => {
    // Ctrl and the M key on a Russian layout types `ь`.
    expect(
      matchesKeys(
        press({ key: 'Ь', code: 'KeyM', ctrlKey: true, shiftKey: true }),
        'mod+shift+m',
        false
      )
    ).toBe(true);
    // On AZERTY the key at KeyQ types `a`: the letter counts, not the place.
    expect(matchesKeys(press({ key: 'a', code: 'KeyQ', ctrlKey: true }), 'mod+a', false)).toBe(
      true
    );
    expect(matchesKeys(press({ key: 'a', code: 'KeyQ', ctrlKey: true }), 'mod+q', false)).toBe(
      false
    );
  });

  it('matches punctuation typed with Shift where the layout needs it, and by place for other scripts', () => {
    // German types `/` with Shift and 7.
    expect(
      matchesKeys(
        press({ key: '/', code: 'Digit7', ctrlKey: true, shiftKey: true }),
        'mod+/',
        false
      )
    ).toBe(true);
    // The German `-` key sits where US keyboards have `/`: Ctrl and it stays the browser's zoom.
    expect(matchesKeys(press({ key: '-', code: 'Slash', ctrlKey: true }), 'mod+/', false)).toBe(
      false
    );
    // A Russian layout types `б` on the comma key.
    expect(matchesKeys(press({ key: 'б', code: 'Comma', ctrlKey: true }), 'mod+,', false)).toBe(
      true
    );
    expect(
      matchesKeys(press({ key: 'Dead', code: 'Backslash', metaKey: true }), 'mod+\\', true)
    ).toBe(true);
  });
});

describe('the shortcut table', () => {
  const textKeys = [
    'mod+a',
    'mod+c',
    'mod+x',
    'mod+v',
    'mod+z',
    'mod+y',
    'mod+shift+z',
    'shift+up',
    'shift+down',
    'mod+up',
    'mod+down',
    'home',
    'end',
    'alt+backspace',
    'mod+backspace',
  ];

  it("never binds the platform's text editing keys", () => {
    const bound = SHORTCUT_IDS.map((id) => SHORTCUTS[id].keys);
    textKeys.forEach((keys) => expect(bound).not.toContain(keys));
  });

  it('keeps Mod+Shift with the arrows for moving a focused row, off text fields', () => {
    expect(SHORTCUTS.moveRoomUp.field).toBe('never');
    expect(SHORTCUTS.moveRoomDown.field).toBe('never');
    expect(moveStep(press({ key: 'ArrowUp', ctrlKey: true, shiftKey: true }))).toBe(-1);
    expect(moveStep(press({ key: 'ArrowDown', ctrlKey: true, shiftKey: true }))).toBe(1);
    expect(moveStep(press({ key: 'ArrowDown', altKey: true }))).toBeUndefined();
  });

  it('gives every chord its own keys', () => {
    const keys = SHORTCUT_IDS.map((id) => SHORTCUTS[id].keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('formatShortcut and ariaShortcut', () => {
  it.each<[ShortcutId, string, string]>([
    ['members', '⌘⇧M', 'Ctrl+Shift+M'],
    ['settings', '⌘,', 'Ctrl+,'],
    ['help', '⌘/', 'Ctrl+/'],
    ['roomList', '⌘\\', 'Ctrl+\\'],
    ['callView', '⌘⇧L', 'Ctrl+Shift+L'],
    ['nextRoom', '⌥↓', 'Alt+↓'],
    ['previousUnread', '⌥⇧↑', 'Alt+Shift+↑'],
    ['resolveThread', '⌘⇧↵', 'Ctrl+Shift+Enter'],
    ['focusComposer', 'Esc', 'Esc'],
  ])('%s is %s on Apple platforms and %s elsewhere', (id, apple, other) => {
    expect(formatShortcut(id, true)).toBe(apple);
    expect(formatShortcut(id, false)).toBe(other);
  });

  it('names keys for aria-keyshortcuts and finds the shortcut again from them', () => {
    expect(ariaShortcut('members', true)).toBe('Meta+Shift+M');
    expect(ariaShortcut('members', false)).toBe('Control+Shift+M');
    expect(ariaShortcut('previousRoom', false)).toBe('Alt+ArrowUp');
    // The palette's own button sets this value itself.
    expect(shortcutOfAria('Control+K', false)).toBe('palette');
    expect(shortcutOfAria('Meta+Shift+M', true)).toBe('members');
    expect(shortcutOfAria('Control+Q', false)).toBeUndefined();
  });
});

describe('findShortcut', () => {
  const composer = (html: string) => {
    document.body.innerHTML = `<div contenteditable="true">${html}</div>`;
    return document.body.firstElementChild as HTMLElement;
  };

  it('acts outside fields', () => {
    expect(findShortcut(press({ key: 'ArrowDown', altKey: true }), context())).toBe('nextRoom');
    expect(findShortcut(press({ key: 'Escape' }), context())).toBe('focusComposer');
  });

  it('leaves keys a widget already used, an input method, and the Computer screen alone', () => {
    const altDown = { key: 'ArrowDown', altKey: true };
    expect(findShortcut(press({ ...altDown, defaultPrevented: true }), context())).toBeUndefined();
    expect(findShortcut(press({ ...altDown, isComposing: true }), context())).toBeUndefined();
    expect(findShortcut(press({ ...altDown, keyCode: 229 }), context())).toBeUndefined();
    expect(findShortcut(press({ key: 'Process', altKey: true }), context())).toBeUndefined();
    expect(findShortcut(press(altDown), context({ composing: true }))).toBeUndefined();
    expect(findShortcut(press(altDown), context({ computer: true }))).toBeUndefined();
  });

  it('acts only for shortcuts with a handler, and never for local ones', () => {
    const altDown = press({ key: 'ArrowDown', altKey: true });
    expect(findShortcut(altDown, context({ registered: () => false }))).toBeUndefined();
    expect(findShortcut(press({ key: 'k', ctrlKey: true }), context())).toBeUndefined();
    expect(
      findShortcut(press({ key: 'ArrowUp', ctrlKey: true, shiftKey: true }), context())
    ).toBeUndefined();
  });

  it('lets only the help toggle through while help is open, and nothing over other overlays', () => {
    const help = press({ key: '/', ctrlKey: true });
    const members = press({ key: 'M', ctrlKey: true, shiftKey: true });
    expect(findShortcut(help, context({ overlay: 'help' }))).toBe('help');
    expect(findShortcut(members, context({ overlay: 'help' }))).toBeUndefined();
    expect(findShortcut(help, context({ overlay: 'other' }))).toBeUndefined();
  });

  it('in a field with text fires only chords that have no text meaning', () => {
    const target = composer('<p>Hello</p>');
    const inField = (keys: Press) => findShortcut(press({ ...keys, target }), context());
    expect(inField({ key: ',', ctrlKey: true })).toBe('settings');
    expect(inField({ key: '/', ctrlKey: true })).toBe('help');
    expect(inField({ key: '\\', ctrlKey: true })).toBe('roomList');
    expect(inField({ key: 'M', ctrlKey: true, shiftKey: true })).toBe('members');
    expect(inField({ key: 'F', ctrlKey: true, shiftKey: true })).toBe('messageSearch');
    expect(inField({ key: 'L', ctrlKey: true, shiftKey: true })).toBe('callView');
    // Paragraph moves and selections, Escape, and a slip of the send key stay with the field.
    expect(inField({ key: 'ArrowUp', altKey: true })).toBeUndefined();
    expect(inField({ key: 'ArrowDown', altKey: true, shiftKey: true })).toBeUndefined();
    expect(inField({ key: 'Enter', ctrlKey: true, shiftKey: true })).toBeUndefined();
    expect(inField({ key: 'Escape' })).toBeUndefined();
  });

  it('in an empty field also moves between rooms and resolves', () => {
    // An empty line of the editor holds a filler, and the placeholder is no text.
    const target = composer(
      '<p><span data-slate-placeholder="true" contenteditable="false">Message</span><span>\ufeff</span></p>'
    );
    const inField = (keys: Press) => findShortcut(press({ ...keys, target }), context());
    expect(inField({ key: 'ArrowUp', altKey: true })).toBe('previousRoom');
    expect(inField({ key: 'ArrowDown', altKey: true, shiftKey: true })).toBe('nextUnread');
    expect(inField({ key: 'Enter', ctrlKey: true, shiftKey: true })).toBe('resolveThread');
    expect(inField({ key: 'Escape' })).toBeUndefined();
  });
});

describe('fieldStateOf', () => {
  it('tells text fields with and without text from other targets', () => {
    document.body.innerHTML =
      '<input id="empty" /><input id="full" value="x" /><input id="box" type="checkbox" />' +
      '<textarea id="area"></textarea><button id="button"></button>' +
      '<div contenteditable="true" id="mention"><p><span contenteditable="false">@ann</span></p></div>';
    const byId = (id: string) => document.getElementById(id);
    expect(fieldStateOf(byId('empty'))).toBe('empty');
    expect(fieldStateOf(byId('full'))).toBe('text');
    expect(fieldStateOf(byId('box'))).toBe('none');
    expect(fieldStateOf(byId('area'))).toBe('empty');
    expect(fieldStateOf(byId('button'))).toBe('none');
    // A mention pill is content although it is not editable text.
    expect(fieldStateOf(byId('mention'))).toBe('text');
  });
});
