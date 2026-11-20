import React from 'react';
import { act, create } from 'react-test-renderer';
import { createClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { isValidAuthMetadata } from 'matrix-js-sdk/lib/oauth/discover';
import { ServerConfigsLoader, type ServerConfigs } from './ServerConfigsLoader';

// The SDK's check of auth metadata (`validateAuthMetadata` of `lib/oidc/validate` until 43.0).
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
    const getAuthMetadata = vi.fn().mockRejectedValue(new Error('auth metadata unavailable'));
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
              getAuthMetadata,
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
    expect(getAuthMetadata).toHaveBeenCalledTimes(1);
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
    const getAuthMetadata = vi.fn().mockRejectedValue(new Error('auth metadata unavailable'));
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
              getAuthMetadata,
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
    expect(getAuthMetadata).toHaveBeenCalledTimes(1);
    expect(vi.mocked(isValidAuthMetadata)).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(latestConfigs).toEqual({
      capabilities: { 'm.change_password': { enabled: true } },
      mediaConfig: { 'm.upload.size': 1024 },
      authMetadata: undefined,
    });

    renderer.unmount();
  });

  describe('a homeserver from before Matrix 1.15, which lacks the stable auth metadata route', () => {
    const MSC2965 = '/_matrix/client/unstable/org.matrix.msc2965';
    const ISSUER = 'https://auth.example.org/';
    const metadata = {
      issuer: ISSUER,
      account_management_uri: 'https://auth.example.org/account',
      authorization_endpoint: 'https://auth.example.org/authorize',
      token_endpoint: 'https://auth.example.org/oauth2/token',
      revocation_endpoint: 'https://auth.example.org/oauth2/revoke',
      registration_endpoint: 'https://auth.example.org/oauth2/registration',
      response_modes_supported: ['query', 'fragment'],
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

    it('reads the metadata from the MSC2965 route', async () => {
      const { authMetadata } = await authMetadataOf({ [`${MSC2965}/auth_metadata`]: metadata });

      expect(authMetadata).toEqual(metadata);
    });

    it('reads the metadata from the issuer the oldest MSC2965 route names', async () => {
      const { authMetadata, requested } = await authMetadataOf({
        [`${MSC2965}/auth_issuer`]: { issuer: ISSUER },
        [`${ISSUER}.well-known/openid-configuration`]: metadata,
      });

      expect(authMetadata).toEqual(metadata);
      expect(requested.filter((route) => route.includes('auth'))).toEqual([
        '/_matrix/client/v1/auth_metadata',
        `${MSC2965}/auth_metadata`,
        `${MSC2965}/auth_issuer`,
        `${ISSUER}.well-known/openid-configuration`,
      ]);
    });

    it('takes no metadata that lacks what the provider links are built from', async () => {
      const { authMetadata } = await authMetadataOf({
        [`${MSC2965}/auth_issuer`]: { issuer: ISSUER },
        [`${ISSUER}.well-known/openid-configuration`]: { account_management_uri: 'javascript:1' },
      });

      expect(authMetadata).toBeUndefined();
    });

    it('reports no metadata for a homeserver without delegated auth, having asked each route once', async () => {
      const { authMetadata, requested } = await authMetadataOf({});

      expect(authMetadata).toBeUndefined();
      expect(requested.filter((route) => route.includes('auth'))).toEqual([
        '/_matrix/client/v1/auth_metadata',
        `${MSC2965}/auth_metadata`,
        `${MSC2965}/auth_issuer`,
      ]);
    });
  });
});
