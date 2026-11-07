import { ConnectionError, MatrixError, type IOpenIDToken } from 'matrix-js-sdk';
import type { SpeechStretch } from './speechCapture';

const API_PATH = '/api/call-transcripts/v1';
const SESSIONS_PATH = '/api/client-sessions';
/** A session is renewed this long before the server lets it run out. */
const SESSION_RENEW_MARGIN_MS = 60_000;
/** Signing in (the token and the exchange) gives up after this long; the next request tries again. */
const SIGN_IN_TIMEOUT_MS = 15_000;

/** A call as MindRoom keeps it: who is in it, and who paused it. */
export type TranscriptCall = {
  id: string;
  roomId: string;
  /** The room's "Call started" row, once the router posted it. */
  rowEventId: string | null;
  startedAt: string;
  /** Null while the call is live. */
  endedAt: string | null;
  /** User IDs whose apps are in the call now. */
  members: string[];
  /** Who paused transcription; null while it is not paused. */
  pausedBy: string | null;
};

/** One line of the live transcript: what someone said, or a gap. */
export type TranscriptLine = {
  id: string;
  callId: string;
  userId: string;
  saidAt: string;
  seconds: number;
} & ({ kind: 'speech'; text: string } | { kind: 'gap'; reason: 'paused' | 'not-transcribed' });

/** A room's live call, its lines so far and the names to show them under. */
export type LiveCall = {
  call: TranscriptCall | null;
  lines: TranscriptLine[];
  names: Record<string, string | null>;
};

export type RefusalCode =
  | 'forbidden'
  | 'not-found'
  | 'invalid'
  | 'paused'
  | 'too-many-requests'
  | 'unavailable'
  | 'too-large';

/** A request MindRoom refused (`status`), or one that got no answer (status 0). */
export class TranscriptionApiError extends Error {
  readonly status: number;

  readonly code?: RefusalCode;

  /** When to try again, from `Retry-After`. */
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, code?: RefusalCode, retryAfterMs?: number) {
    super(message);
    this.name = 'TranscriptionApiError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** MindRoom does not transcribe this room (or not for this person): nothing is shown or sent. */
export const isNotTranscribed = (error: unknown): boolean =>
  error instanceof TranscriptionApiError && (error.status === 403 || error.status === 404);

/** MindRoom could not be reached or failed: transcripts are unavailable for now. */
export const isUnavailable = (error: unknown): boolean =>
  error instanceof TranscriptionApiError && (error.status === 0 || error.status >= 500);

const noAnswer = (message: string) => new TranscriptionApiError(message, 0);

/** `Retry-After` in milliseconds from now: delay seconds or an HTTP date. */
const readRetryAfter = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
};

const refusal = async (response: Response): Promise<TranscriptionApiError> => {
  let message = `Call transcripts request failed (${response.status}).`;
  let code: RefusalCode | undefined;
  try {
    const body = (await response.json()) as { error?: unknown; detail?: unknown; code?: unknown };
    const text = body.error ?? body.detail;
    if (typeof text === 'string' && text.trim()) message = text.trim().slice(0, 300);
    if (typeof body.code === 'string') code = body.code as RefusalCode;
  } catch {
    // Not JSON: the status says enough.
  }
  return new TranscriptionApiError(
    message,
    response.status,
    code,
    readRetryAfter(response.headers.get('Retry-After'))
  );
};

