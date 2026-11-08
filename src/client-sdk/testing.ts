// `@mindroom/client-sdk/testing`, the client SDK's subpath for a plugin's unit tests, which run in
// the app's vitest (docs/architecture.md "Client plugins"). Only tests import it, never code that
// ships. Like `/core` it only grows, and each addition raises CLIENT_PLUGIN_API_VERSION.
import { cleanup, render } from '@testing-library/react';
import { getHttpUriForMxc, type MatrixClient } from 'matrix-js-sdk';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../app/config/useClientConfig';
import i18n from '../app/i18n/i18n';
import { MatrixClientProvider } from '../app/matrix/hooks/useMatrixClient';
import { putSession } from '../app/matrix/session/sessions';
import { registerPluginTranslations } from '../app/plugins/pluginTranslations';
import type { ClientPlugin } from '../app/plugins/registry';

// The app's vitest has no globals, so React Testing Library does not unmount after each test itself.
afterEach(cleanup);

/** The stand-in's homeserver. */
const HOMESERVER = 'https://example.org';

/**
 * The client of the account a plugin's components see signed in, unless the test gives one. It
 * knows no room, so the `room` subpath's paths name rooms by their ID, and builds media URLs as
 * matrix-js-sdk's client does, for the `matrix` subpath's `mxcUrlToHttp`.
 */
const standIn = {
  getSafeUserId: () => '@plugin-tester:example.org',
  getRoom: () => null,
  getRooms: () => [],
  getHomeserverUrl: () => HOMESERVER,
  mxcUrlToHttp: (...args: Parameters<MatrixClient['mxcUrlToHttp']>) =>
    getHttpUriForMxc(HOMESERVER, ...args),
} as unknown as MatrixClient;

/**
 * Renders `ui`, made of the components of the plugin `id`, into the document with what the SDK's
 * config, translation, storage and Matrix hooks need: `config` is the plugin's section of
 * config.json (`plugins.<id>`, what `usePluginConfig` reads), `usePluginTranslation` translates
 * into `language` (default English) with the strings of `plugin`, its entry's default export,
 * `useMatrixClient` returns `client`, the signed-in account's (default a stand-in that has
 * `getSafeUserId`, builds media URLs on `https://example.org` and knows no room), and
 * `usePluginStorage` keeps values in the document's localStorage, for the rest of the test file,
 * for that account, signed in there. A component that needs more of the app, such as a router for
 * `usePluginRouteHref` or the app's query client, gets it from `ui`. The test file needs
 * `// @vitest-environment jsdom`.
 */
export const renderPluginComponent = async (
  ui: ReactElement,
  {
    id,
    plugin,
    config,
    language = 'en',
    client = standIn,
  }: {
    id: string;
    plugin: ClientPlugin;
    config?: unknown;
    language?: string;
    client?: MatrixClient;
  }
) => {
  registerPluginTranslations(id, plugin.translations);
  await i18n.changeLanguage(language);
  // Without a login of the account in this browser, `usePluginStorage` stores nothing.
  putSession({
    baseUrl: 'https://example.org',
    userId: client.getSafeUserId(),
    deviceId: 'PLUGINTEST',
    accessToken: 'plugin-test',
  });
  const clientConfig = { plugins: { [id]: config } } as unknown as ClientConfig;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      MatrixClientProvider,
      { value: client },
      createElement(ClientConfigProvider, { value: clientConfig }, children)
    );
  return render(ui, { wrapper });
};
