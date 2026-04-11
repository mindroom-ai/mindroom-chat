import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { HttpHeaders, HttpOptions } from '@capacitor/core';

const DEFAULT_APPROVALS_API_BASE = 'http://localhost:8765';

const getApprovalsApiBase = (): string => {
  const configuredBase = import.meta.env.VITE_MINDROOM_API_URL;
  if (typeof configuredBase !== 'string' || configuredBase.trim().length === 0) {
    return DEFAULT_APPROVALS_API_BASE;
  }

  return configuredBase.replace(/\/+$/, '');
};

const getErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as unknown;
    if (payload && typeof payload === 'object') {
      if ('message' in payload && typeof payload.message === 'string') return payload.message;
      if ('error' in payload && typeof payload.error === 'string') return payload.error;
      if ('detail' in payload && typeof payload.detail === 'string') return payload.detail;
    }
  } catch {
    // Fall through to the status-based error message when the body is absent or invalid.
  }

  return `Request failed (${response.status})`;
};

const toPayloadErrorMessage = (payload: unknown, status: number): string => {
  if (payload && typeof payload === 'object') {
    if ('message' in payload && typeof payload.message === 'string') return payload.message;
    if ('error' in payload && typeof payload.error === 'string') return payload.error;
    if ('detail' in payload && typeof payload.detail === 'string') return payload.detail;
  }

  if (typeof payload === 'string' && payload.trim()) return payload;
  return `Request failed (${status})`;
};

const shouldUseNativeHttp = (request?: typeof fetch): boolean =>
  request === undefined && Capacitor.isNativePlatform();

const toHttpHeaders = (headers?: HeadersInit): HttpHeaders => {
  if (!headers) return {};

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, value?.toString() ?? ''])
  );
};

const toNativeHttpData = (init: RequestInit): unknown => {
  const { body } = init;
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'string') return body;

  const contentTypeEntry = Object.entries(toHttpHeaders(init.headers)).find(
    ([key]) => key.toLowerCase() === 'content-type'
  );
  const contentType = contentTypeEntry?.[1];

  if (typeof contentType === 'string' && contentType.toLowerCase().includes('application/json')) {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }

  return body;
};

const toNativeHttpOptions = (url: string, init: RequestInit): HttpOptions => {
  const data = toNativeHttpData(init);

  return {
    url,
    method: init.method,
    headers: toHttpHeaders(init.headers),
    responseType: 'json',
    ...(data !== undefined ? { data } : {}),
  };
};

const browserAuthHeaders = (accessToken?: string): HeadersInit => ({
  Accept: 'application/json',
  'Content-Type': 'application/json',
  ...(accessToken ? { 'X-Matrix-Access-Token': accessToken } : {}),
});

const postApprovalAction = async (
  approvalId: string,
  action: 'approve' | 'deny',
  payload: Record<string, unknown> = {},
  accessToken?: string,
  request?: typeof fetch
): Promise<void> => {
  const url = `${getApprovalsApiBase()}/api/approvals/${encodeURIComponent(approvalId)}/${action}`;
  const init: RequestInit = {
    method: 'POST',
    headers: browserAuthHeaders(accessToken),
    body: JSON.stringify(payload),
  };

  if (shouldUseNativeHttp(request)) {
    const response = await CapacitorHttp.request(toNativeHttpOptions(url, init));
    if (response.status < 200 || response.status >= 300) {
      throw new Error(toPayloadErrorMessage(response.data, response.status));
    }
    return;
  }

  const requestFn = request ?? fetch;
  const response = await requestFn(url, {
    credentials: 'omit',
    ...init,
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }
};

export const approveRequest = async (
  approvalId: string,
  accessToken?: string,
  request?: typeof fetch
): Promise<void> => postApprovalAction(approvalId, 'approve', {}, accessToken, request);

export const denyRequest = async (
  approvalId: string,
  reason?: string,
  accessToken?: string,
  request?: typeof fetch
): Promise<void> =>
  postApprovalAction(
    approvalId,
    'deny',
    {
      reason: reason?.trim() ? reason.trim() : null,
    },
    accessToken,
    request
  );
