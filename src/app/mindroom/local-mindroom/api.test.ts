import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  approveLocalMindroomPairCode,
  getLocalMindroomConnections,
  getLocalMindroomErrorMessage,
  inspectLocalMindroomPairCode,
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

const pendingPairDevice = {
  client_name: 'studio-mac',
  created_at: '2026-09-26T12:00:00.000Z',
  expires_at: '2026-09-26T12:10:00.000Z',
  status: 'pending',
};

afterEach(() => {
  capacitorMocks.isNativePlatform.mockReturnValue(false);
  capacitorMocks.nativeRequest.mockReset();
});

describe('local mindroom api', () => {
  it('inspects a device pair code with the Matrix token and a JSON body', async () => {
    const request = vi.fn().mockResolvedValue(createResponse(200, pendingPairDevice));

    const data = await inspectLocalMindroomPairCode(
      'ABCD-EFGH',
      'matrix-token-123',
      undefined,
      request as unknown as typeof fetch
    );

    expect(data).toEqual(pendingPairDevice);
    expect(request).toHaveBeenCalledWith('/v1/local-mindroom/pair/device/inspect', {
      credentials: 'omit',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Matrix-Access-Token': 'matrix-token-123',
      },
      body: JSON.stringify({ pair_code: 'ABCD-EFGH' }),
    });
  });

  it('approves a device pair code at the provisioning base url', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(createResponse(200, { ...pendingPairDevice, status: 'approved' }));

    const data = await approveLocalMindroomPairCode(
      'ABCD-EFGH',
      'matrix-token-123',
      'https://provisioning.example/',
      request as unknown as typeof fetch
    );

    expect(data.status).toBe('approved');
    expect(request).toHaveBeenCalledWith(
      'https://provisioning.example/v1/local-mindroom/pair/device/approve',
      {
        credentials: 'omit',
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Matrix-Access-Token': 'matrix-token-123',
        },
        body: JSON.stringify({ pair_code: 'ABCD-EFGH' }),
      }
    );
  });

  it('keeps the HTTP status and server detail on pairing errors', async () => {
    const request = vi.fn().mockResolvedValue(createResponse(410, { detail: 'Pair code expired' }));

    const result = approveLocalMindroomPairCode(
      'ABCD-EFGH',
      'matrix-token-123',
      undefined,
      request as unknown as typeof fetch
    );

    await expect(result).rejects.toMatchObject({ status: 410, message: 'Pair code expired' });
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

  it('throws clear error for non-json successful responses', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
    } as unknown as Response);

    await expect(
      inspectLocalMindroomPairCode(
        'ABCD-EFGH',
        undefined,
        undefined,
        request as unknown as typeof fetch
      )
    ).rejects.toThrow(
      'Provisioning API returned invalid JSON. Verify provisioning URL/proxy configuration.'
    );
  });

  it('sends the JSON body through native http transport on native platforms', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true);
    capacitorMocks.nativeRequest.mockResolvedValue({
      status: 200,
      data: { ...pendingPairDevice, status: 'approved' },
      headers: {},
      url: 'https://mindroom.chat/v1/local-mindroom/pair/device/approve',
    });

    const data = await approveLocalMindroomPairCode(
      'ABCD-EFGH',
      'matrix-token-123',
      'https://mindroom.chat'
    );

    expect(data.status).toBe('approved');
    expect(capacitorMocks.nativeRequest).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/v1/local-mindroom/pair/device/approve',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Matrix-Access-Token': 'matrix-token-123',
      },
      data: JSON.stringify({ pair_code: 'ABCD-EFGH' }),
      responseType: 'json',
    });
  });

  it('keeps native requests without a body free of request data', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true);
    capacitorMocks.nativeRequest.mockResolvedValue({
      status: 200,
      data: { connections: [] },
      headers: {},
      url: 'https://mindroom.chat/v1/local-mindroom/connections',
    });

    await getLocalMindroomConnections('matrix-token-123', 'https://mindroom.chat');

    expect(capacitorMocks.nativeRequest).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/v1/local-mindroom/connections',
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Matrix-Access-Token': 'matrix-token-123',
      },
      responseType: 'json',
    });
  });

  it('keeps native error statuses for pairing requests', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true);
    capacitorMocks.nativeRequest.mockResolvedValue({
      status: 401,
      data: { detail: 'Invalid Matrix access token' },
      headers: {},
      url: 'https://mindroom.chat/v1/local-mindroom/pair/device/inspect',
    });

    await expect(
      inspectLocalMindroomPairCode('ABCD-EFGH', 'stale-token', 'https://mindroom.chat')
    ).rejects.toMatchObject({ status: 401, message: 'Invalid Matrix access token' });
  });

  it('replaces browser transport errors with a user-facing provisioning error', async () => {
    const request = vi.fn().mockRejectedValue(new TypeError('Load failed'));

    await expect(
      inspectLocalMindroomPairCode(
        'ABCD-EFGH',
        undefined,
        undefined,
        request as unknown as typeof fetch
      )
    ).rejects.toThrow(
      'Unable to reach the provisioning API. Verify the server/proxy is reachable from this app.'
    );
  });
});
