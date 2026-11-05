import { describe, expect, it } from 'vitest';
import {
  type CommandPaletteTabKey,
  getCommandPaletteHighlightIndex,
  getCommandPaletteTabStep,
  getNextCommandPaletteTab,
} from './commandPaletteNavigation';

const press = (key: string, change: Partial<CommandPaletteTabKey> = {}) => {
  const query = change.query ?? 'design';
  const caret = change.selectionStart ?? query.length;
  return getCommandPaletteTabStep({
    key,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    query,
    selectionStart: caret,
    selectionEnd: change.selectionEnd ?? caret,
    navigating: false,
    textDirection: 'ltr',
    tabDirection: 'ltr',
    ...change,
  });
};

describe('getCommandPaletteTabStep', () => {
  it('switches with Tab and Shift+Tab wherever the caret is', () => {
    expect(press('Tab', { selectionStart: 3 })).toBe(1);
    expect(press('Tab', { shiftKey: true, selectionStart: 0 })).toBe(-1);
    expect(press('Tab', { query: '' })).toBe(1);
  });

  it('switches with either arrow while the query is empty', () => {
    expect(press('ArrowRight', { query: '' })).toBe(1);
    expect(press('ArrowLeft', { query: '' })).toBe(-1);
  });

  it('switches with either arrow right after the up or down arrow, caret anywhere', () => {
    expect(press('ArrowLeft', { navigating: true, selectionStart: 3 })).toBe(-1);
    expect(press('ArrowRight', { navigating: true, selectionStart: 0 })).toBe(1);
  });

  it('moves the caret with left in the middle and at the end of typed text', () => {
    expect(press('ArrowLeft', { selectionStart: 3 })).toBe(0);
    expect(press('ArrowLeft', { selectionStart: 6 })).toBe(0);
  });

  it('switches with left only from the start of typed text', () => {
    expect(press('ArrowLeft', { selectionStart: 0 })).toBe(-1);
  });

  it('moves the caret with right at the start and in the middle of typed text', () => {
    expect(press('ArrowRight', { selectionStart: 0 })).toBe(0);
    expect(press('ArrowRight', { selectionStart: 3 })).toBe(0);
  });

  it('switches with right only from the end of typed text', () => {
    expect(press('ArrowRight', { selectionStart: 6 })).toBe(1);
  });

  it('leaves a selection, Shift, word jumps and other keys to the field', () => {
    expect(press('ArrowRight', { selectionStart: 2, selectionEnd: 6 })).toBe(0);
    expect(press('ArrowRight', { shiftKey: true })).toBe(0);
    expect(press('ArrowLeft', { selectionStart: 0, altKey: true })).toBe(0);
    expect(press('ArrowRight', { ctrlKey: true })).toBe(0);
    expect(press('Tab', { metaKey: true })).toBe(0);
    expect(press('Home', { query: '' })).toBe(0);
    expect(press('a')).toBe(0);
  });

  it('follows the direction of right-to-left text and a right-to-left tab row', () => {
    // In right-to-left text the left arrow moves toward the end of the text.
    expect(press('ArrowLeft', { textDirection: 'rtl', selectionStart: 6 })).toBe(-1);
    expect(press('ArrowRight', { textDirection: 'rtl', selectionStart: 6 })).toBe(0);
    // In a right-to-left tab row the next tab sits to the left.
    expect(press('ArrowLeft', { query: '', tabDirection: 'rtl' })).toBe(1);
    expect(press('ArrowRight', { query: '', tabDirection: 'rtl' })).toBe(-1);
  });
});

describe('getNextCommandPaletteTab', () => {
  const tabs = ['all', 'rooms', 'messages'] as const;

  it('moves by the step and wraps at both ends', () => {
    expect(getNextCommandPaletteTab(tabs, 'all', 1)).toBe('rooms');
    expect(getNextCommandPaletteTab(tabs, 'messages', 1)).toBe('all');
    expect(getNextCommandPaletteTab(tabs, 'all', -1)).toBe('messages');
  });
});

describe('getCommandPaletteHighlightIndex', () => {
  it('keeps the highlighted row when message results arrive below it', () => {
    const before = ['room:a', 'room:b', 'thread:c'];
    const after = [...before, 'message:1', 'message:2', 'search-page'];
    expect(getCommandPaletteHighlightIndex(before, 'room:b', 1)).toBe(1);
    expect(getCommandPaletteHighlightIndex(after, 'room:b', 1)).toBe(1);
  });

  it('follows the highlighted row when rows above it change', () => {
    expect(getCommandPaletteHighlightIndex(['room:x', 'room:a', 'room:b'], 'room:b', 1)).toBe(2);
  });

  it('starts at the first row when nothing was chosen yet', () => {
    expect(getCommandPaletteHighlightIndex(['message:1', 'message:2'], undefined, 0)).toBe(0);
  });

  it('hands a vanished row its place, within the rows that are left', () => {
    expect(getCommandPaletteHighlightIndex(['a', 'b', 'c'], 'gone', 1)).toBe(1);
    expect(getCommandPaletteHighlightIndex(['a'], 'gone', 4)).toBe(0);
    expect(getCommandPaletteHighlightIndex([], 'gone', 2)).toBe(-1);
  });
});
