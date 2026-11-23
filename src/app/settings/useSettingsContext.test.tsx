// @vitest-environment jsdom
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsContext } from '../preferences/settingsRegistry';
import { useSettingsContext } from './useSettingsContext';

const mocks = vi.hoisted(() => ({
  isNativeIOS: vi.fn(() => false),
  getDebugModeEnabled: vi.fn(() => false),
}));

vi.mock('../native/nativeSso', () => ({ isNativeIOS: mocks.isNativeIOS }));
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
    mocks.isNativeIOS.mockReturnValue(false);
    mocks.getDebugModeEnabled.mockReturnValue(false);
    Reflect.deleteProperty(window, 'mindroomDesktop');
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    Reflect.deleteProperty(window, 'mindroomDesktop');
  });

  it('enables diagnostics in the Electron desktop app while keeping nativeIOS false', () => {
    expect(read()).toMatchObject({ native: false, nativeIOS: false, diagnostics: false });
    act(() => renderer?.unmount());

    Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: {} });
    expect(read()).toMatchObject({ native: true, nativeIOS: false, diagnostics: true });
  });
});
