// @vitest-environment jsdom
// `bootFixturePage` and `fixtureMindroomServer`, as a plugin's fixture page meets them: through the
// SDK only, with nothing the subpath needs from Vitest.
import { resolve } from 'node:path';
import type { IOpenIDToken, MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPluginTranslation } from '@mindroom/client-sdk/core';
import { bootFixturePage, fixtureMindroomServer } from '@mindroom/client-sdk/fixtures';
import { clientSessions } from '../app/computer/clientSessions';
import { REPO_ROOT, moduleDependencies, resolveRelativeModule } from '../test/architecture';

vi.mock('../app/matrix/openidAudience', () => ({
  requestAudienceOpenIdToken: async (): Promise<IOpenIDToken> => ({
    access_token: 'openid',
    token_type: 'Bearer',
    matrix_server_name: 'example.org',
    expires_in: 3600,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The packages that the modules `file` imports statically import, through its relative imports. */
const packagesImported = (file: string): string[] => {
  const seen = new Set([file]);
  const packages = new Set<string>();
  for (const module of seen) {
    moduleDependencies(module)
      .filter(({ kind, typeOnly }) => (kind === 'import' || kind === 'export') && !typeOnly)
      .forEach(({ specifier }) => {
        const relative = resolveRelativeModule(module, specifier);
        if (relative === undefined) packages.add(specifier);
        else if (/\.[jt]sx?$/.test(relative)) seen.add(relative);
      });
  }
  return [...packages];
};

describe('the fixtures subpath', () => {
  it('imports no test runner or testing library, which a browser page cannot load', () => {
    const testRunners = (file: string) =>
      packagesImported(resolve(REPO_ROOT, 'src/client-sdk', file)).filter((name) =>
        /^(vitest|@testing-library)(\/|$)/.test(name)
      );
    expect(testRunners('fixtures.ts')).toEqual([]);
    // The check sees what the testing subpath imports.
    expect(testRunners('testing.ts')).toEqual(['@testing-library/react', 'vitest']);
  });
});

describe('bootFixturePage', () => {
  it("applies the theme of the appearance, marked on the root element, and the plugin's strings", async () => {
    vi.stubGlobal('fetch', async () => Response.json({}));
    await bootFixturePage({
      id: 'page',
      plugin: {
        translations: {
          en: { greeting: 'Hello, {{name}}' },
          load: async (language: string) =>
            language === 'de' ? { greeting: 'Hallo, {{name}}' } : undefined,
        },
      },
      appearance: 'dark',
      language: 'de',
    });

    expect(document.documentElement.dataset.themeKind).toBe('dark');
    expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
    expect(getPluginTranslation('page')('greeting', { name: 'Ada' })).toBe('Hallo, Ada');

    await bootFixturePage({
      id: 'page',
      plugin: { translations: { en: { greeting: 'Hello, {{name}}' } } },
      language: 'en',
    });
    expect(document.documentElement.dataset.themeKind).toBe('light');
    expect(getPluginTranslation('page')('greeting', { name: 'Ada' })).toBe('Hello, Ada');
  });
});

describe('fixtureMindroomServer', () => {
  it("signs in once, shares the app's session and opens sockets with it as subprotocols", async () => {
    const API_URL = 'https://mindroom.example.org';
    let signIns = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      if (!String(input).endsWith('/api/client-sessions')) return Response.json({ ok: true });
      signIns += 1;
      return Response.json({
        session_token: `session-${signIns}`,
        expires_at: Date.now() / 1000 + 3600,
      });
    });
    const sockets: { url: string; protocols: unknown }[] = [];
    vi.stubGlobal(
      'WebSocket',
      class extends EventTarget {
        constructor(url: string | URL, protocols?: string | string[]) {
          super();
          sockets.push({ url: String(url), protocols });
        }
      }
    );
    const client = { getSafeUserId: () => '@ann:example.org' } as unknown as MatrixClient;

    const server = fixtureMindroomServer({ client, apiUrl: API_URL });
    expect(server.origin).toBe(API_URL);
    expect(fixtureMindroomServer({ client, apiUrl: API_URL })).toBe(server);
    await expect(server.request('/api/plugins')).resolves.toEqual({ ok: true });
    await server.openSocket('/api/plugins/notes/live');
    await expect(clientSessions(client, API_URL).token()).resolves.toBe('session-1');

    expect(signIns).toBe(1);
    expect(sockets).toEqual([
      {
        url: 'wss://mindroom.example.org/api/plugins/notes/live',
        protocols: ['mindroom-session', 'mindroom-session.session-1'],
      },
    ]);
  });
});
