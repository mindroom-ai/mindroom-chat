import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLocalMindroomConnections,
  getLocalMindroomErrorMessage,
  getLocalMindroomPairStatus,
  issueLocalMindroomPairCode,
  revokeLocalMindroomConnection,
} from './api';

const capacitorMocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  nativeRequest: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: capacitorMocks.isNativePlatform,
  },
  CapacitorHttp: {
    request: capacitorMocks.nativeRequest,
  },
}));

type MockResponse = Pick<Response, 'ok' | 'status' | 'json'>;

const createResponse = (status: number, body?: unknown): MockResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: vi.fn().mockResolvedValue(body),
});

afterEach(() => {
  capacitorMocks.isNativePlatform.mockReturnValue(false);
  capacitorMocks.nativeRequest.mockReset();
});

describe('local mindroom api', () => {
  it('starts pairing and returns pair code payload', async () => {
    const request = vi.fn().mockResolvedValue(
      createResponse(200, {
        pair_code: 'ABC123',
        expires_at: '2026-02-27T13:00:00.000Z',
        poll_interval_seconds: 2,
      })
    );

    const data = await issueLocalMindroomPairCode(undefined, undefined, request as unknown as typeof fetch);

    expect(data.pair_code).toBe('ABC123');
    expect(request).toHaveBeenCalledWith('/v1/local-mindroom/pair/start', {
      credentials: 'omit',
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
    });
  });

  it('includes matrix access token header when provided', async () => {
    const request = vi.fn().mockResolvedValue(
      createResponse(200, {
        pair_code: 'ABCD-EFGH',
        expires_at: '2026-02-27T13:00:00.000Z',
        poll_interval_seconds: 3,
      })
    );

    await issueLocalMindroomPairCode(
      'matrix-token-123',
      undefined,
      request as unknown as typeof fetch
    );

    expect(request).toHaveBeenCalledWith('/v1/local-mindroom/pair/start', {
      credentials: 'omit',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Matrix-Access-Token': 'matrix-token-123',
      },
    });
  });

  it('handles pending -> connected status responses for polling', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(createResponse(200, { status: 'pending' }))
      .mockResolvedValueOnce(
        createResponse(200, {
          status: 'connected',
          connection: { id: 'conn-1', client_name: 'MacBook Air' },
        })
      );

    const pending = await getLocalMindroomPairStatus(
      'ABC123',
      undefined,
      undefined,
      request as unknown as typeof fetch
    );
    const connected = await getLocalMindroomPairStatus(
      'ABC123',
      undefined,
      undefined,
      request as unknown as typeof fetch
    );

    expect(pending.status).toBe('pending');
    expect(connected.status).toBe('connected');
  });

  it('revokes a linked connection', async () => {
    const request = vi.fn().mockResolvedValue(createResponse(204));

    await revokeLocalMindroomConnection(
      'conn-1',
      undefined,
      undefined,
      request as unknown as typeof fetch
    );

    expect(request).toHaveBeenCalledWith('/v1/local-mindroom/connections/conn-1', {
      credentials: 'omit',
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
      },
    });
  });

  it('surfaces api error message payloads', async () => {
    const request = vi.fn().mockResolvedValue(
      createResponse(400, {
        detail: 'Invalid or expired pair code',
      })
    );

    await expect(
      getLocalMindroomConnections(undefined, undefined, request as unknown as typeof fetch)
    ).rejects.toThrow('Invalid or expired pair code');
  });

  it('returns fallback message for unknown errors', () => {
    expect(getLocalMindroomErrorMessage(null)).toBe('Request failed. Please try again.');
  });

  it('supports provisioning base url override', async () => {
    const request = vi.fn().mockResolvedValue(
      createResponse(200, {
        pair_code: 'ABCD-EFGH',
        expires_at: '2026-02-27T13:00:00.000Z',
        poll_interval_seconds: 3,
      })
    );

    await issueLocalMindroomPairCode(
      'matrix-token-123',
      'https://provisioning.example',
      request as unknown as typeof fetch
    );

    expect(request).toHaveBeenCalledWith('https://provisioning.example/v1/local-mindroom/pair/start', {
      credentials: 'omit',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Matrix-Access-Token': 'matrix-token-123',
      },
    });
  });

  it('throws clear error for non-json successful responses', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
    } as unknown as Response);

    await expect(
      issueLocalMindroomPairCode(undefined, undefined, request as unknown as typeof fetch)
    ).rejects.toThrow('Provisioning API returned invalid JSON. Verify provisioning URL/proxy configuration.');
  });

  it('uses native http transport on native platforms when no custom request is provided', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true);
    capacitorMocks.nativeRequest.mockResolvedValue({
      status: 200,
      data: {
        pair_code: 'ABCD-EFGH',
        expires_at: '2026-02-27T13:00:00.000Z',
        poll_interval_seconds: 3,
      },
      headers: {},
      url: 'https://mindroom.chat/v1/local-mindroom/pair/start',
    });

    const data = await issueLocalMindroomPairCode(
      'matrix-token-123',
      'https://mindroom.chat'
    );

    expect(data.pair_code).toBe('ABCD-EFGH');
    expect(capacitorMocks.nativeRequest).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/v1/local-mindroom/pair/start',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Matrix-Access-Token': 'matrix-token-123',
      },
      responseType: 'json',
    });
  });

  it('replaces browser transport errors with a user-facing provisioning error', async () => {
    const request = vi.fn().mockRejectedValue(new TypeError('Load failed'));

    await expect(
      issueLocalMindroomPairCode(undefined, undefined, request as unknown as typeof fetch)
    ).rejects.toThrow(
      'Unable to reach the provisioning API. Verify the server/proxy is reachable from this app.'
    );
  });
});
