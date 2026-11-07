import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionError, type IOpenIDToken } from 'matrix-js-sdk';
import {
  TranscriptionApiError,
  TranscriptionClient,
  isNotTranscribed,
  isUnavailable,
  type TranscriptCall,
  type TranscriptLine,
} from './api';

const API_URL = 'https://mindroom.example.org';
const ROOM_ID = '!room:example.org';
const NOW = Date.UTC(2026, 10, 7, 9, 30);

const TOKEN: IOpenIDToken = {
  access_token: 'openid',
  token_type: 'Bearer',
  matrix_server_name: 'example.org',
  expires_in: 3600,
};

const CALL: TranscriptCall = {
  id: 'call-1',
  roomId: ROOM_ID,
  rowEventId: null,
  startedAt: '2026-11-07T09:29:00Z',
  endedAt: null,
  members: ['@ann:example.org'],
  pausedBy: null,
};

const LINE: TranscriptLine = {
  id: 'line-1',
  callId: 'call-1',
  userId: '@ann:example.org',
  saidAt: '2026-11-07T09:29:30Z',
  seconds: 1.5,
  kind: 'speech',
  text: 'Hello there',
};

type Sent = { url: string; init: RequestInit };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** A MindRoom server: client sessions, and answers for the call routes a test sets. */
const fakeServer = () => {
  const sent: Sent[] = [];
  let sessions = 0;
  /** How long a session lasts, in seconds from now. */
  const lasting = { seconds: 3600 };
  const route = vi.fn((_url: string, _init: RequestInit): Response | Promise<Response> => json({}));
  return {
    sent,
    lasting,
    route,
    request: vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      sent.push({ url, init });
      if (url === `${API_URL}/api/client-sessions`) {
        sessions += 1;
        return json({
          session_token: `session-${sessions}`,
          user_id: '@ann:example.org',
          expires_at: Math.floor(Date.now() / 1000) + lasting.seconds,
        });
      }
      return route(url, init);
    }),
    /** The requests to the call routes, without the sign-ins. */
    calls: () => sent.filter(({ url }) => url.includes('/api/call-transcripts/')),
  };
};

const bearer = ({ init }: Sent) => new Headers(init.headers).get('Authorization');

