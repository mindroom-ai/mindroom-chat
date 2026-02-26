import { describe, expect, it, vi } from 'vitest';
import { AutoDiscoveryAction, autoDiscovery, isAllowedHomeserverBaseUrl } from './cs-api';

type MockResponse = Pick<Response, 'status' | 'json'>;

const createResponse = (status: number, body?: unknown): MockResponse => ({
  status,
  json: vi.fn().mockResolvedValue(body),
});

describe('isAllowedHomeserverBaseUrl', () => {
  it('allows https urls', () => {
    expect(isAllowedHomeserverBaseUrl('https://matrix.org')).toBe(true);
  });

  it('rejects non-local http urls', () => {
    expect(isAllowedHomeserverBaseUrl('http://matrix.org')).toBe(false);
  });

  it('allows local-network http urls', () => {
    expect(isAllowedHomeserverBaseUrl('http://localhost')).toBe(true);
    expect(isAllowedHomeserverBaseUrl('http://127.0.0.1')).toBe(true);
    expect(isAllowedHomeserverBaseUrl('http://192.168.1.20')).toBe(true);
    expect(isAllowedHomeserverBaseUrl('http://my-hs.local')).toBe(true);
  });
});

describe('autoDiscovery', () => {
  it('fails before fetch for insecure non-local http server', async () => {
    const request = vi.fn();

    const [error, discovery] = await autoDiscovery(
      request as unknown as typeof fetch,
      'http://matrix.org'
    );

    expect(error).toEqual({
      host: 'http://matrix.org',
      action: AutoDiscoveryAction.FAIL_INSECURE,
    });
    expect(discovery).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it('allows local-network http server fallback on 404', async () => {
    const request = vi.fn().mockResolvedValue(createResponse(404));

    const [error, discovery] = await autoDiscovery(
      request as unknown as typeof fetch,
      'http://192.168.1.20'
    );

    expect(error).toBeUndefined();
    expect(discovery?.['m.homeserver'].base_url).toBe('http://192.168.1.20');
    expect(request).toHaveBeenCalledWith('http://192.168.1.20/.well-known/matrix/client', {
      method: 'GET',
    });
  });

  it('rejects insecure base_url from well-known response', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        createResponse(200, { 'm.homeserver': { base_url: 'http://matrix.org' } })
      );

    const [error, discovery] = await autoDiscovery(
      request as unknown as typeof fetch,
      'matrix.org'
    );

    expect(error).toEqual({
      host: 'https://matrix.org',
      action: AutoDiscoveryAction.FAIL_INSECURE,
    });
    expect(discovery).toBeUndefined();
  });

  it('returns discovery info for secure well-known response', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        createResponse(200, { 'm.homeserver': { base_url: 'https://matrix.example.com/' } })
      );

    const [error, discovery] = await autoDiscovery(
      request as unknown as typeof fetch,
      'matrix.org'
    );

    expect(error).toBeUndefined();
    expect(discovery?.['m.homeserver'].base_url).toBe('https://matrix.example.com');
  });
});
