// `@mindroom/client-sdk/testing`, the client SDK's subpath for a plugin's unit tests, which run in
// the app's vitest (docs/architecture.md "Client plugins"). Only tests import it, never code that
// ships. Like `/core` it only grows, and each addition raises CLIENT_PLUGIN_API_VERSION.
import { cleanup, render, type RenderResult } from '@testing-library/react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../app/config/useClientConfig';
import i18n from '../app/i18n/i18n';
import { registerPluginTranslations } from '../app/plugins/pluginTranslations';
import type { ClientPlugin } from '../app/plugins/registry';

// The app's vitest has no globals, so React Testing Library does not unmount after each test itself.
afterEach(cleanup);

/**
 * Renders `ui`, made of the components of the plugin `id`, into the document as the app would:
 * `config` is the plugin's section of config.json (`plugins.<id>`, what `usePluginConfig` reads),
 * and `usePluginTranslation` translates into `language` (default English) with the strings of
 * `plugin`, its entry's default export. The test file needs a DOM: `// @vitest-environment jsdom`.
 */
export const renderPluginComponent = async (
  ui: ReactElement,
  {
    id,
    plugin,
    config,
    language = 'en',
  }: { id: string; plugin: ClientPlugin; config?: unknown; language?: string }
): Promise<RenderResult> => {
  registerPluginTranslations(id, plugin.translations);
  await i18n.changeLanguage(language);
  const clientConfig = { plugins: { [id]: config } } as unknown as ClientConfig;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ClientConfigProvider, { value: clientConfig }, children);
  return render(ui, { wrapper });
};
