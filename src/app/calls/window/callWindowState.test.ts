// @vitest-environment jsdom
import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  callWindowStorageKey,
  clearCallWindowStore,
  expandedSettings,
  getCallWindowSettingsAtom,
  getCallWindowSplitAtom,
  getCallWindowTranscriptAtom,
  minimizedSettings,
  normalizeCallWindowSettings,
} from './callWindowState';

const USER = '@a:x';
const rect = { x: 100, y: 200, width: 400, height: 480 };
const viewport = { width: 1280, height: 800 };

beforeEach(() => localStorage.clear());
afterEach(() => clearCallWindowStore(USER));

describe('normalizeCallWindowSettings', () => {
  it('gives the defaults for junk', () => {
    expect(normalizeCallWindowSettings(null)).toEqual({ mode: 'floating' });
    expect(normalizeCallWindowSettings('x')).toEqual({ mode: 'floating' });
    expect(normalizeCallWindowSettings({ mode: 'side' })).toEqual({ mode: 'floating' });
  });

  it('keeps a docked mode', () => {
    expect(normalizeCallWindowSettings({ mode: 'docked' })).toEqual({ mode: 'docked' });
  });

  it('drops a rectangle with a bad field', () => {
    expect(
      normalizeCallWindowSettings({ mode: 'floating', rect: { ...rect, x: Number.NaN } })
    ).toEqual({ mode: 'floating' });
    expect(normalizeCallWindowSettings({ mode: 'floating', rect: { ...rect, width: 0 } })).toEqual({
      mode: 'floating',
    });
  });

  it('keeps a good rectangle and a height of at least the minimum', () => {
    expect(normalizeCallWindowSettings({ mode: 'floating', rect, expandedHeight: 300 })).toEqual({
      mode: 'floating',
      rect,
      expandedHeight: 300,
    });
    expect(normalizeCallWindowSettings({ mode: 'floating', expandedHeight: 100 })).toEqual({
      mode: 'floating',
    });
  });

  it('keeps whether the transcript shows and a split between a quarter and four fifths', () => {
    expect(
      normalizeCallWindowSettings({ mode: 'floating', transcript: true, transcriptSplit: 0.25 })
    ).toEqual({ mode: 'floating', transcript: true, transcriptSplit: 0.25 });
    expect(normalizeCallWindowSettings({ mode: 'docked', transcriptSplit: 0.8 })).toEqual({
      mode: 'docked',
      transcriptSplit: 0.8,
    });
  });

  it.each([
    [{ transcript: 'yes' }],
    [{ transcriptSplit: 0.2 }],
    [{ transcriptSplit: 0.81 }],
    [{ transcriptSplit: '0.5' }],
    [{ transcriptSplit: Number.NaN }],
  ])('drops a transcript setting that is junk (%o)', (junk) => {
    expect(normalizeCallWindowSettings({ mode: 'floating', ...junk })).toEqual({
      mode: 'floating',
    });
  });
});

describe('the window transcript settings', () => {
  it('are off with the stage at 60 percent until set', () => {
    const store = createStore();
    expect(store.get(getCallWindowTranscriptAtom(USER))).toBe(false);
    expect(store.get(getCallWindowSplitAtom(USER))).toBe(0.6);
  });

  it('show the transcript, and expand a bar to show it', () => {
    const store = createStore();
    const bar = minimizedSettings({ mode: 'floating', rect }, rect);
    store.set(getCallWindowSettingsAtom(USER), bar);

    store.set(getCallWindowTranscriptAtom(USER), true);
    const shown = store.get(getCallWindowSettingsAtom(USER));
    expect(shown.transcript).toBe(true);
    expect(shown.rect?.height).toBe(480);
    expect(store.get(getCallWindowTranscriptAtom(USER))).toBe(true);

    store.set(getCallWindowTranscriptAtom(USER), false);
    expect(store.get(getCallWindowSettingsAtom(USER))).toEqual({ ...shown, transcript: false });
  });

  it('keep the split the divider sets, within its bounds', () => {
    const store = createStore();
    store.set(getCallWindowSplitAtom(USER), 0.7);
    expect(store.get(getCallWindowSettingsAtom(USER)).transcriptSplit).toBe(0.7);
    store.set(getCallWindowSplitAtom(USER), 0.95);
    expect(store.get(getCallWindowSplitAtom(USER))).toBe(0.8);
  });
});

describe('getCallWindowSettingsAtom', () => {
  it('reads what storage holds', () => {
    localStorage.setItem(callWindowStorageKey(USER), JSON.stringify({ mode: 'docked' }));
    const store = createStore();
    expect(store.get(getCallWindowSettingsAtom(USER))).toEqual({ mode: 'docked' });
  });

  it('writes JSON under the account key and keeps one atom per account', () => {
    const store = createStore();
    const atom = getCallWindowSettingsAtom(USER);
    store.set(atom, { mode: 'floating', rect });
    expect(JSON.parse(localStorage.getItem('mindroom.callWindow:@a:x') ?? 'null')).toEqual({
      mode: 'floating',
      rect,
    });
    expect(getCallWindowSettingsAtom(USER)).toBe(atom);
  });

  it('follows another tab', () => {
    const store = createStore();
    const atom = getCallWindowSettingsAtom(USER);
    const unsubscribe = store.sub(atom, () => undefined);
    localStorage.setItem(callWindowStorageKey(USER), JSON.stringify({ mode: 'docked' }));
    window.dispatchEvent(new StorageEvent('storage', { key: callWindowStorageKey(USER) }));
    expect(store.get(atom)).toEqual({ mode: 'docked' });
    unsubscribe();
  });
});

describe('minimize and expand', () => {
  it('returns the old height and keeps the bottom edge', () => {
    const bar = minimizedSettings({ mode: 'floating', rect }, rect);
    expect(bar.rect).toEqual({ x: 100, y: 624, width: 400, height: 56 });
    expect(bar.expandedHeight).toBe(480);
    const back = expandedSettings(bar, bar.rect!, viewport);
    expect(back.rect).toEqual(rect);
  });

  it('expands a bar at the top of the viewport downward', () => {
    const high = { x: 100, y: 8, width: 400, height: 56 };
    const back = expandedSettings(
      { mode: 'floating', rect: high, expandedHeight: 300 },
      high,
      viewport
    );
    expect(back.rect).toEqual({ x: 100, y: 8, width: 400, height: 300 });
  });

  it('falls back to the default height and fits the viewport', () => {
    const low = { x: 100, y: 780, width: 400, height: 56 };
    const back = expandedSettings({ mode: 'floating', rect: low }, low, {
      width: 1280,
      height: 600,
    });
    expect(back.rect?.height).toBe(480);
    expect(back.rect!.y + back.rect!.height).toBeLessThanOrEqual(592);
  });
});

describe('clearCallWindowStore', () => {
  it('removes the key', () => {
    localStorage.setItem(callWindowStorageKey(USER), '{"mode":"docked"}');
    clearCallWindowStore(USER);
    expect(localStorage.getItem(callWindowStorageKey(USER))).toBeNull();
  });
});
