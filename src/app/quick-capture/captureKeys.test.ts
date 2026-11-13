import { describe, expect, it } from 'vitest';
import { captureKeyAction, type CaptureKeyAction, type CaptureZone } from './captureKeys';

type Press = {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

type Context = {
  inputEmpty?: boolean;
  caretOnLastLine?: boolean;
  firstRow?: boolean;
};

/** The action for a press in `zone`, where `mod` is ⌘ when `apple` and Ctrl otherwise. */
const actionOf = (
  zone: CaptureZone,
  { key, mod = false, shift = false, alt = false }: Press,
  apple: boolean,
  context: Context = {}
): CaptureKeyAction | undefined =>
  captureKeyAction(
    { key, metaKey: apple && mod, ctrlKey: !apple && mod, shiftKey: shift, altKey: alt },
    {
      zone,
      inputEmpty: context.inputEmpty ?? false,
      caretOnLastLine: context.caretOnLastLine ?? false,
      firstRow: context.firstRow ?? false,
      apple,
    }
  );

describe.each([true, false])('captureKeyAction (apple: %s)', (apple) => {
  describe('in the input', () => {
    it('sends on Enter and sends and opens on mod+Enter', () => {
      expect(actionOf('input', { key: 'Enter' }, apple)).toEqual({ kind: 'send', open: false });
      expect(actionOf('input', { key: 'Enter', mod: true }, apple)).toEqual({
        kind: 'send',
        open: true,
      });
    });

    it('leaves Shift+Enter to the field, for a new line', () => {
      expect(actionOf('input', { key: 'Enter', shift: true }, apple)).toBeUndefined();
    });

    it('opens the picker on Tab only while the input is empty', () => {
      expect(actionOf('input', { key: 'Tab' }, apple, { inputEmpty: true })).toEqual({
        kind: 'picker',
      });
      expect(actionOf('input', { key: 'Tab' }, apple, { inputEmpty: false })).toBeUndefined();
    });

    it('moves into the list on ArrowDown only from the last line', () => {
      expect(actionOf('input', { key: 'ArrowDown' }, apple, { caretOnLastLine: true })).toEqual({
        kind: 'toList',
      });
      expect(
        actionOf('input', { key: 'ArrowDown' }, apple, { caretOnLastLine: false })
      ).toBeUndefined();
    });

    it('takes a screenshot of the window on mod+Shift+A and of the screen on mod+Shift+S', () => {
      expect(actionOf('input', { key: 'A', mod: true, shift: true }, apple)).toEqual({
        kind: 'screenshot',
        target: 'window',
      });
      expect(actionOf('input', { key: 's', mod: true, shift: true }, apple)).toEqual({
        kind: 'screenshot',
        target: 'screen',
      });
      expect(actionOf('input', { key: 'a', mod: true }, apple)).toBeUndefined();
    });

    it('ignores Enter with Alt', () => {
      expect(actionOf('input', { key: 'Enter', alt: true }, apple)).toBeUndefined();
      expect(actionOf('input', { key: 'Enter', alt: true, mod: true }, apple)).toBeUndefined();
    });

    it('leaves typing to the field', () => {
      expect(actionOf('input', { key: 'x' }, apple)).toBeUndefined();
      expect(actionOf('input', { key: 'ArrowUp' }, apple)).toBeUndefined();
    });
  });

  describe('in the list', () => {
    it('moves on ArrowDown and j, ArrowUp and k', () => {
      expect(actionOf('list', { key: 'ArrowDown' }, apple)).toEqual({ kind: 'move', by: 1 });
      expect(actionOf('list', { key: 'j' }, apple)).toEqual({ kind: 'move', by: 1 });
      expect(actionOf('list', { key: 'ArrowUp' }, apple)).toEqual({ kind: 'move', by: -1 });
      expect(actionOf('list', { key: 'k' }, apple)).toEqual({ kind: 'move', by: -1 });
    });

    it('goes back to the input on ArrowUp or k from the first row', () => {
      expect(actionOf('list', { key: 'ArrowUp' }, apple, { firstRow: true })).toEqual({
        kind: 'toInput',
      });
      expect(actionOf('list', { key: 'k' }, apple, { firstRow: true })).toEqual({
        kind: 'toInput',
      });
      expect(actionOf('list', { key: 'j' }, apple, { firstRow: true })).toEqual({
        kind: 'move',
        by: 1,
      });
    });

    it.each([
      [' ', { kind: 'peek' }],
      ['x', { kind: 'resolve' }],
      ['r', { kind: 'reply' }],
      ['c', { kind: 'copy' }],
      ['Enter', { kind: 'open' }],
      ['n', { kind: 'toInput' }],
    ])('maps %j to its action', (key, action) => {
      expect(actionOf('list', { key }, apple)).toEqual(action);
    });

    it('goes back to the input with any other character', () => {
      expect(actionOf('list', { key: 'h' }, apple)).toEqual({ kind: 'toInput', text: 'h' });
      expect(actionOf('list', { key: 'X', shift: true }, apple)).toEqual({
        kind: 'toInput',
        text: 'X',
      });
      expect(actionOf('list', { key: '?', shift: true }, apple)).toEqual({
        kind: 'toInput',
        text: '?',
      });
      expect(actionOf('list', { key: 'é' }, apple)).toEqual({ kind: 'toInput', text: 'é' });
    });

    it('ignores characters with mod or Alt, and keys that type nothing', () => {
      expect(actionOf('list', { key: 'j', mod: true }, apple)).toBeUndefined();
      expect(actionOf('list', { key: 'h', mod: true }, apple)).toBeUndefined();
      expect(actionOf('list', { key: 'h', alt: true }, apple)).toBeUndefined();
      expect(actionOf('list', { key: 'Tab' }, apple)).toBeUndefined();
      expect(actionOf('list', { key: 'Shift', shift: true }, apple)).toBeUndefined();
    });
  });

  describe('in the reply field', () => {
    it('sends on Enter and leaves typing to the field', () => {
      expect(actionOf('reply', { key: 'Enter' }, apple)).toEqual({ kind: 'send', open: false });
      expect(actionOf('reply', { key: 'x' }, apple)).toBeUndefined();
      expect(actionOf('reply', { key: 'Enter', alt: true }, apple)).toBeUndefined();
    });
  });

  describe('in the picker', () => {
    it('moves on the arrows and picks on Enter', () => {
      expect(actionOf('picker', { key: 'ArrowDown' }, apple)).toEqual({ kind: 'move', by: 1 });
      expect(actionOf('picker', { key: 'ArrowUp' }, apple)).toEqual({ kind: 'move', by: -1 });
      expect(actionOf('picker', { key: 'Enter' }, apple)).toEqual({ kind: 'pick' });
      expect(actionOf('picker', { key: 'j' }, apple)).toBeUndefined();
    });
  });

  it.each<CaptureZone>(['input', 'list', 'reply', 'picker'])('escapes in the %s', (zone) => {
    expect(actionOf(zone, { key: 'Escape' }, apple)).toEqual({ kind: 'escape' });
  });
});

describe('captureKeyAction on each platform', () => {
  const context = {
    zone: 'input' as const,
    inputEmpty: false,
    caretOnLastLine: false,
    firstRow: false,
  };
  const enter = { key: 'Enter', shiftKey: false, altKey: false };

  it('reads mod as ⌘ on Apple platforms and as Ctrl elsewhere', () => {
    const command = { ...enter, metaKey: true, ctrlKey: false };
    const control = { ...enter, metaKey: false, ctrlKey: true };
    expect(captureKeyAction(command, { ...context, apple: true })).toEqual({
      kind: 'send',
      open: true,
    });
    expect(captureKeyAction(control, { ...context, apple: false })).toEqual({
      kind: 'send',
      open: true,
    });
    // The other platform's key is no mod.
    expect(captureKeyAction(control, { ...context, apple: true })).toBeUndefined();
    expect(captureKeyAction(command, { ...context, apple: false })).toBeUndefined();
  });
});
