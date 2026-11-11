// `@mindroom/client-sdk/fixtures`, the client SDK's subpath for a plugin's end-to-end fixture pages
// (`e2e/fixtures/<page>.html`), which render its components on their own, outside the app, in the
// browser (docs/architecture.md "Client plugins"). Only fixture pages import it, never code that
// ships: the dev server and the fixture page build resolve it, the app's build does not. Like
// `/core` it only grows, and each addition raises CLIENT_PLUGIN_API_VERSION.
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../index.css';
import '../app/theme/Typography.css';
import type { MatrixClient } from 'matrix-js-sdk';
import i18n from '../app/i18n/i18n';
import { registerPluginTranslations } from '../app/plugins/pluginTranslations';
import type { ClientPlugin } from '../app/plugins/registry';
import { applyAppTheme } from '../app/theme/appliedTheme';
import { DarkTheme, LightTheme, ThemeKind } from '../app/theme/useTheme';
import { serverAt } from './internal/serverAt';
import type { MindroomServer } from './server';

/**
 * Sets the page up as the app sets itself up before it renders, for the components of the plugin
 * `id`, `plugin` its entry's default export: the app's styles and fonts load with this module, the
 * app's light or dark theme (`appearance`, default `light`) applies to the document, marked on its
 * root element as `useThemeKind` reads it, and `usePluginTranslation` and `getPluginTranslation`
 * translate with the plugin's strings into `language`, else the language the app would pick in this
 * browser. Resolves once those strings have loaded; render after it.
 */
export const bootFixturePage = async ({
  id,
  plugin,
  appearance = ThemeKind.Light,
  language,
}: {
  id: string;
  plugin: ClientPlugin;
  appearance?: ThemeKind;
  language?: string;
}): Promise<void> => {
  applyAppTheme(appearance === ThemeKind.Dark ? DarkTheme : LightTheme);
  registerPluginTranslations(id, plugin.translations);
  await i18n.changeLanguage(language);
};

/**
 * The `MindroomServer` at `apiUrl`, such as `http://127.0.0.1:29601`, for the account `client`
 * (matrix-js-sdk's, signed in), as `useMindroomServer` gives it to a room's components, outside
 * React: the same object, over the same session, for every caller with that client and server.
 * Its sign-in asks the homeserver for a token bound to the server, so the homeserver must bind
 * them, as for a server the room's agents published.
 */
export const fixtureMindroomServer = ({
  client,
  apiUrl,
}: {
  client: MatrixClient;
  apiUrl: string;
}): MindroomServer => serverAt(client, apiUrl);
