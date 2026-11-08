import { MindroomServerError, type ClientSessions } from '../../computer/clientSessions';
import type { SpeechStretch } from './speechCapture';

const API_PATH = '/api/call-transcripts/v1';

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

/** A call route MindRoom refused (`status`), or answered with something not JSON (status 0). */
export class TranscriptionApiError extends MindroomServerError {
  readonly code?: RefusalCode;

  /** When to try again, from `Retry-After`. */
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, code?: RefusalCode, retryAfterMs?: number) {
    super(message, status);
    this.name = 'TranscriptionApiError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** MindRoom does not transcribe this room (or not for this person): nothing is shown or sent. */
export const isNotTranscribed = (error: unknown): boolean =>
  error instanceof MindroomServerError && (error.status === 403 || error.status === 404);

/** MindRoom could not be reached or failed: transcripts are unavailable for now. */
export const isUnavailable = (error: unknown): boolean =>
  error instanceof MindroomServerError && (error.status === 0 || error.status >= 500);

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

/** MindRoom's call transcript routes for the signed-in person, sent with their client session. */
export class TranscriptionClient {
  private readonly sessions: ClientSessions;

  constructor(sessions: ClientSessions) {
    this.sessions = sessions;
  }

  /** Sends a call route with the session for its JSON. */
  private async sendJson<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.sessions.send(`${API_PATH}${path}`, init);
    if (!response.ok) throw await refusal(response);
    try {
      return (await response.json()) as T;
    } catch {
      throw new TranscriptionApiError('MindRoom answered with something that is not JSON.', 0);
    }
  }

  /** Joins the room's live call, starting it if there is none; also the heartbeat. */
  async join(roomId: string, signal?: AbortSignal): Promise<TranscriptCall> {
    const { call } = await this.sendJson<{ call: TranscriptCall }>(
      `/rooms/${encodeURIComponent(roomId)}/calls.join`,
      { method: 'POST', signal }
    );
    return call;
  }

  async leave(callId: string, signal?: AbortSignal): Promise<void> {
    await this.sendJson(`/calls/${encodeURIComponent(callId)}/leave`, { method: 'POST', signal });
  }

  /** Leaves at once with the session held, as the page goes or signs out (`sendNow`). */
  leaveNow(callId: string): Promise<void> {
    return this.sessions.sendNow(`${API_PATH}/calls/${encodeURIComponent(callId)}/leave`, {
      method: 'POST',
    });
  }

  /** Pauses or resumes transcription of the call for everyone in it. */
  async pause(callId: string, paused: boolean, signal?: AbortSignal): Promise<TranscriptCall> {
    const { call } = await this.sendJson<{ call: TranscriptCall }>(
      `/calls/${encodeURIComponent(callId)}/pause`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused }),
        signal,
      }
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
      { method: 'POST', body: form, signal }
    );
    return line;
  }

  /** The room's live call, with its lines after the line `after` (all of them without it). */
  live(roomId: string, after?: string, signal?: AbortSignal): Promise<LiveCall> {
    const query = after === undefined ? '' : `?after=${encodeURIComponent(after)}`;
    return this.sendJson<LiveCall>(`/rooms/${encodeURIComponent(roomId)}/calls.live${query}`, {
      method: 'GET',
      signal,
    });
  }
}
