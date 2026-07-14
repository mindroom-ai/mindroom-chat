import { Capacitor } from '@capacitor/core';
import { describe, expect, it, vi } from 'vitest';
import { CloudflareAccessController } from '../native/cloudflareAccess';
import { createMatrixClient, createMatrixFetchFn } from './matrixClientFactory';

describe('createMatrixFetchFn', () => {
  it('adds credentials for same-origin requests', async () => {
    const baseFetch = vi.fn().mockResolvedValue({ ok: true });
    const originalLocation = (globalThis as { location?: Location }).location;

    try {
      (globalThis as { location?: Location }).location = {
        origin: 'https://example.com',
      } as Location;

      const fetchFn = createMatrixFetchFn(baseFetch as unknown as typeof fetch);
      await fetchFn('/_matrix/client', { method: 'GET' });
    } finally {
      (globalThis as { location?: Location }).location = originalLocation;
    }

    expect(baseFetch).toHaveBeenCalledWith('/_matrix/client', {
      method: 'GET',
      credentials: 'include',
    });
  });

  it('does not add credentials for cross-origin requests', async () => {
    const baseFetch = vi.fn().mockResolvedValue({ ok: true });
    const originalLocation = (globalThis as { location?: Location }).location;

    try {
      (globalThis as { location?: Location }).location = {
        origin: 'https://example.com',
      } as Location;

      const fetchFn = createMatrixFetchFn(baseFetch as unknown as typeof fetch);
      await fetchFn('https://other.example.com/_matrix/client', { method: 'GET' });
    } finally {
      (globalThis as { location?: Location }).location = originalLocation;
    }

    expect(baseFetch).toHaveBeenCalledWith('https://other.example.com/_matrix/client', {
      method: 'GET',
    });
  });

  it('keeps fetch uploads disabled for the web client', () => {
    const nativePlatform = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    try {
      const client = createMatrixClient({ baseUrl: 'https://public.example' });
      const http = client.http as unknown as {
        opts: { useFetchForUploads?: boolean };
      };

      expect(http.opts.useFetchForUploads).toBe(false);
    } finally {
      nativePlatform.mockRestore();
    }
  });

  it('routes native iOS uploads through wrapped fetch with Matrix and Access auth', async () => {
    const originalFetch = globalThis.fetch;
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const originalXMLHttpRequest = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
    const xhrConstructed = vi.fn();
    const plugin = {
      cloudflareAccessToken: vi.fn(async () => ({
        expiresAtMs: Date.now() + 3_600_000,
        protected: true,
        token: 'access-jwt',
      })),
    };
    const baseFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ content_uri: 'mxc://private.example/media' }), {
          headers: { 'Content-Type': 'application/json' },
        })
    );
    const accessController = new CloudflareAccessController({ baseFetch, plugin });
    accessController.allowHomeserver('https://private.example');

    class UnexpectedXMLHttpRequest {
      static readonly DONE = 4;

      constructor() {
        xhrConstructed();
        throw new Error('native upload must not use XMLHttpRequest');
      }
    }

    try {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: { origin: 'capacitor://localhost' },
      });
      Object.defineProperty(globalThis, 'XMLHttpRequest', {
        configurable: true,
        value: UnexpectedXMLHttpRequest,
      });
      globalThis.fetch = accessController.fetch;

      const client = createMatrixClient({
        accessToken: 'matrix-token',
        baseUrl: 'https://private.example',
      });
      const upload = new Blob(['encrypted content'], { type: 'application/octet-stream' });
      const result = await client.uploadContent(upload, { name: 'message.bin' });

      expect(result).toEqual({ content_uri: 'mxc://private.example/media' });
      expect(xhrConstructed).not.toHaveBeenCalled();
      expect(plugin.cloudflareAccessToken).toHaveBeenCalledWith({
        forceRefresh: false,
        interactive: true,
        url: 'https://private.example/_matrix/client/versions',
      });
      const [request, init] = baseFetch.mock.calls[0];
      expect((request as Request).url).toContain('https://private.example/_matrix/media/v3/upload');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer matrix-token');
      expect(headers.get('Cf-Access-Token')).toBe('access-jwt');
      expect(init?.redirect).toBe('manual');

      baseFetch.mockImplementationOnce(
        (_input, pendingInit) =>
          new Promise<Response>((_resolve, reject) => {
            pendingInit?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true }
            );
          })
      );
      const cancelledUpload = client.uploadContent(new Blob(['cancel me']));
      await vi.waitFor(() => expect(baseFetch).toHaveBeenCalledTimes(2));

      expect(client.cancelUpload(cancelledUpload)).toBe(true);
      await expect(cancelledUpload).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      vi.restoreAllMocks();
      globalThis.fetch = originalFetch;
      if (originalLocation) {
        Object.defineProperty(globalThis, 'location', originalLocation);
      } else {
        Reflect.deleteProperty(globalThis, 'location');
      }
      if (originalXMLHttpRequest) {
        Object.defineProperty(globalThis, 'XMLHttpRequest', originalXMLHttpRequest);
      } else {
        Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
      }
    }
  });
});