const client = (
  server: ReturnType<typeof fakeServer>,
  getOpenIdToken = vi.fn(async (): Promise<IOpenIDToken> => TOKEN)
) => ({
  getOpenIdToken,
  api: new TranscriptionClient({ apiUrl: API_URL, getOpenIdToken, request: server.request }),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TranscriptionClient sessions', () => {
  it('signs in with an OpenID token once, then sends every request with the session as bearer', async () => {
    const server = fakeServer();
    server.route.mockImplementation(() => json({ call: CALL }));
    const { api, getOpenIdToken } = client(server);

    await expect(api.join(ROOM_ID)).resolves.toEqual(CALL);
    await api.join(ROOM_ID);

    expect(getOpenIdToken).toHaveBeenCalledTimes(1);
    const [signIn] = server.sent;
    expect(signIn?.init.method).toBe('POST');
    expect(JSON.parse(String(signIn?.init.body))).toEqual({ openid_token: TOKEN });
    expect(server.calls().map(bearer)).toEqual(['Bearer session-1', 'Bearer session-1']);
    // No cookies go with them, and no answer is kept.
    server.sent.forEach(({ init }) => {
      expect(init.credentials).toBe('omit');
      expect(init.cache).toBe('no-store');
    });
  });

  it('signs in again and repeats the request once when the session is refused', async () => {
    const server = fakeServer();
    server.route
      .mockImplementationOnce(() => json({ detail: 'expired' }, 401))
      .mockImplementationOnce(() => json({ call: CALL }));
    const { api, getOpenIdToken } = client(server);

    await expect(api.join(ROOM_ID)).resolves.toEqual(CALL);

    expect(getOpenIdToken).toHaveBeenCalledTimes(2);
    expect(server.calls().map(bearer)).toEqual(['Bearer session-1', 'Bearer session-2']);
  });

  it('signs in again before a request once the session has run out', async () => {
    const server = fakeServer();
    server.lasting.seconds = 120;
    server.route.mockImplementation(() => json({ call: CALL }));
    const { api } = client(server);

    await api.join(ROOM_ID);
    vi.setSystemTime(NOW + 119_000);
    await api.join(ROOM_ID);

    expect(server.calls().map(bearer)).toEqual(['Bearer session-1', 'Bearer session-2']);
  });

  it('gives a sign-in without an answer up after 15 seconds, and signs in afresh next time', async () => {
    const server = fakeServer();
    server.route.mockImplementation(() => json({ call: CALL }));
    server.request.mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The request was aborted.', 'AbortError'))
          );
        })
    );
    const { api, getOpenIdToken } = client(server);

    let failure: unknown;
    const first = api.join(ROOM_ID).catch((error: unknown) => {
      failure = error;
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(failure).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(isUnavailable(failure)).toBe(true);

    await expect(api.join(ROOM_ID)).resolves.toEqual(CALL);
    expect(getOpenIdToken).toHaveBeenCalledTimes(2);
  });

  it('counts a homeserver that cannot give a token as unreachable, and one that will not bind it as no transcripts', async () => {
    const server = fakeServer();
    const unreachable = client(
      server,
      vi.fn(async () => {
        throw new ConnectionError('offline');
      })
    );
    const error = await unreachable.api.join(ROOM_ID).catch((reason: unknown) => reason);
    expect(isUnavailable(error)).toBe(true);
    expect(isNotTranscribed(error)).toBe(false);

    const unbound = client(
      server,
      vi.fn(async () => {
        throw new Error('The homeserver does not bind sign-in tokens');
      })
    );
    const refused = await unbound.api.join(ROOM_ID).catch((reason: unknown) => reason);
    expect(isNotTranscribed(refused)).toBe(true);
    expect(server.calls()).toEqual([]);
  });

  it('counts a refused sign-in as no transcripts for this room', async () => {
    const server = fakeServer();
    server.request.mockImplementationOnce(async () => json({ detail: 'not bound' }, 403));
    const { api } = client(server);

    const error = await api.join(ROOM_ID).catch((reason: unknown) => reason);

    expect(isNotTranscribed(error)).toBe(true);
    expect(server.calls()).toEqual([]);
  });
});

