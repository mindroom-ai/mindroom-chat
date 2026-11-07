import { afterEach, describe, expect, it } from 'vitest';
import { pluginPublicUrl } from './core';

describe('pluginPublicUrl', () => {
  const runtime = globalThis as { __APP_BASE_PATH__?: string };
  const original = runtime.__APP_BASE_PATH__;
  afterEach(() => {
    runtime.__APP_BASE_PATH__ = original;
  });

  it("is the URL of the plugin's public/ files, under the app's base path", () => {
    runtime.__APP_BASE_PATH__ = '/';
    expect(pluginPublicUrl('my-plugin')).toBe('/public/plugins/my-plugin/');
    runtime.__APP_BASE_PATH__ = '/mindroom/';
    expect(pluginPublicUrl('my-plugin')).toBe('/mindroom/public/plugins/my-plugin/');
  });
});
