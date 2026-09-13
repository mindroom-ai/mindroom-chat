import { afterEach, describe, expect, it, vi } from 'vitest';
import { approveRequest, denyRequest } from './api';

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

describe('approvals api', () => {
  it('includes the matrix access token on browser approval requests', async () => {
    const request = vi.fn().mockResolvedValue(createResponse(200));

    await approveRequest('approval-1', 'matrix-token-123', request as unknown as typeof fetch);

    expect(request).toHaveBeenCalledWith('http://localhost:8765/api/approvals/approval-1/approve', {
      credentials: 'omit',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Matrix-Access-Token': 'matrix-token-123',
      },
      body: '{}',
    });
  });

  it('uses native http on capacitor and forwards auth plus deny payload', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true);
    capacitorMocks.nativeRequest.mockResolvedValue({
      status: 200,
      data: null,
      headers: {},
      url: 'http://localhost:8765/api/approvals/approval-1/deny',
    });

    await denyRequest('approval-1', 'Needs human review', 'matrix-token-123');

    expect(capacitorMocks.nativeRequest).toHaveBeenCalledWith({
      url: 'http://localhost:8765/api/approvals/approval-1/deny',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Matrix-Access-Token': 'matrix-token-123',
      },
      responseType: 'json',
      data: {
        reason: 'Needs human review',
      },
    });
  });

  it('surfaces API error payloads', async () => {
    const request = vi.fn().mockResolvedValue(
      createResponse(401, {
        detail: 'Missing matrix access token',
      })
    );

    await expect(
      approveRequest('approval-1', 'matrix-token-123', request as unknown as typeof fetch)
    ).rejects.toThrow('Missing matrix access token');
  });
});
