import { ConnectionError, MatrixError, type IOpenIDToken } from 'matrix-js-sdk';
import type { SpeechStretch } from './speechCapture';

const API_PATH = '/api/call-transcripts/v1';
const SESSIONS_PATH = '/api/client-sessions';
/** A session is renewed this long before the server lets it run out. */
const SESSION_RENEW_MARGIN_MS = 60_000;
/** Signing in (the token and the exchange) gives up after this long; the next request tries again. */
const SIGN_IN_TIMEOUT_MS = 15_000;

/** A call as MindRoom keeps it: who is in it, who holds Pause, and whose apps transcribe. */
export type TranscriptCall = {
  id: string;
  roomId: string;
  /** The room's "Call started" row, once the router posted it. */
  rowEventId: string | null;
  startedAt: string;
  /** Null while the call is live. */
  endedAt: string | null;
  /** User IDs in the call now. */
  members: string[];
  /** User IDs holding Pause. */
  holds: string[];
  /** User IDs whose apps transcribe them. */
  transcribedBy: string[];
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

/** What the room's event stream says, as it happens. */
export type CallEvent =
  | { type: 'ready'; live: LiveCall }
  | { type: 'call'; call: TranscriptCall }
  | { type: 'line'; line: TranscriptLine }
  | { type: 'ended'; callId: string };

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

/** One complete event of a `text/event-stream` body. */
type StreamEvent = { type: string; data: string };

/** Splits a `text/event-stream` body, fed in pieces, into its events; comments are skipped. */
const eventStreamParser = (emit: (event: StreamEvent) => void) => {
  let buffer = '';
  let type = '';
  let data: string[] = [];
  const line = (text: string) => {
    if (text === '') {
      if (data.length > 0) emit({ type: type || 'message', data: data.join('\n') });
      type = '';
      data = [];
      return;
    }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    const value = colon === -1 ? '' : text.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') type = value;
    else if (field === 'data') data.push(value);
  };
  return (chunk: string) => {
    buffer += chunk;
    // A CR at the end may be the first half of a CRLF still on its way.
    const end = buffer.endsWith('\r') ? buffer.length - 1 : buffer.length;
    const lines = buffer.slice(0, end).split(/\r\n|\r|\n/);
    buffer = (lines.pop() ?? '') + buffer.slice(end);
    lines.forEach(line);
  };
};

/** One stream event as the app reads it; every event's data is JSON, and anything else is skipped. */
const readCallEvent = ({ type, data }: StreamEvent): CallEvent | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (type === 'ended') {
    const { callId } = value as { callId?: unknown };
    return typeof callId === 'string' ? { type, callId } : undefined;
  }
  if (type === 'ready') return { type, live: value as LiveCall };
  if (type === 'call') return { type, call: value as TranscriptCall };
  if (type === 'line') return { type, line: value as TranscriptLine };
  return undefined;
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

  /** Sends a call route with the session; a refused session signs in again, once. */
  private async send(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const session = await this.currentSession(signal);
      const headers = new Headers(init.headers);
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
      return response;
    }
  }

  private async sendJson<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    const response = await this.send(path, { ...init, headers }, signal);
    try {
      return (await response.json()) as T;
    } catch {
      throw noAnswer('MindRoom answered with something that is not JSON.');
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
   * Takes or lets go of this person's hold on Pause. Sent to outlast the page, so a hold let go
   * of as the page goes away (which sends no leave) still reaches MindRoom.
   */
  async pause(callId: string, holding: boolean, signal?: AbortSignal): Promise<TranscriptCall> {
    const { call } = await this.sendJson<{ call: TranscriptCall }>(
      `/calls/${encodeURIComponent(callId)}/pause`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holding }),
        keepalive: true,
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

  live(roomId: string, signal?: AbortSignal): Promise<LiveCall> {
    return this.sendJson<LiveCall>(
      `/rooms/${encodeURIComponent(roomId)}/calls.live`,
      { method: 'GET' },
      signal
    );
  }

  /**
   * Reads the room's event stream, handing on each event, until the server closes it (resolves)
   * or it fails or `signal` aborts (rejects). The server writes at least a comment every 20 s, so a
   * stream quiet for `idleMs` is taken for lost.
   */
  async events(
    roomId: string,
    onEvent: (event: CallEvent) => void,
    signal: AbortSignal,
    idleMs: number
  ): Promise<void> {
    const connection = new AbortController();
    const stop = () => connection.abort();
    signal.addEventListener('abort', stop, { once: true });
    let quiet = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const heard = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        quiet = true;
        connection.abort();
      }, idleMs);
    };
    try {
      heard();
      const response = await this.send(
        `/rooms/${encodeURIComponent(roomId)}/calls.events`,
        { method: 'GET', headers: { Accept: 'text/event-stream' } },
        connection.signal
      );
      const reader = response.body?.getReader();
      if (!reader) throw noAnswer('MindRoom answered the event stream without a body.');
      connection.signal.addEventListener('abort', () => {
        reader.cancel().catch(() => undefined);
      });
      const decoder = new TextDecoder();
      const parse = eventStreamParser((event) => {
        const callEvent = readCallEvent(event);
        if (callEvent) onEvent(callEvent);
      });
      for (;;) {
        const { done, value } = await reader.read();
        if (connection.signal.aborted) throw noAnswer('The event stream stopped.');
        if (done) return;
        heard();
        parse(decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      if (quiet) throw noAnswer('The event stream went quiet.');
      if (error instanceof TranscriptionApiError) throw error;
      throw noAnswer('The event stream broke off.');
    } finally {
      clearTimeout(idle);
      signal.removeEventListener('abort', stop);
    }
  }
}
