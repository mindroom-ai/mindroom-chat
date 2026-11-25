// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopShellEvent } from '../lib/desktopBridge';
import { settingsModalAtom } from '../navigation/settingsModal';
import { SettingsPages } from '../navigation/settingsPages';

const mocks = vi.hoisted(() => ({
  listeners: new Set<(event: DesktopShellEvent) => void>(),
  bridge: undefined as DesktopBridge | undefined,
}));

vi.mock('../lib/nativeShell', () => ({
  desktopBridge: () => mocks.bridge,
}));

import { DesktopAccessShellEventsFeature } from './ClientNonUIFeatures';

afterEach(() => {
  cleanup();
  mocks.listeners.clear();
  mocks.bridge = undefined;
});

describe('DesktopAccessShellEventsFeature', () => {
  it('opens Settings -> This Mac when the tray emits open-desktop-access-settings', () => {
    mocks.bridge = {
      onShellEvent: (listener: (event: DesktopShellEvent) => void) => {
        mocks.listeners.add(listener);
        return () => mocks.listeners.delete(listener);
      },
    } as unknown as DesktopBridge;

    const store = createStore();
    render(
      <Provider store={store}>
        <DesktopAccessShellEventsFeature />
      </Provider>
    );

    expect(store.get(settingsModalAtom)).toBeUndefined();

    act(() => {
      mocks.listeners.forEach((listener) => listener({ type: 'open-desktop-access-settings' }));
    });
    const first = store.get(settingsModalAtom);
    expect(first?.initialPage).toBe(SettingsPages.ThisMacPage);
    expect(first?.requestId).toBeTruthy();

    act(() => {
      mocks.listeners.forEach((listener) => listener({ type: 'open-desktop-access-settings' }));
    });
    const second = store.get(settingsModalAtom);
    expect(second?.initialPage).toBe(SettingsPages.ThisMacPage);
    expect(second?.requestId).not.toBe(first?.requestId);
  });
});
