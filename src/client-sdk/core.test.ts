import { afterEach, describe, expect, it, vi } from 'vitest';
import { pluginPublicUrl, reloadForNewVersion } from './core';

// The page's version check, which the test finishes, and its reloads.
const update = vi.hoisted(() => ({ finishCheck: () => {}, reloads: 0 }));
vi.mock('../app/config/appUpdate', () => ({
  checkForNewVersion: () =>
    new Promise<void>((resolve) => {
      update.finishCheck = resolve;
    }),
  reloadForNewVersion: () => {
    update.reloads += 1;
    return Promise.resolve();
  },
}));

describe('pluginPublicUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is the URL of the plugin's public/ files, under the app's base path", () => {
    vi.stubGlobal('__APP_BASE_PATH__', '/');
    expect(pluginPublicUrl('my-plugin')).toBe('/public/plugins/my-plugin/');
    vi.stubGlobal('__APP_BASE_PATH__', '/mindroom/');
    expect(pluginPublicUrl('my-plugin')).toBe('/mindroom/public/plugins/my-plugin/');
  });
});

describe('reloadForNewVersion', () => {
  it('reloads once the page asked the server for its version', async () => {
    const reloading = reloadForNewVersion();
    await Promise.resolve();
    expect(update.reloads).toBe(0);
    update.finishCheck();
    await reloading;
    expect(update.reloads).toBe(1);
  });
});