/** Rejects as soon as `signal` aborts, for steps that cannot be cancelled themselves. */
const untilAborted = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(noAnswer('Call transcripts request cancelled.'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(noAnswer('Call transcripts request cancelled.'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
};

/**
 * A homeserver that could not be asked, or failed, may answer later. One that refused for good,
 * such as one that does not bind tokens to their audience, never lets MindRoom sign this person in.
 */
const tokenError = (error: unknown): TranscriptionApiError => {
  if (error instanceof TranscriptionApiError) return error;
  if (error instanceof ConnectionError || error instanceof MatrixError)
    return noAnswer('The homeserver could not give a sign-in token.');
  return new TranscriptionApiError(
    'The homeserver will not sign in to MindRoom.',
    403,
    'forbidden'
  );
};

type ClientSession = { token: string; expiresAt: number };

export type TranscriptionClientOptions = {
  /** The MindRoom server's origin. */
  apiUrl: string;
  /** A Matrix OpenID token bound to `apiUrl`. */
  getOpenIdToken: () => Promise<IOpenIDToken>;
  request?: typeof fetch;
};

/**
 * MindRoom's call transcript routes for the signed-in person. It signs in with a Matrix OpenID
 * token for a client session and sends that as bearer; no cookies go with any request.
 */
export class TranscriptionClient {
  private readonly apiUrl: string;

  private readonly getOpenIdToken: () => Promise<IOpenIDToken>;

  private readonly request: typeof fetch;

  private session?: ClientSession;

  private signingIn?: Promise<ClientSession>;

  constructor({ apiUrl, getOpenIdToken, request }: TranscriptionClientOptions) {
    this.apiUrl = apiUrl;
    this.getOpenIdToken = getOpenIdToken;
    this.request = request ?? ((input, init) => fetch(input, init));
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.request(url, { ...init, credentials: 'omit', cache: 'no-store' });
    } catch {
      throw noAnswer('MindRoom could not be reached.');
    }
  }

  private async signIn(): Promise<ClientSession> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), SIGN_IN_TIMEOUT_MS);
    try {
      return await this.exchange(timeout.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private async exchange(signal: AbortSignal): Promise<ClientSession> {
    const openIdToken = await untilAborted(this.getOpenIdToken(), signal).catch(
      (error: unknown) => {
        throw tokenError(error);
      }
    );
    const response = await this.fetch(`${this.apiUrl}${SESSIONS_PATH}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ openid_token: openIdToken }),
      signal,
    });
    if (!response.ok) throw await refusal(response);
    const body = (await response.json().catch(() => undefined)) as
      | { session_token?: unknown; expires_at?: unknown }
      | undefined;
    if (typeof body?.session_token !== 'string' || typeof body.expires_at !== 'number') {
      throw noAnswer('MindRoom answered the sign-in without a session.');
    }
    return { token: body.session_token, expiresAt: body.expires_at * 1000 };
  }

  /**
   * The session to send, signing in when there is none or it is about to run out. Requests at the
   * same time share one sign-in; a failed one is not kept, so the next request signs in again.
   */
  private currentSession(signal?: AbortSignal): Promise<ClientSession> {
    if (this.session && this.session.expiresAt - SESSION_RENEW_MARGIN_MS > Date.now()) {
      return Promise.resolve(this.session);
    }
    this.session = undefined;
    if (!this.signingIn) {
      const signingIn: Promise<ClientSession> = this.signIn()
        .then((session) => {
          if (this.signingIn === signingIn) this.session = session;
          return session;
        })
        .finally(() => {
          if (this.signingIn === signingIn) this.signingIn = undefined;
        });
      this.signingIn = signingIn;
    }
    return untilAborted(this.signingIn, signal);
  }

  /** Sends a call route with the session for its JSON; a refused session signs in again, once. */
  private async sendJson<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const session = await this.currentSession(signal);
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/json');
      headers.set('Authorization', `Bearer ${session.token}`);
      const response = await this.fetch(`${this.apiUrl}${API_PATH}${path}`, {
        ...init,
        headers,
        signal,
      });
      if (response.status === 401 && attempt === 0) {
        if (this.session === session) this.session = undefined;
        continue;
      }
      if (!response.ok) throw await refusal(response);
      try {
        return (await response.json()) as T;
      } catch {
        throw noAnswer('MindRoom answered with something that is not JSON.');
      }
    }
  }

  /** Joins the room's live call, starting it if there is none; also the heartbeat. */
  async join(roomId: string, signal?: AbortSignal): Promise<TranscriptCall> {
    const { call } = await this.sendJson<{ call: TranscriptCall }>(
      `/rooms/${encodeURIComponent(roomId)}/calls.join`,
      { method: 'POST' },
      signal
    );
    return call;
  }

  async leave(callId: string, signal?: AbortSignal): Promise<void> {
    await this.sendJson(`/calls/${encodeURIComponent(callId)}/leave`, { method: 'POST' }, signal);
  }

  /**
   * Leaves at once with the session already held, for a page that goes away: the request outlives
   * the page. Without a session, or once it has run out, nothing is sent, as there is no time to
   * sign in.
   */
  leaveNow(callId: string): void {
    const { session } = this;
    if (!session || session.expiresAt <= Date.now()) return;
    void this.fetch(`${this.apiUrl}${API_PATH}/calls/${encodeURIComponent(callId)}/leave`, {
      method: 'POST',
      keepalive: true,
      headers: { Accept: 'application/json', Authorization: `Bearer ${session.token}` },
    }).catch(() => undefined);
  }

  /** Pauses or resumes transcription of the call for everyone in it. */
  async pause(callId: string, paused: boolean, signal?: AbortSignal): Promise<TranscriptCall> {
    const { call } = await this.sendJson<{ call: TranscriptCall }>(
      `/calls/${encodeURIComponent(callId)}/pause`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused }),
      },
      signal
    );
    return call;
  }

  /**
   * Sends one stretch of speech; MindRoom answers with its line, a gap, or null when it heard no
   * words in it.
   */
  async speech(
    callId: string,
    { wav, startedAt }: Pick<SpeechStretch, 'wav' | 'startedAt'>,
    signal?: AbortSignal
  ): Promise<TranscriptLine | null> {
    const form = new FormData();
    form.append('audio', wav, 'speech.wav');
    form.append('startedAt', startedAt.toISOString());
    const { line } = await this.sendJson<{ line: TranscriptLine | null }>(
      `/calls/${encodeURIComponent(callId)}/speech`,
      { method: 'POST', body: form },
      signal
    );
    return line;
  }

  /** The room's live call, with its lines after the line `after` (all of them without it). */
  live(roomId: string, after?: string, signal?: AbortSignal): Promise<LiveCall> {
    const query = after === undefined ? '' : `?after=${encodeURIComponent(after)}`;
    return this.sendJson<LiveCall>(
      `/rooms/${encodeURIComponent(roomId)}/calls.live${query}`,
      { method: 'GET' },
      signal
    );
  }
}
