import { describe, expect, it } from 'vitest';

import { APP_STORE_SCREENSHOT_SETS } from '../../../scripts/appstore-release-preflight.mjs';
import {
  APP_STORE_SCREENSHOT_DEVICES,
  APP_STORE_SCREENSHOT_SCENES,
  getAppStoreScreenshotFileName,
} from './appStoreScreenshots';

// The release preflight runs under plain node, so it lists the screenshot set itself. It must
// expect exactly the files e2e/diagnostics/app-store-screenshots.spec.ts writes, or every release stops there.
describe('App Store release screenshot set', () => {
  it('expects one file per capture device, at the size the capture produces', () => {
    expect(APP_STORE_SCREENSHOT_SETS.map(({ width, height }) => ({ width, height }))).toEqual(
      APP_STORE_SCREENSHOT_DEVICES.map((device) => device.expectedPixels)
    );
  });

  it('expects the file names the capture writes, scene by scene', () => {
    expect(APP_STORE_SCREENSHOT_SETS.map((set) => set.filenames)).toEqual(
      APP_STORE_SCREENSHOT_DEVICES.map((device) =>
        APP_STORE_SCREENSHOT_SCENES.map((scene) => getAppStoreScreenshotFileName(device, scene))
      )
    );
  });
});
