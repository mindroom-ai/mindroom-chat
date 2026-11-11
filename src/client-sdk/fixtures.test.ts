// @vitest-environment jsdom
// `bootFixturePage` and `fixtureMindroomServer`, as a plugin's fixture page meets them: through the
// SDK only (registryImports.test.ts checks that the subpath imports nothing of Vitest).
import type { IOpenIDToken, MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPluginTranslation } from '@mindroom/client-sdk/core';
import { bootFixturePage, fixtureMindroomServer } from '@mindroom/client-sdk/fixtures';
import { clientSessions } from '../app/computer/clientSessions';

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
  const client = { getSafeUserId: () => '@ann:example.org' } as unknown as MatrixClient;

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

    const server = fixtureMindroomServer({ client, apiUrl: API_URL });
    expect(server.origin).toBe(API_URL);
    // The same server however its URL is written.
    expect(fixtureMindroomServer({ client, apiUrl: `${API_URL}/` })).toBe(server);
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

  it('refuses a URL that is no MindRoom server origin the app would sign in to', () => {
    for (const apiUrl of ['http://mindroom.example.org', 'https://mindroom.example.org/api']) {
      expect(() => fixtureMindroomServer({ client, apiUrl })).toThrow(TypeError);
    }
  });
});
