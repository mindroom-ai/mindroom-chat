import { readFileSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CloudflareAccessController,
  CloudflareAccessPlugin,
  getCloudflareAccessProbeUrl,
} from './cloudflareAccess';

const NOW = 1_800_000_000_000;

const accessResult = (token: string, expiresAtMs = NOW + 3_600_000) => ({
  expiresAtMs,
  protected: true,
  token,
});

const pluginError = (code: string, message = code) => Object.assign(new Error(message), { code });

const makePlugin = (
  implementation: CloudflareAccessPlugin['cloudflareAccessToken']
): CloudflareAccessPlugin => ({ cloudflareAccessToken: vi.fn(implementation) });

describe('CloudflareAccessController', () => {
  it('leaves well-known and non-Matrix requests untouched', async () => {
    const plugin = makePlugin(async () => accessResult('unused'));
    const baseFetch = vi.fn(async () => new Response('{}'));
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => NOW });
    controller.allowHomeserver('https://chat.example');

    await controller.fetch('https://chat.example/.well-known/matrix/client');
    await controller.fetch('https://chat.example/api/private');

    expect(plugin.cloudflareAccessToken).not.toHaveBeenCalled();
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('does not start Access discovery for an unapproved Matrix origin', async () => {
    const plugin = makePlugin(async () => accessResult('unused'));
    const baseFetch = vi.fn(async () => new Response('{}'));
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => NOW });

    await controller.fetch('https://untrusted.example/_matrix/client/versions');

    expect(plugin.cloudflareAccessToken).not.toHaveBeenCalled();
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('probes the concrete Matrix application and adds Access beside Matrix auth', async () => {
    const plugin = makePlugin(async () => accessResult('access-jwt'));
    const baseFetch = vi.fn(async () => new Response('{}'));
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => NOW });
    controller.allowHomeserver('https://chat.example/matrix');

    await controller.fetch('https://chat.example/matrix/_matrix/client/v3/sync', {
      headers: { Authorization: 'Bearer matrix-token' },
      method: 'GET',
    });

    expect(plugin.cloudflareAccessToken).toHaveBeenCalledWith({
      forceRefresh: false,
      interactive: true,
      url: 'https://chat.example/matrix/_matrix/client/versions',
    });
    const [, init] = baseFetch.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer matrix-token');
    expect(headers.get('Cf-Access-Token')).toBe('access-jwt');
    expect(baseFetch.mock.calls[0]?.[1]?.redirect).toBe('manual');
  });

  it('probes an established session silently before showing any browser sheet', async () => {
    const plugin = makePlugin(async () => accessResult('stored-access-jwt'));
    const baseFetch = vi.fn(async () => new Response('{}'));
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => NOW });
    controller.allowHomeserver('https://chat.example', false);

    await controller.fetch('https://chat.example/_matrix/client/v3/sync');

    expect(plugin.cloudflareAccessToken).toHaveBeenCalledWith({
      forceRefresh: false,
      interactive: false,
      url: 'https://chat.example/_matrix/client/versions',
    });
  });

  it('resolves a direct homeserver only after native Access protection is confirmed', async () => {
    const plugin = makePlugin(async () => accessResult('access-jwt'));
    const baseFetch = vi.fn(async () => new Response('{"versions":["v1.11"]}'));
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => NOW });

    await expect(controller.probeProtectedHomeserver('private.example/matrix/')).resolves.toBe(
      'https://private.example/matrix'
    );

    expect(plugin.cloudflareAccessToken).toHaveBeenCalledWith({
      forceRefresh: false,
      interactive: true,
      url: 'https://private.example/matrix/_matrix/client/versions',
    });
    expect((baseFetch.mock.calls[0]?.[0] as Request).url).toBe(
      'https://private.example/matrix/_matrix/client/versions'
    );
  });

  it('does not use direct discovery for an unprotected or non-HTTPS server', async () => {
    const plugin = makePlugin(async () => ({ protected: false }));
    const baseFetch = vi.fn(async () => new Response('{"versions":["v1.11"]}'));
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => NOW });

    await expect(controller.probeProtectedHomeserver('https://public.example')).resolves.toBe(
      undefined
    );
    await expect(controller.probeProtectedHomeserver('http://local.example')).resolves.toBe(
      undefined
    );

    expect(plugin.cloudflareAccessToken).toHaveBeenCalledTimes(1);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('covers authenticated media fetches with the same Access header', async () => {
    const plugin = makePlugin(async () => accessResult('media-access-jwt'));
    const baseFetch = vi.fn(async () => new Response('media'));
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => NOW });
    controller.allowHomeserver('https://chat.example');

    await controller.fetch(
      'https://chat.example/_matrix/client/v1/media/download/example/media-id',
      { headers: { Authorization: 'Bearer matrix-token' } }
    );

    const headers = new Headers(baseFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer matrix-token');
    expect(headers.get('Cf-Access-Token')).toBe('media-access-jwt');
    expect(baseFetch.mock.calls[0]?.[1]?.redirect).toBe('manual');
  });

  it('refreshes silently once token enters the 60 second expiry window', async () => {
    let now = NOW;
    const plugin = makePlugin(
      vi
        .fn()
        .mockResolvedValueOnce(accessResult('first', NOW + 61_000))
        .mockResolvedValueOnce(accessResult('second', NOW + 3_600_000))
    );
    const baseFetch = vi.fn(async () => new Response('{}'));
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => now });
    controller.allowHomeserver('https://chat.example');

    await controller.fetch('https://chat.example/_matrix/client/v3/sync');
    now += 2_000;
    await controller.fetch('https://chat.example/_matrix/client/v3/sync');

    expect(plugin.cloudflareAccessToken).toHaveBeenNthCalledWith(2, {
      forceRefresh: false,
      interactive: false,
      url: 'https://chat.example/_matrix/client/versions',
    });
    expect(new Headers(baseFetch.mock.calls[1]?.[1]?.headers).get('Cf-Access-Token')).toBe(
      'second'
    );
  });

  it('deduplicates concurrent token acquisition', async () => {
    let resolveToken: ((value: ReturnType<typeof accessResult>) => void) | undefined;
    const plugin = makePlugin(
      () =>
        new Promise((resolve) => {
          resolveToken = resolve;
        })
    );
    const baseFetch = vi.fn(async () => new Response('{}'));
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => NOW });
    controller.allowHomeserver('https://chat.example');

    const first = controller.fetch('https://chat.example/_matrix/client/v3/login');
    const second = controller.fetch('https://chat.example/_matrix/client/v3/register');
    resolveToken?.(accessResult('shared'));
    await Promise.all([first, second]);

    expect(plugin.cloudflareAccessToken).toHaveBeenCalledTimes(1);
  });

  it('forces at most one silent refresh after an Access rejection', async () => {
    const plugin = makePlugin(
      vi
        .fn()
        .mockResolvedValueOnce(accessResult('first'))
        .mockResolvedValueOnce(accessResult('second'))
    );
    const rejected = () =>
      new Response('Access denied', {
        headers: { 'CF-Access-Aud': 'audience' },
        status: 403,
      });
    const baseFetch = vi.fn(async () => rejected());
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => NOW });
    controller.allowHomeserver('https://chat.example');

    const response = await controller.fetch('https://chat.example/_matrix/client/v3/sync');

    expect(response.status).toBe(403);
    expect(plugin.cloudflareAccessToken).toHaveBeenCalledTimes(2);
    expect(plugin.cloudflareAccessToken).toHaveBeenNthCalledWith(2, {
      forceRefresh: true,
      interactive: false,
      url: 'https://chat.example/_matrix/client/versions',
    });
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(new Headers(baseFetch.mock.calls[1]?.[1]?.headers).get('Cf-Access-Token')).toBe(
      'second'
    );
    expect(controller.getRequirement()).toMatchObject({
      scope: 'https://chat.example/_matrix',
    });

    await expect(
      controller.fetch('https://chat.example/_matrix/client/v3/sync')
    ).rejects.toMatchObject({ code: 'ACCESS_AUTH_REQUIRED' });
    expect(plugin.cloudflareAccessToken).toHaveBeenCalledTimes(2);
  });

  it('detects an opaque Access redirect and preserves a POST body for one replay', async () => {
    const plugin = makePlugin(
      vi
        .fn()
        .mockResolvedValueOnce(accessResult('first'))
        .mockResolvedValueOnce(accessResult('second'))
    );
    const bodies: string[] = [];
    const opaqueRedirect = {
      headers: new Headers(),
      redirected: false,
      status: 0,
      type: 'opaqueredirect',
      url: '',
    } as Response;
    const baseFetch = vi.fn(async (input: RequestInfo | URL) => {
      bodies.push(await (input as Request).text());
      return baseFetch.mock.calls.length === 1 ? opaqueRedirect : new Response('{}');
    });
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => NOW });
    controller.allowHomeserver('https://chat.example');

    const response = await controller.fetch('https://chat.example/_matrix/client/v3/login', {
      body: JSON.stringify({ type: 'm.login.token' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(bodies).toEqual([
      JSON.stringify({ type: 'm.login.token' }),
      JSON.stringify({ type: 'm.login.token' }),
    ]);
    expect(plugin.cloudflareAccessToken).toHaveBeenCalledTimes(2);
  });

  it('does not treat a normal Matrix 403 as an Access rejection', async () => {
    const plugin = makePlugin(async () => accessResult('access-jwt'));
    const baseFetch = vi.fn(
      async () =>
        new Response('{"errcode":"M_FORBIDDEN"}', {
          headers: { 'Content-Type': 'application/json' },
          status: 403,
        })
    );
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => NOW });
    controller.allowHomeserver('https://chat.example');

    await controller.fetch('https://chat.example/_matrix/client/v3/rooms/room/send');

    expect(plugin.cloudflareAccessToken).toHaveBeenCalledTimes(1);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('moves cancelled auth into explicit state and retries only from Continue', async () => {
    const plugin = makePlugin(
      vi
        .fn()
        .mockRejectedValueOnce(pluginError('ACCESS_AUTH_CANCELLED', 'Sign-in cancelled'))
        .mockResolvedValueOnce(accessResult('access-jwt'))
    );
    const onAuthentication = vi.fn();
    const controller = new CloudflareAccessController({
      baseFetch: vi.fn(async () => new Response('{}')),
      onAuthentication,
      plugin,
      now: () => NOW,
    });
    controller.allowHomeserver('https://chat.example');

    await expect(
      controller.fetch('https://chat.example/_matrix/client/v3/login')
    ).rejects.toMatchObject({ code: 'ACCESS_AUTH_CANCELLED' });
    expect(controller.getRequirement()).toMatchObject({
      message: 'Sign-in cancelled',
      scope: 'https://chat.example/_matrix',
    });

    await controller.retryAuthentication();

    expect(plugin.cloudflareAccessToken).toHaveBeenNthCalledWith(2, {
      forceRefresh: false,
      interactive: true,
      url: 'https://chat.example/_matrix/client/versions',
    });
    expect(controller.getRequirement()).toBeUndefined();
    expect(onAuthentication).toHaveBeenCalledTimes(1);
  });

  it('keeps protected requests blocked locally until explicit authentication succeeds', async () => {
    const plugin = makePlugin(async () => {
      throw pluginError('ACCESS_AUTH_REQUIRED');
    });
    const baseFetch = vi.fn(async () => new Response('Access login'));
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => NOW });
    controller.allowHomeserver('https://chat.example');

    await expect(
      controller.fetch('https://chat.example/_matrix/client/v3/sync')
    ).rejects.toMatchObject({ code: 'ACCESS_AUTH_REQUIRED' });
    await expect(
      controller.fetch('https://chat.example/_matrix/client/v3/sync')
    ).rejects.toMatchObject({ code: 'ACCESS_AUTH_REQUIRED' });

    expect(controller.getRequirement()).toMatchObject({
      scope: 'https://chat.example/_matrix',
    });
    expect(plugin.cloudflareAccessToken).toHaveBeenCalledTimes(1);
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('fails closed when native Access discovery is unavailable', async () => {
    const plugin = makePlugin(async () => {
      throw pluginError('ACCESS_DISCOVERY_FAILED');
    });
    const baseFetch = vi.fn(async () => new Response('{}'));
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => NOW });
    controller.allowHomeserver('https://chat.example');

    await expect(
      controller.fetch('https://chat.example/_matrix/client/versions')
    ).rejects.toMatchObject({ code: 'ACCESS_DISCOVERY_FAILED' });

    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('fails closed if token refresh cannot rediscover Access protection', async () => {
    let now = NOW;
    const plugin = makePlugin(
      vi
        .fn()
        .mockResolvedValueOnce(accessResult('first', NOW + 61_000))
        .mockRejectedValueOnce(pluginError('ACCESS_DISCOVERY_FAILED'))
    );
    const baseFetch = vi.fn(async () => new Response('{}'));
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => now });
    controller.allowHomeserver('https://chat.example');

    await controller.fetch('https://chat.example/_matrix/client/v3/sync');
    now += 2_000;
    await expect(
      controller.fetch('https://chat.example/_matrix/client/v3/sync')
    ).rejects.toMatchObject({ code: 'ACCESS_DISCOVERY_FAILED' });

    expect(plugin.cloudflareAccessToken).toHaveBeenNthCalledWith(2, {
      forceRefresh: false,
      interactive: false,
      url: 'https://chat.example/_matrix/client/versions',
    });
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('does not consume a Request body when the approved server is unprotected', async () => {
    const plugin = makePlugin(async () => ({ protected: false }));
    const bodies: string[] = [];
    const baseFetch = vi.fn(async (input: RequestInfo | URL) => {
      bodies.push(await (input as Request).text());
      return new Response('{}');
    });
    const controller = new CloudflareAccessController({ baseFetch, plugin, now: () => NOW });
    controller.allowHomeserver('https://chat.example');
    const request = new Request('https://chat.example/_matrix/client/v3/login', {
      body: JSON.stringify({ type: 'm.login.password' }),
      method: 'POST',
    });

    await controller.fetch(request);

    expect(bodies).toEqual([JSON.stringify({ type: 'm.login.password' })]);
  });
});

