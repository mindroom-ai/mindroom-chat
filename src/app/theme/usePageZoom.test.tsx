// @vitest-environment jsdom
import { Capacitor } from '@capacitor/core';
import { act, cleanup, renderHook } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsAtom } from '../preferences/settings';
import { usePageZoom } from './usePageZoom';

const store = getDefaultStore();
const zoom = () => store.get(settingsAtom).pageZoom;
const setZoom = (pageZoom: number) =>
  store.set(settingsAtom, { ...store.get(settingsAtom), pageZoom });

/** A key pressed (Ctrl, as jsdom is no Apple platform) in a focused field inside a dialog. */
const pressInDialog = (key: string, repeat = false) => {
  const input = document.querySelector('input') as HTMLInputElement;
  input.focus();
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: true,
    repeat,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    input.dispatchEvent(event);
  });
  return event;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setZoom(100);
  document.body.innerHTML = '';
});

// Rendered alone: no signed-in shell and its shortcut listener, as on the sign-in page.
describe('usePageZoom zoom keys', () => {
  const setup = (native: boolean, start: number) => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(native);
    document.body.innerHTML = '<div role="dialog"><input type="text" value="Hello" /></div>';
    setZoom(start);
    renderHook(() => usePageZoom());
  };

  it('steps the setting once per key event in the native apps, held keys too', () => {
    setup(true, 117);
    expect(pressInDialog('=').defaultPrevented).toBe(true);
    expect(zoom()).toBe(125);
    pressInDialog('=', true);
    expect(zoom()).toBe(150);
    pressInDialog('+', true);
    expect(zoom()).toBe(150);
    pressInDialog('-');
    pressInDialog('-', true);
    expect(zoom()).toBe(110);
    pressInDialog('0');
    expect(zoom()).toBe(100);
    expect(document.documentElement.style.fontSize).toBe('');
  });

  it('leaves the keys to the browser elsewhere', () => {
    setup(false, 110);
    expect(pressInDialog('=').defaultPrevented).toBe(false);
    expect(pressInDialog('-', true).defaultPrevented).toBe(false);
    expect(pressInDialog('0').defaultPrevented).toBe(false);
    expect(zoom()).toBe(110);
  });
});