describe('TranscriptionClient routes', () => {
  it('joins the room the call is in, and leaves the call by its id', async () => {
    const server = fakeServer();
    server.route.mockImplementation((url) =>
      url.endsWith('calls.join') ? json({ call: CALL }) : json({})
    );
    const { api } = client(server);

    await api.join(ROOM_ID);
    await api.leave('call/1');

    expect(server.calls().map(({ url, init }) => `${init.method} ${url}`)).toEqual([
      `POST ${API_URL}/api/call-transcripts/v1/rooms/!room%3Aexample.org/calls.join`,
      `POST ${API_URL}/api/call-transcripts/v1/calls/call%2F1/leave`,
    ]);
  });

  it('sends a stretch as a multipart WAV file with when it started', async () => {
    const server = fakeServer();
    server.route.mockImplementation(() => json({ line: LINE }));
    const { api } = client(server);
    const wav = new Blob([new Uint8Array(44)], { type: 'audio/wav' });
    const startedAt = new Date(Date.UTC(2026, 10, 7, 9, 29, 30, 250));

    await expect(api.speech('call-1', { wav, startedAt })).resolves.toEqual(LINE);

    const [upload] = server.calls();
    expect(upload?.url).toBe(`${API_URL}/api/call-transcripts/v1/calls/call-1/speech`);
    expect(upload?.init.method).toBe('POST');
    const form = upload?.init.body as FormData;
    expect(form.get('startedAt')).toBe('2026-11-07T09:29:30.250Z');
    const audio = form.get('audio') as File;
    expect(audio.type).toBe('audio/wav');
    expect(audio.size).toBe(44);
  });

  it('pauses and resumes the call, and reads the live call after a line', async () => {
    const server = fakeServer();
    const live = { call: CALL, lines: [LINE], names: { '@ann:example.org': 'Ann' } };
    server.route.mockImplementation((url) =>
      url.includes('calls.live')
        ? json(live)
        : json({ call: { ...CALL, pausedBy: '@ann:example.org' } })
    );
    const { api } = client(server);

    await expect(api.pause('call-1', true)).resolves.toMatchObject({
      pausedBy: '@ann:example.org',
    });
    await api.pause('call-1', false);
    await expect(api.live(ROOM_ID)).resolves.toEqual(live);
    await api.live(ROOM_ID, 'line 1');

    const [pause, resume, read, readAfter] = server.calls();
    expect(pause?.url).toBe(`${API_URL}/api/call-transcripts/v1/calls/call-1/pause`);
    expect(pause?.init.method).toBe('POST');
    expect(JSON.parse(String(pause?.init.body))).toEqual({ paused: true });
    expect(JSON.parse(String(resume?.init.body))).toEqual({ paused: false });
    expect(new Headers(pause?.init.headers).get('Content-Type')).toBe('application/json');
    expect(read?.init.method).toBe('GET');
    expect(read?.url).toBe(
      `${API_URL}/api/call-transcripts/v1/rooms/!room%3Aexample.org/calls.live`
    );
    expect(readAfter?.url).toBe(
      `${API_URL}/api/call-transcripts/v1/rooms/!room%3Aexample.org/calls.live?after=line%201`
    );
  });
});

describe('TranscriptionClient refusals', () => {
  it('carries the status, the code and when to try again', async () => {
    const server = fakeServer();
    server.route.mockImplementation(() =>
      json({ error: 'Slow down.', code: 'too-many-requests' }, 429, { 'Retry-After': '3' })
    );
    const { api } = client(server);

    const error = await api.join(ROOM_ID).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TranscriptionApiError);
    expect(error).toMatchObject({
      status: 429,
      code: 'too-many-requests',
      retryAfterMs: 3000,
      message: 'Slow down.',
    });
    expect(isUnavailable(error)).toBe(false);
  });

  it('reads Retry-After as a date too', async () => {
    const server = fakeServer();
    server.route.mockImplementation(() =>
      json({ error: 'Later.', code: 'too-many-requests' }, 429, {
        'Retry-After': new Date(NOW + 7000).toUTCString(),
      })
    );
    const { api } = client(server);

    await expect(api.join(ROOM_ID)).rejects.toMatchObject({ retryAfterMs: 7000 });
  });

  it('counts no answer and server errors as unavailable, 403 and 404 as no transcripts', async () => {
    const server = fakeServer();
    const { api } = client(server);
    const outcome = async (answer: () => Response | Promise<Response>) => {
      server.route.mockImplementationOnce(answer);
      const error = await api.join(ROOM_ID).catch((reason: unknown) => reason);
      return { unavailable: isUnavailable(error), notTranscribed: isNotTranscribed(error) };
    };

    await expect(
      outcome(() => {
        throw new TypeError('Failed to fetch');
      })
    ).resolves.toEqual({ unavailable: true, notTranscribed: false });
    await expect(outcome(() => new Response('Bad gateway', { status: 502 }))).resolves.toEqual({
      unavailable: true,
      notTranscribed: false,
    });
    await expect(outcome(() => json({ error: 'No.', code: 'not-found' }, 404))).resolves.toEqual({
      unavailable: false,
      notTranscribed: true,
    });
    await expect(outcome(() => json({ error: 'No.', code: 'forbidden' }, 403))).resolves.toEqual({
      unavailable: false,
      notTranscribed: true,
    });
  });
});
