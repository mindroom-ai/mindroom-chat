// `@mindroom/client-sdk/testing`, the client SDK's subpath for a plugin's unit tests, which run in
// the app's vitest (docs/client-plugins.md "testing"). Only tests import it, never code that
// ships. Like `/core` it only grows, and each addition, a new export or a new option of one, raises
// CLIENT_PLUGIN_API_VERSION; the stand-in client below is not exported, so what it learns raises
// nothing.
import { cleanup, render } from '@testing-library/react';
import { getHttpUriForMxc, type MatrixClient } from 'matrix-js-sdk';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../app/config/useClientConfig';
import i18n from '../app/i18n/i18n';
import { ScreenSize, ScreenSizeProvider } from '../app/lib/hooks/useScreenSize';
import { MatrixClientProvider } from '../app/matrix/hooks/useMatrixClient';
import { putSession } from '../app/matrix/session/sessions';
import { registerPluginTranslations } from '../app/plugins/pluginTranslations';
import type { ClientPlugin } from '../app/plugins/registry';
import type { ThemeKind } from '../app/theme/useTheme';
import { PanelFrameProvider, type PanelFrame } from '../app/ui/panels/panelFrameContext';
import { usePanelSlot } from '../app/ui/panels/panelPresence';

// The app's vitest has no globals, so React Testing Library does not unmount after each test itself.
afterEach(cleanup);

// The root element's theme kind mark before a test's `themeKind` replaced it, put back after the test.
let markBefore: { kind: string | undefined } | undefined;
afterEach(() => {
  if (!markBefore) return;
  const { dataset } = document.documentElement;
  if (markBefore.kind === undefined) delete dataset.themeKind;
  else dataset.themeKind = markBefore.kind;
  markBefore = undefined;
});

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
 * Registers the strings of the plugin `id`, `plugin` its entry's default export, so that
 * `usePluginTranslation` and `getPluginTranslation` translate with them in a test that renders
 * without `renderPluginComponent`, which registers them itself, such as one that uses React Testing
 * Library's `render` or `renderHook`. The strings stay registered for the rest of the test file.
 */
export const registerPluginStrings = (id: string, plugin: ClientPlugin) =>
  registerPluginTranslations(id, plugin.translations);

/**
 * Renders `ui`, made of the components of the plugin `id`, into the document with what the SDK's
 * config, translation, storage, Matrix, panel frame, screen size and theme kind hooks need:
 * `config` is the plugin's section of config.json (`plugins.<id>`, what `usePluginConfig` reads),
 * `usePluginTranslation` translates into `language` (default English) with the strings of `plugin`,
 * its entry's default export, `useMatrixClient` returns `client`, the signed-in account's (default
 * a stand-in that has `getSafeUserId`, builds media URLs on `https://example.org` and knows no
 * room), `usePluginStorage` keeps values in the document's localStorage, for the rest of the test
 * file, for that account, signed in there, and `usePanelFrame` returns `frame`, as the app gives it
 * to a side panel with `frame: 'own'` (default none). `useScreenSize` returns `screenSize` (default
 * `Desktop`), and `useThemeKind` returns `themeKind`, which marks the document's root element as
 * the app marks it, until the test ends (default the kind marked there, `light` when none is). A
 * component that needs more of the app, such as a router for `usePluginRouteHref` or the app's
 * query client, gets it from `ui`. One that uses `useMindroomServer`, `useMindroomServerStatus` or
 * `useRoomComputers` needs a `client` from matrix-js-sdk's `createClient`, whose homeserver the
 * hook asks through `fetch` whether it binds sign-in tokens, so the test stubs `fetch`. The test
 * file needs `// @vitest-environment jsdom`.
 */
export const renderPluginComponent = async (
  ui: ReactElement,
  {
    id,
    plugin,
    config,
    language = 'en',
    client = standIn,
    frame,
    screenSize = ScreenSize.Desktop,
    themeKind,
  }: {
    id: string;
    plugin: ClientPlugin;
    config?: unknown;
    language?: string;
    client?: MatrixClient;
    frame?: PanelFrame;
    screenSize?: ScreenSize;
    themeKind?: ThemeKind;
  }
) => {
  registerPluginStrings(id, plugin);
  await i18n.changeLanguage(language);
  // Without a login of the account in this browser, `usePluginStorage` stores nothing.
  putSession({
    baseUrl: 'https://example.org',
    userId: client.getSafeUserId(),
    deviceId: 'PLUGINTEST',
    accessToken: 'plugin-test',
  });
  if (themeKind) {
    const { dataset } = document.documentElement;
    markBefore ??= { kind: dataset.themeKind };
    dataset.themeKind = themeKind;
  }
  const clientConfig = { plugins: { [id]: config } } as unknown as ClientConfig;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      MatrixClientProvider,
      { value: client },
      createElement(
        ClientConfigProvider,
        { value: clientConfig },
        createElement(
          PanelFrameProvider,
          { value: frame },
          createElement(ScreenSizeProvider, { value: screenSize }, children)
        )
      )
    );
  return render(ui, { wrapper });
};

/**
 * The room's place for a side panel, holding `children`, the panel shown there under its key, or
 * none, as the room holds a plugin's panel: `usePanelPresence` inside gives the panel its phase,
 * `done` and `register`, and a panel that registered stays while it moves out until its
 * registration's `done`. A test rerenders it with another key to swap panels and with none to
 * close the panel, inside `renderPluginComponent` for the panel's frame. The room catches a panel
 * that fails inside the place, so a test of one puts its own error boundary around the panel.
 */
export function PanelPlace({ children }: { children?: ReactElement | null }) {
  return usePanelSlot(children ?? undefined) ?? null;
}
