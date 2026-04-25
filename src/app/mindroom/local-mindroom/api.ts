import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { HttpHeaders, HttpOptions, HttpResponse } from '@capacitor/core';

export type LocalMindroomConnection = {
  id?: string;
  client_name?: string;
  created_at?: string;
  last_seen_at?: string;
  [key: string]: unknown;
};

export type LocalMindroomPairStartResponse = {
  pair_code: string;
  expires_at: string;
  poll_interval_seconds: number;
};

export type LocalMindroomPairStatusResponse =
  | {
      status: 'pending';
      expires_at?: string;
    }
  | {
      status: 'connected';
      connection?: LocalMindroomConnection;
    }
  | {
      status: 'expired';
    };

export type LocalMindroomConnectionsResponse = {
  connections: LocalMindroomConnection[];
};

const LOCAL_MINDROOM_API_PATH = '/v1/local-mindroom';
const LOCAL_MINDROOM_TRANSPORT_ERROR =
  'Unable to reach the provisioning API. Verify the server/proxy is reachable from this app.';

export class LocalMindroomApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'LocalMindroomApiError';
    this.status = status;
  }
}

const toErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as unknown;
    if (payload && typeof payload === 'object') {
      if ('message' in payload && typeof payload.message === 'string') return payload.message;
      if ('error' in payload && typeof payload.error === 'string') return payload.error;
      if ('detail' in payload && typeof payload.detail === 'string') return payload.detail;
    }
  } catch {
    // Ignore JSON parse failures and fallback to status-based message.
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

const getApiBaseUrl = (provisioningBaseUrl?: string): string => {
  const baseUrl = provisioningBaseUrl?.trim();
  if (!baseUrl) return LOCAL_MINDROOM_API_PATH;
  return `${baseUrl.replace(/\/+$/, '')}${LOCAL_MINDROOM_API_PATH}`;
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

const toNativeHttpOptions = (url: string, init: RequestInit): HttpOptions => ({
  url,
  method: init.method,
  headers: toHttpHeaders(init.headers),
  responseType: 'json',
});

const parseNativeJson = <T>(response: HttpResponse): T => {
  const { data } = response;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as T;
    } catch {
      throw new LocalMindroomApiError(
        'Provisioning API returned invalid JSON. Verify provisioning URL/proxy configuration.',
        response.status
      );
    }
  }

  return data as T;
};

const wrapTransportError = (error: unknown): LocalMindroomApiError => {
  if (error instanceof LocalMindroomApiError) return error;
  return new LocalMindroomApiError(LOCAL_MINDROOM_TRANSPORT_ERROR, 0);
};

const requestJson = async <T>(
  request: typeof fetch | undefined,
  url: string,
  init: RequestInit
): Promise<T> => {
  try {
    if (shouldUseNativeHttp(request)) {
      const response = await CapacitorHttp.request(toNativeHttpOptions(url, init));
      if (response.status < 200 || response.status >= 300) {
        throw new LocalMindroomApiError(
          toPayloadErrorMessage(response.data, response.status),
          response.status
        );
      }

      return parseNativeJson<T>(response);
    }

    const requestFn = request ?? fetch;
    const response = await requestFn(url, {
      credentials: 'omit',
      ...init,
    });

    if (!response.ok) {
      throw new LocalMindroomApiError(await toErrorMessage(response), response.status);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new LocalMindroomApiError(
        'Provisioning API returned invalid JSON. Verify provisioning URL/proxy configuration.',
        response.status
      );
    }
  } catch (error) {
    throw wrapTransportError(error);
  }
};

const requestNoContent = async (
  request: typeof fetch | undefined,
  url: string,
  init: RequestInit
) => {
  try {
    if (shouldUseNativeHttp(request)) {
      const response = await CapacitorHttp.request(toNativeHttpOptions(url, init));
      if (response.status < 200 || response.status >= 300) {
        throw new LocalMindroomApiError(
          toPayloadErrorMessage(response.data, response.status),
          response.status
        );
      }
      return;
    }

    const requestFn = request ?? fetch;
    const response = await requestFn(url, {
      credentials: 'omit',
      ...init,
    });

    if (!response.ok) {
      throw new LocalMindroomApiError(await toErrorMessage(response), response.status);
    }
  } catch (error) {
    throw wrapTransportError(error);
  }
};

const browserAuthHeaders = (accessToken?: string): HeadersInit => ({
  Accept: 'application/json',
  ...(accessToken ? { 'X-Matrix-Access-Token': accessToken } : {}),
});

export const issueLocalMindroomPairCode = async (
  accessToken?: string,
  provisioningBaseUrl?: string,
  request?: typeof fetch
): Promise<LocalMindroomPairStartResponse> =>
  requestJson<LocalMindroomPairStartResponse>(
    request,
    `${getApiBaseUrl(provisioningBaseUrl)}/pair/start`,
    {
      method: 'POST',
      headers: browserAuthHeaders(accessToken),
    }
  );

export const getLocalMindroomPairStatus = async (
  pairCode: string,
  accessToken?: string,
  provisioningBaseUrl?: string,
  request?: typeof fetch
): Promise<LocalMindroomPairStatusResponse> =>
  requestJson<LocalMindroomPairStatusResponse>(
    request,
    `${getApiBaseUrl(provisioningBaseUrl)}/pair/status?pair_code=${encodeURIComponent(pairCode)}`,
    {
      method: 'GET',
      headers: browserAuthHeaders(accessToken),
    }
  );

export const getLocalMindroomConnections = async (
  accessToken?: string,
  provisioningBaseUrl?: string,
  request?: typeof fetch
): Promise<LocalMindroomConnectionsResponse> =>
  requestJson<LocalMindroomConnectionsResponse>(
    request,
    `${getApiBaseUrl(provisioningBaseUrl)}/connections`,
    {
      method: 'GET',
      headers: browserAuthHeaders(accessToken),
    }
  );

export const revokeLocalMindroomConnection = async (
  connectionId: string,
  accessToken?: string,
  provisioningBaseUrl?: string,
  request?: typeof fetch
): Promise<void> =>
  requestNoContent(
    request,
    `${getApiBaseUrl(provisioningBaseUrl)}/connections/${encodeURIComponent(connectionId)}`,
    {
      method: 'DELETE',
      headers: browserAuthHeaders(accessToken),
    }
  );

export const getLocalMindroomErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  return 'Request failed. Please try again.';
};
