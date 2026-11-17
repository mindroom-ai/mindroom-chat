import { describe, expect, it } from 'vitest';
import { readRoomSettingValue } from './roomSettings';

describe('readRoomSettingValue', () => {
  it('reads a string value, trimmed', () => {
    expect(readRoomSettingValue({ value: 'Use at most 4 words' })).toBe('Use at most 4 words');
    expect(readRoomSettingValue({ value: '  Use at most 4 words\n' })).toBe('Use at most 4 words');
  });

  it('keeps the white space inside the value', () => {
    expect(readRoomSettingValue({ value: 'Line one\n\nLine two' })).toBe('Line one\n\nLine two');
  });

  it.each([
    ['a missing event', undefined],
    ['null', null],
    ['a cleared setting', {}],
    ['a number', { value: 4 }],
    ['null as the value', { value: null }],
    ['a list', { value: ['Use at most 4 words'] }],
    ['an empty string', { value: '' }],
    ['white space only', { value: ' \n\t ' }],
    ['content that is not an object', 'Use at most 4 words'],
  ])('leaves the setting unset for %s', (_name, content) => {
    expect(readRoomSettingValue(content)).toBeUndefined();
  });
});
