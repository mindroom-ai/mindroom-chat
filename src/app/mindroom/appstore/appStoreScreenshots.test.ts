import { describe, expect, it } from 'vitest';
import {
  APP_STORE_SCREENSHOT_DEVICES,
  APP_STORE_SCREENSHOT_LOCALE,
  APP_STORE_SCREENSHOT_SCENES,
  getAppStoreScreenshotFileName,
  getAppStoreScreenshotRelativePath,
} from './appStoreScreenshots';

describe('app store screenshot plan', () => {
  it('captures the required iPhone and iPad App Store device classes', () => {
    expect(APP_STORE_SCREENSHOT_DEVICES).toEqual([
      expect.objectContaining({
        id: 'iphone-6-9',
        label: 'iPhone 6.9"',
        viewport: { width: 440, height: 956 },
        deviceScaleFactor: 3,
        expectedPixels: { width: 1320, height: 2868 },
      }),
      expect.objectContaining({
        id: 'ipad-13',
        label: 'iPad 13"',
        viewport: { width: 1032, height: 1376 },
        deviceScaleFactor: 2,
        expectedPixels: { width: 2064, height: 2752 },
      }),
    ]);
  });

  it('keeps screenshot filenames sorted by scene order within each device class', () => {
    expect(APP_STORE_SCREENSHOT_LOCALE).toBe('en-US');
    expect(APP_STORE_SCREENSHOT_SCENES.map((scene) => scene.id)).toEqual([
      'welcome',
      'room-overview',
      'thread-view',
    ]);

    expect(
      APP_STORE_SCREENSHOT_SCENES.map((scene) =>
        getAppStoreScreenshotFileName(APP_STORE_SCREENSHOT_DEVICES[0], scene)
      )
    ).toEqual([
      '0_iphone-6-9_welcome.png',
      '1_iphone-6-9_room-overview.png',
      '2_iphone-6-9_thread-view.png',
    ]);
  });

  it('writes screenshots into the fastlane locale folder', () => {
    expect(
      getAppStoreScreenshotRelativePath(
        APP_STORE_SCREENSHOT_DEVICES[1],
        APP_STORE_SCREENSHOT_SCENES[2]
      )
    ).toBe('ios/App/fastlane/screenshots/en-US/2_ipad-13_thread-view.png');
  });
});
