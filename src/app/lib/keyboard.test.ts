import { describe, expect, it, vi } from 'vitest';
import { onTabPress, shortcutLetter } from './keyboard';

const keyEvent = (key: string) =>
  ({
    key,
    which: key === 'Tab' ? 9 : key === 'Enter' ? 13 : 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
  } as const);

describe('keyboard helpers', () => {
  it('runs autocomplete actions on Tab', () => {
    const event = keyEvent('Tab');
    const callback = vi.fn();

    onTabPress(event, callback);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('runs autocomplete actions on Enter', () => {
    const event = keyEvent('Enter');
    const callback = vi.fn();

    onTabPress(event, callback);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('shortcutLetter', () => {
  it.each([
    ['a Latin letter by its key', { key: 'V', code: 'KeyV' }, 'v'],
    ["Dvorak's V on the period key", { key: 'v', code: 'Period' }, 'v'],
    ["Dvorak's K on QWERTY's V", { key: 'k', code: 'KeyV' }, 'k'],
    ["a Cyrillic letter by its key's code", { key: 'м', code: 'KeyV' }, 'v'],
    ["BÉPO's period on V", { key: '.', code: 'KeyV' }, undefined],
    ['a letter of another script off the letter keys', { key: 'м', code: 'Period' }, undefined],
  ])('names %s', (_name, event, letter) => {
    expect(shortcutLetter(event)).toBe(letter);
  });
});
