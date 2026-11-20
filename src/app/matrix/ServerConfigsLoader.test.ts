import React from 'react';
import { act, create } from 'react-test-renderer';
import { createClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { isValidAuthMetadata } from 'matrix-js-sdk/lib/oauth/discover';
import { ServerConfigsLoader, type ServerConfigs } from './ServerConfigsLoader';

// The SDK's check of auth metadata for a login, which the loader leaves alone: the settings read
// only where the provider manages the account.
vi.mock('matrix-js-sdk/lib/oauth/discover', async (importOriginal) => {
  const actual = await importOriginal<typeof import('matrix-js-sdk/lib/oauth/discover')>();

  return {
    ...actual,
    isValidAuthMetadata: vi.fn(actual.isValidAuthMetadata),
  };
});

const flushPromises = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

describe('ServerConfigsLoader', () => {
  it('loads configs from an explicit Matrix client without requiring context', async () => {
    const getCapabilities = vi.fn().mockResolvedValue({ 'm.change_password': { enabled: true } });
    const getMediaConfig = vi.fn().mockResolvedValue({ 'm.upload.size': 1024 });
    const request = vi.fn().mockRejectedValue(new Error('auth metadata unavailable'));
    let latestConfigs: ServerConfigs | undefined;

    // Inside act, the mount effects run before the test goes on. After a bare create() React's
    // scheduler ran them in a later task, and on a busy machine that came after the act below.
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          ServerConfigsLoader as never,
          {
            mx: {
              getCapabilities,
              getMediaConfig,
              http: { request },
            } as never,
          } as never,
          ((configs: ServerConfigs) => {
            latestConfigs = configs;
            return React.createElement('div', null, 'Loaded');
          }) as never
        )
      );
      await flushPromises();
      await flushPromises();
    });

    expect(getCapabilities).toHaveBeenCalledTimes(1);
    expect(getMediaConfig).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(latestConfigs).toEqual({
      capabilities: { 'm.change_password': { enabled: true } },
      mediaConfig: { 'm.upload.size': 1024 },
      authMetadata: undefined,
    });

    renderer.unmount();
  });

  it('does not validate or log auth metadata when fetching it fails', async () => {
    const getCapabilities = vi.fn().mockResolvedValue({ 'm.change_password': { enabled: true } });
    const getMediaConfig = vi.fn().mockResolvedValue({ 'm.upload.size': 1024 });
    const request = vi.fn().mockRejectedValue(new Error('auth metadata unavailable'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let latestConfigs: ServerConfigs | undefined;

    // Inside act, the mount effects run before the test goes on. After a bare create() React's
    // scheduler ran them in a later task, and on a busy machine that came after the act below.
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          ServerConfigsLoader as never,
          {
            mx: {
              getCapabilities,
              getMediaConfig,
              http: { request },
            } as never,
          } as never,
          ((configs: ServerConfigs) => {
            latestConfigs = configs;
            return React.createElement('div', null, 'Loaded');
          }) as never
        )
      );
      await flushPromises();
      await flushPromises();
    });

    expect(getCapabilities).toHaveBeenCalledTimes(1);
    expect(getMediaConfig).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.mocked(isValidAuthMetadata)).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(latestConfigs).toEqual({
      capabilities: { 'm.change_password': { enabled: true } },
      mediaConfig: { 'm.upload.size': 1024 },
      authMetadata: undefined,
    });

    renderer.unmount();
  });

  describe('the auth metadata of a homeserver that delegates auth', () => {
    const STABLE = '/_matrix/client/v1/auth_metadata';
    const MSC2965 = '/_matrix/client/unstable/org.matrix.msc2965';
    const ISSUER = 'https://auth.example.org/';
    const management = {
      issuer: ISSUER,
      account_management_uri: 'https://auth.example.org/account',
    };
    // What a provider from before Matrix 1.15 states: no `registration_endpoint` and no
    // `response_modes_supported`, which the SDK's check for a login asks for since 43.0.
    const metadata = {
      ...management,
      authorization_endpoint: 'https://auth.example.org/authorize',
      token_endpoint: 'https://auth.example.org/oauth2/token',
      revocation_endpoint: 'https://auth.example.org/oauth2/revoke',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
    };

    /** Loads the configs of a homeserver that answers the paths in `routes` and knows no other. */
    const authMetadataOf = async (routes: Record<string, unknown>) => {
      const requested: string[] = [];
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      const mx = createClient({
        baseUrl: 'https://example.org',
        accessToken: 'token',
        fetchFn: async (input) => {
          const url = new URL(String(input));
          const route = url.origin === 'https://example.org' ? url.pathname : url.href;
          requested.push(route);
          return route in routes
            ? json(routes[route])
            : json({ errcode: 'M_UNRECOGNIZED', error: 'Unrecognized request' }, 404);
        },
      });
      let latestConfigs: ServerConfigs | undefined;
      let renderer!: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(
          React.createElement(
            ServerConfigsLoader as never,
            { mx } as never,
            ((configs: ServerConfigs) => {
              latestConfigs = configs;
              return null;
            }) as never
          )
        );
      });
      await act(async () => {
        await vi.waitFor(() => expect(latestConfigs).toHaveProperty('authMetadata'));
      });
      renderer.unmount();
      return { authMetadata: latestConfigs?.authMetadata, requested };
    };

    it('reads where the account is managed from the stable route', async () => {
      const { authMetadata, requested } = await authMetadataOf({ [STABLE]: metadata });

      expect(authMetadata).toEqual(management);
      expect(requested.filter((route) => route.includes('auth'))).toEqual([STABLE]);
      expect(vi.mocked(isValidAuthMetadata)).not.toHaveBeenCalled();
    });

    it('reads it from the MSC2965 route of a homeserver without the stable one', async () => {
      const { authMetadata } = await authMetadataOf({ [`${MSC2965}/auth_metadata`]: metadata });

      expect(authMetadata).toEqual(management);
    });

    it('reads it from the issuer the oldest MSC2965 route names', async () => {
      const { authMetadata, requested } = await authMetadataOf({
        [`${MSC2965}/auth_issuer`]: { issuer: ISSUER },
        [`${ISSUER}.well-known/openid-configuration`]: metadata,
      });

      expect(authMetadata).toEqual(management);
      expect(requested.filter((route) => route.includes('auth'))).toEqual([
        STABLE,
        `${MSC2965}/auth_metadata`,
        `${MSC2965}/auth_issuer`,
        `${ISSUER}.well-known/openid-configuration`,
      ]);
    });

    it('falls back to the issuer of a provider that names no management page', async () => {
      const { authMetadata } = await authMetadataOf({ [STABLE]: { issuer: ISSUER } });

      expect(authMetadata).toEqual({ issuer: ISSUER });
    });

    it.each([
      [
        'a management page that is no web address',
        { ...metadata, account_management_uri: 'javascript:alert(1)' },
      ],
      ['a management page that is no text', { ...metadata, account_management_uri: 7 }],
      ['an issuer that is no web address', { ...metadata, issuer: 'javascript:alert(1)' }],
      ['no issuer', { account_management_uri: management.account_management_uri }],
    ])('takes no metadata with %s, from either route', async (_what, invalid) => {
      const stable = await authMetadataOf({ [STABLE]: invalid });
      const legacy = await authMetadataOf({ [`${MSC2965}/auth_metadata`]: invalid });

      expect(stable.authMetadata).toBeUndefined();
      expect(legacy.authMetadata).toBeUndefined();
    });

    it('reports no metadata for a homeserver without delegated auth, having asked each route once', async () => {
      const { authMetadata, requested } = await authMetadataOf({});

      expect(authMetadata).toBeUndefined();
      expect(requested.filter((route) => route.includes('auth'))).toEqual([
        STABLE,
        `${MSC2965}/auth_metadata`,
        `${MSC2965}/auth_issuer`,
      ]);
    });
  });
});
