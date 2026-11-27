// @vitest-environment jsdom
import { Capacitor } from '@capacitor/core';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsContext } from '../preferences/settingsRegistry';
import { useSettingsContext } from './useSettingsContext';

const mocks = vi.hoisted(() => ({
  getDebugModeEnabled: vi.fn(() => false),
}));

vi.mock('../diagnostics/debugMode', () => ({ getDebugModeEnabled: mocks.getDebugModeEnabled }));
vi.mock('../local-mindroom/useShowLocalMindroom', () => ({ useShowLocalMindroom: () => false }));
vi.mock('../native/macApp', () => ({ useOffersMacApp: () => false }));
vi.mock('./railButtons', () => ({ useOfferedRailButtons: () => [] }));
vi.mock('../config/useClientConfig', () => ({ useClientConfig: () => ({}) }));
vi.mock('../matrix/hooks/useCapabilities', () => ({ useCapabilities: () => undefined }));
vi.mock('../server-admin/accounts', () => ({ isServerAdmin: () => false }));

describe('useSettingsContext', () => {
  let renderer: ReactTestRenderer | undefined;
  let captured: SettingsContext | undefined;

  function Capture() {
    captured = useSettingsContext();
    return null;
  }

  const read = (): SettingsContext => {
    captured = undefined;
    const store = createStore();
    act(() => {
      renderer = create(
        <Provider store={store}>
          <Capture />
        </Provider>
      );
    });
    return captured!;
  };

  beforeEach(() => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
    mocks.getDebugModeEnabled.mockReturnValue(false);
    Reflect.deleteProperty(window, 'mindroomDesktop');
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    Reflect.deleteProperty(window, 'mindroomDesktop');
    vi.restoreAllMocks();
  });

  it('enables diagnostics in the Electron desktop app while keeping capacitor and nativeIOS false', () => {
    expect(read()).toMatchObject({
      native: false,
      capacitor: false,
      nativeIOS: false,
      diagnostics: false,
      nativeUpdate: false,
    });
    act(() => renderer?.unmount());

    Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: {} });
    expect(read()).toMatchObject({
      native: true,
      capacitor: false,
      nativeIOS: false,
      diagnostics: true,
      nativeUpdate: false,
    });
    act(() => renderer?.unmount());

    Object.defineProperty(window, 'mindroomDesktop', {
      configurable: true,
      value: { update: { status: vi.fn(), check: vi.fn(), install: vi.fn() } },
    });
    expect(read()).toMatchObject({
      native: true,
      capacitor: false,
      nativeUpdate: true,
      desktopAccess: false,
    });
    act(() => renderer?.unmount());

    Object.defineProperty(window, 'mindroomDesktop', {
      configurable: true,
      value: { desktopAccess: { status: vi.fn() } },
    });
    expect(read()).toMatchObject({ native: true, capacitor: false, desktopAccess: true });
  });

  it('sets capacitor and diagnostics on native Android and iOS', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');

    expect(read()).toMatchObject({
      native: true,
      capacitor: true,
      nativeIOS: false,
      diagnostics: true,
    });
    act(() => renderer?.unmount());

    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    expect(read()).toMatchObject({
      native: true,
      capacitor: true,
      nativeIOS: true,
      diagnostics: true,
    });
  });
});