describe('Cloudflare Access native contract', () => {
  it('derives only path-scoped Matrix probes', () => {
    expect(
      getCloudflareAccessProbeUrl(
        new URL('https://chat.example/matrix/_matrix/client/v3/login?redirect=secret')
      )?.toString()
    ).toBe('https://chat.example/matrix/_matrix/client/versions');
    expect(
      getCloudflareAccessProbeUrl(new URL('https://chat.example/.well-known/matrix/client'))
    ).toBeUndefined();
  });

  it('pins encrypted transfer, Keychain, exact-host redirects, and no deployment identity', () => {
    const swiftSource = readFileSync(
      new URL('../../../../ios/App/App/MindRoomAuthPlugin.swift', import.meta.url),
      'utf8'
    );
    const projectSource = readFileSync(
      new URL('../../../../ios/App/App.xcodeproj/project.pbxproj', import.meta.url),
      'utf8'
    );

    expect(swiftSource).toContain('service-public-key');
    expect(swiftSource).toContain('sodium.box.open');
    expect(swiftSource).toContain('kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly');
    expect(swiftSource).toContain('origin == authOrigin || origin == appOrigin');
    expect(swiftSource).toContain('guard accessLogin else');
    expect(swiftSource).toContain('responseURL.port == nil || responseURL.port == 443');
    expect(swiftSource).toContain('isCloudflareAuthenticationHost(authDomain)');
    expect(swiftSource).toContain('cloudflareAppDomainMatches(appDomain, appURL: appURL)');
    expect(swiftSource).toContain('try await validateMatrixToken(appToken, appURL: appURL)');
    expect(swiftSource).toContain(
      'try await validateMatrixToken(appToken, appURL: context.appURL)'
    );
    expect(swiftSource).toContain(
      'request.setValue(token.value, forHTTPHeaderField: "Cf-Access-Token")'
    );
    expect(swiftSource).toContain('responseURL.path == versionsURL.path');
    expect(swiftSource).toContain('let versions = object["versions"] as? [String]');
    expect(swiftSource).toContain('(200..<300).contains(response.statusCode)');
    expect(swiftSource).toContain('failure.code == "ACCESS_TOKEN_VALIDATION_UNAVAILABLE"');
    expect(swiftSource).toContain('completionHandler(nil)');
    expect(swiftSource).not.toContain('response.value(forHTTPHeaderField: "CF-Access-Aud")');
    expect(swiftSource).not.toContain('hasSuffix(".fed.cloudflareaccess.org")');
    expect(swiftSource).not.toContain('close_interstitial');
    expect(swiftSource).toContain('cloudflareTokenSkew: TimeInterval = 60');
    expect(projectSource).toContain('version = 0.11.0;');
    expect(projectSource).toContain(
      'repositoryURL = "https://github.com/jedisct1/swift-sodium.git";'
    );
  });
});
