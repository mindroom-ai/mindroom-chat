// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isDesktopWebKit } from './user-agent';

const origUA = navigator.userAgent;
const origPlatform = navigator.platform;
const origTouchPoints = navigator.maxTouchPoints;

const setEnv = (userAgent: string, platform = 'MacIntel', maxTouchPoints = 0) => {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
};

afterEach(() => {
  setEnv(origUA, origPlatform, origTouchPoints);
});

describe('isDesktopWebKit', () => {
  it('matches desktop Safari and macOS WKWebView', () => {
    setEnv(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    );
    expect(isDesktopWebKit()).toBe(true);

    setEnv(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
    );
    expect(isDesktopWebKit()).toBe(true);
  });

  it('excludes Chromium, Firefox, iOS, iPadOS desktop mode, Android, and jsdom', () => {
    setEnv(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    );
    expect(isDesktopWebKit()).toBe(false);

    setEnv('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0');
    expect(isDesktopWebKit()).toBe(false);

    setEnv(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'iPhone',
      5
    );
    expect(isDesktopWebKit()).toBe(false);

    setEnv(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'MacIntel',
      5
    );
    expect(isDesktopWebKit()).toBe(false);

    setEnv(
      'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
      'Linux armv8l',
      5
    );
    expect(isDesktopWebKit()).toBe(false);

    setEnv('Mozilla/5.0 (linux) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.0.0', 'Linux', 0);
    expect(isDesktopWebKit()).toBe(false);
  });
});
