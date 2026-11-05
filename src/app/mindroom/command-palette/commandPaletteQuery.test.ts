import { describe, expect, it } from 'vitest';
import { getCommandPaletteSectionLimit, getCommandPaletteSectionOrder } from './commandPaletteQuery';

describe('getCommandPaletteSectionOrder', () => {
  it('puts rooms first on All and leaves messages out until there is text', () => {
    expect(getCommandPaletteSectionOrder('all', false)).toEqual([
      'rooms',
      'threads',
      'actions',
      'users',
    ]);
  });

  it('puts messages last on All once there is text, so server hits arrive below the rest', () => {
    expect(getCommandPaletteSectionOrder('all', true)).toEqual([
      'rooms',
      'threads',
      'users',
      'actions',
      'messages',
    ]);
  });

  it('shows only its own section on every other tab, with or without text', () => {
    expect(getCommandPaletteSectionOrder('rooms', true)).toEqual(['rooms']);
    expect(getCommandPaletteSectionOrder('threads', false)).toEqual(['threads']);
    expect(getCommandPaletteSectionOrder('users', true)).toEqual(['users']);
    expect(getCommandPaletteSectionOrder('messages', false)).toEqual(['messages']);
    expect(getCommandPaletteSectionOrder('actions', true)).toEqual(['actions']);
  });
});

describe('getCommandPaletteSectionLimit', () => {
  it('shows the top few of each section on All and many on its own tab', () => {
    expect(getCommandPaletteSectionLimit('rooms', 'all')).toBe(5);
    expect(getCommandPaletteSectionLimit('messages', 'all')).toBe(3);
    expect(getCommandPaletteSectionLimit('rooms', 'rooms')).toBe(50);
    expect(getCommandPaletteSectionLimit('messages', 'messages')).toBe(50);
  });
});
