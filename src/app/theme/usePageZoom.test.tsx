// @vitest-environment jsdom
import { Capacitor } from '@capacitor/core';
import { act, cleanup, renderHook } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsAtom } from '../preferences/settings';
import { hasShortcutHandler, runShortcut } from '../shortcuts/useShortcut';
import { usePageZoom } from './usePageZoom';

const zoom = () => getDefaultStore().get(settingsAtom).pageZoom;
const setZoom = (pageZoom: number) =>
  getDefaultStore().set(settingsAtom, { ...getDefaultStore().get(settingsAtom), pageZoom });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setZoom(100);
});

describe('usePageZoom zoom keys', () => {
  it('leaves the keys to the browser outside the native apps', () => {
    renderHook(() => usePageZoom());
    expect(hasShortcutHandler('zoomIn')).toBe(false);
    expect(hasShortcutHandler('zoomOut')).toBe(false);
    expect(hasShortcutHandler('resetZoom')).toBe(false);
  });

  it('steps the page zoom setting in the native apps', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    setZoom(117);
    renderHook(() => usePageZoom());
    const key = new KeyboardEvent('keydown');
    act(() => {
      expect(runShortcut('zoomIn', key)).toBe(true);
    });
    expect(zoom()).toBe(125);
    act(() => {
      runShortcut('zoomOut', key);
      runShortcut('zoomOut', key);
    });
    expect(zoom()).toBe(100);
    act(() => {
      runShortcut('zoomIn', key);
      runShortcut('resetZoom', key);
    });
    expect(zoom()).toBe(100);
    expect(document.documentElement.style.fontSize).toBe('');
  });
});
