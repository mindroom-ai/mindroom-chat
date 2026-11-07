import { afterEach, describe, expect, it, vi } from 'vitest';
import { pluginPublicUrl } from './core';

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
