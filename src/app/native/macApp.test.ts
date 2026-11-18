import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { offersMacApp } from './macApp';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(), getPlatform: vi.fn() },
  registerPlugin: vi.fn(() => ({})),
}));
vi.mock('@capacitor/browser', () => ({ Browser: { close: vi.fn(), open: vi.fn() } }));

const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const browser = (userAgent: string, platform: string, maxTouchPoints = 0) =>
  vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints });

describe('offersMacApp', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true in a browser on a Mac', () => {
    browser(MAC_SAFARI, 'MacIntel');
    expect(offersMacApp()).toBe(true);
  });

  it("is false inside the Mac app, a Mac user agent on Capacitor's native iOS bridge", () => {
    browser(MAC_SAFARI, 'MacIntel');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    expect(offersMacApp()).toBe(false);
  });

  it('is false on an iPad in desktop mode, which reports a Mac with a touch screen', () => {
    browser(MAC_SAFARI, 'MacIntel', 5);
    expect(offersMacApp()).toBe(false);
  });

  it('is false on Windows', () => {
    browser(WINDOWS_CHROME, 'Win32');
    expect(offersMacApp()).toBe(false);
  });
});
