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

const getApiBaseUrl = (provisioningBaseUrl?: string): string => {
  const baseUrl = provisioningBaseUrl?.trim();
  if (!baseUrl) return LOCAL_MINDROOM_API_PATH;
  return `${baseUrl.replace(/\/+$/, '')}${LOCAL_MINDROOM_API_PATH}`;
};

const requestJson = async <T>(
  request: typeof fetch,
  url: string,
  init: RequestInit
): Promise<T> => {
  const response = await request(url, {
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
};

const requestNoContent = async (request: typeof fetch, url: string, init: RequestInit) => {
  const response = await request(url, {
    credentials: 'omit',
    ...init,
  });

  if (!response.ok) {
    throw new LocalMindroomApiError(await toErrorMessage(response), response.status);
  }
};

const browserAuthHeaders = (accessToken?: string): HeadersInit => ({
  Accept: 'application/json',
  ...(accessToken ? { 'X-Matrix-Access-Token': accessToken } : {}),
});

export const issueLocalMindroomPairCode = async (
  request?: typeof fetch,
  accessToken?: string,
  provisioningBaseUrl?: string
): Promise<LocalMindroomPairStartResponse> => {
  const requestFn = request ?? fetch;
  return requestJson<LocalMindroomPairStartResponse>(
    requestFn,
    `${getApiBaseUrl(provisioningBaseUrl)}/pair/start`,
    {
      method: 'POST',
      headers: browserAuthHeaders(accessToken),
    }
  );
};

export const getLocalMindroomPairStatus = async (
  pairCode: string,
  request?: typeof fetch,
  accessToken?: string,
  provisioningBaseUrl?: string
): Promise<LocalMindroomPairStatusResponse> => {
  const requestFn = request ?? fetch;
  return requestJson<LocalMindroomPairStatusResponse>(
    requestFn,
    `${getApiBaseUrl(provisioningBaseUrl)}/pair/status?pair_code=${encodeURIComponent(pairCode)}`,
    {
      method: 'GET',
      headers: browserAuthHeaders(accessToken),
    }
  );
};

export const getLocalMindroomConnections = async (
  request?: typeof fetch,
  accessToken?: string,
  provisioningBaseUrl?: string
): Promise<LocalMindroomConnectionsResponse> => {
  const requestFn = request ?? fetch;
  return requestJson<LocalMindroomConnectionsResponse>(
    requestFn,
    `${getApiBaseUrl(provisioningBaseUrl)}/connections`,
    {
      method: 'GET',
      headers: browserAuthHeaders(accessToken),
    }
  );
};

export const revokeLocalMindroomConnection = async (
  connectionId: string,
  request?: typeof fetch,
  accessToken?: string,
  provisioningBaseUrl?: string
): Promise<void> => {
  const requestFn = request ?? fetch;
  return requestNoContent(
    requestFn,
    `${getApiBaseUrl(provisioningBaseUrl)}/connections/${encodeURIComponent(connectionId)}`,
    {
      method: 'DELETE',
      headers: browserAuthHeaders(accessToken),
    }
  );
};

export const getLocalMindroomErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  return 'Request failed. Please try again.';
};
