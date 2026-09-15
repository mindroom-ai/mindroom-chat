import type { IOpenIDToken } from 'matrix-js-sdk';
import type {
  ComputerControlAction,
  ComputerSession,
  ComputerStatus,
  ComputerStreamConnection,
  ComputerStreamTicket,
  CreateComputerSessionRequest,
} from './types';

const COMPUTER_SESSIONS_PATH = '/api/computers/sessions';
const MAX_ERROR_LENGTH = 300;

export class ComputerApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ComputerApiError';
    this.status = status;
  }
}

const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

export const resolveComputerApiUrl = (configuredUrl?: string): string | undefined => {
  const value = configuredUrl?.trim();
  if (!value) return undefined;

  try {
    const url = new URL(value);
    const supportedProtocol =
      url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname));
    if (
      !supportedProtocol ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
};

const boundedDetail = (value: unknown, status: number): string => {
  if (typeof value === 'string') {
    const detail = value.trim();
    if (detail) return detail.slice(0, MAX_ERROR_LENGTH);
  }
  return `Computer request failed (${status}).`;
};

const responseError = async (response: Response): Promise<ComputerApiError> => {
  try {
    const payload = (await response.json()) as unknown;
    if (payload && typeof payload === 'object' && 'detail' in payload) {
      return new ComputerApiError(
        boundedDetail((payload as { detail?: unknown }).detail, response.status),
        response.status
      );
    }
  } catch {
    // Use a bounded status-only fallback for invalid error bodies.
  }
  return new ComputerApiError(`Computer request failed (${response.status}).`, response.status);
};

const transportError = (error: unknown): ComputerApiError => {
  if (error instanceof ComputerApiError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ComputerApiError('Computer request cancelled.', 0);
  }
  return new ComputerApiError('Unable to reach the computer service.', 0);
};

const requestJson = async <T>(
  request: typeof fetch,
  url: string,
  init: RequestInit
): Promise<T> => {
  try {
    const response = await request(url, {
      cache: 'no-store',
      credentials: 'omit',
      ...init,
    });
    if (!response.ok) throw await responseError(response);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ComputerApiError('Computer service returned an invalid response.', response.status);
    }
  } catch (error) {
    throw transportError(error);
  }
};

const requestNoContent = async (
  request: typeof fetch,
  url: string,
  init: RequestInit
): Promise<void> => {
  try {
    const response = await request(url, {
      cache: 'no-store',
      credentials: 'omit',
      ...init,
    });
    if (!response.ok) throw await responseError(response);
  } catch (error) {
    throw transportError(error);
  }
};

const bearerHeaders = (sessionToken: string): HeadersInit => ({
  Accept: 'application/json',
  Authorization: `Bearer ${sessionToken}`,
});

export class ComputerSessionClient {
  private readonly apiUrl: string;

  private readonly request: typeof fetch;

  private readonly sessionToken: string;

  private currentStatus: ComputerStatus;

  constructor(apiUrl: string, session: ComputerSession, request: typeof fetch) {
    this.apiUrl = apiUrl;
    this.request = request;
    this.sessionToken = session.session_token;
    this.currentStatus = {
      session_id: session.session_id,
      state: session.state,
      mode: session.mode,
      expires_at: session.expires_at,
    };
  }

  get status(): ComputerStatus {
    return this.currentStatus;
  }

  private get sessionUrl(): string {
    return `${this.apiUrl}${COMPUTER_SESSIONS_PATH}/${encodeURIComponent(
      this.currentStatus.session_id
    )}`;
  }

  async refreshStatus(signal?: AbortSignal): Promise<ComputerStatus> {
    const status = await requestJson<ComputerStatus>(this.request, this.sessionUrl, {
      method: 'GET',
      headers: bearerHeaders(this.sessionToken),
      signal,
    });
    this.currentStatus = status;
    return status;
  }

  async createStream(signal?: AbortSignal): Promise<ComputerStreamConnection> {
    const streamTicket = await requestJson<ComputerStreamTicket>(
      this.request,
      `${this.sessionUrl}/stream-ticket`,
      {
        method: 'POST',
        headers: bearerHeaders(this.sessionToken),
        signal,
      }
    );
    const streamUrl = new URL(`${this.sessionUrl}/stream`);
    streamUrl.protocol = streamUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    return {
      url: streamUrl.toString(),
      protocols: ['binary', `mindroom-ticket.${streamTicket.ticket}`],
    };
  }

  async control(action: ComputerControlAction, signal?: AbortSignal): Promise<ComputerStatus> {
    const status = await requestJson<ComputerStatus>(this.request, `${this.sessionUrl}/control`, {
      method: 'POST',
      headers: {
        ...bearerHeaders(this.sessionToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action }),
      signal,
    });
    this.currentStatus = status;
    return status;
  }

  dispose(signal?: AbortSignal): Promise<void> {
    return requestNoContent(this.request, this.sessionUrl, {
      method: 'DELETE',
      headers: bearerHeaders(this.sessionToken),
      signal,
    });
  }
}

export const createComputerSession = async ({
  apiUrl,
  agentUserId,
  openIdToken,
  request = fetch,
  roomId,
  signal,
}: {
  apiUrl: string;
  agentUserId: string;
  openIdToken: IOpenIDToken;
  request?: typeof fetch;
  roomId: string;
  signal?: AbortSignal;
}): Promise<ComputerSessionClient> => {
  const payload: CreateComputerSessionRequest = {
    openid_token: openIdToken,
    room_id: roomId,
    agent_user_id: agentUserId,
  };
  const session = await requestJson<ComputerSession>(
    request,
    `${apiUrl}${COMPUTER_SESSIONS_PATH}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    }
  );
  return new ComputerSessionClient(apiUrl, session, request);
};
