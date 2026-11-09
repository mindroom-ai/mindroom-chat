import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../app/i18n/i18n';
import { registerPluginTranslations } from '../app/plugins/pluginTranslations';
import { getPluginTranslation, pluginPublicUrl, reloadForNewVersion } from './core';

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

describe('getPluginTranslation', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    vi.unstubAllGlobals();
  });

  it("translates a plugin's strings outside React, in the language in use when it is called", async () => {
    // The app's own catalogs come from the deployment.
    vi.stubGlobal('fetch', async () => Response.json({}));
    registerPluginTranslations('demo', {
      en: { greeting: 'Hello, {{name}}' },
      load: async (language: string) =>
        language === 'de' ? { greeting: 'Hallo, {{name}}' } : undefined,
    });
    const t = getPluginTranslation('demo');

    expect(t('greeting', { name: 'Ada' })).toBe('Hello, Ada');
    await i18n.changeLanguage('de');
    expect(t('greeting', { name: 'Ada' })).toBe('Hallo, Ada');
  });
});
