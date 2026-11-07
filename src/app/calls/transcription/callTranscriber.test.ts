import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IOpenIDToken } from 'matrix-js-sdk';
import { CallTranscriber, type TranscriberStatus } from './callTranscriber';
import type { CallEvent, TranscriptCall, TranscriptLine } from './api';
import type { SpeechCapture, SpeechStretch } from './speechCapture';
import { defined } from '../../../test/utils/defined';

const API_URL = 'https://mindroom.example.org';
const ROOM_ID = '!room:example.org';
const OTHER_ROOM_ID = '!other:example.org';
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
  holds: [],
  transcribedBy: ['@ann:example.org'],
};

const LINE: TranscriptLine = {
  id: 'line-1',
  callId: 'call-1',
  userId: '@ann:example.org',
  saidAt: '2026-11-07T09:29:30Z',
  seconds: 1,
  kind: 'speech',
  text: 'Hello',
};

const MIC_A = { id: 'mic-a', kind: 'audio' } as MediaStreamTrack;
const MIC_B = { id: 'mic-b', kind: 'audio' } as MediaStreamTrack;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const serverError = () => new Response('Bad gateway', { status: 502 });

/** A request that never gets an answer, until its signal gives up on it. */
const unanswered = (init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () =>
      reject(new DOMException('The request was aborted.', 'AbortError'))
    );
  });

/** A stretch said `second` seconds after NOW; the server log names it by that number. */
const stretch = (second: number): SpeechStretch => ({
  wav: new Blob([new Uint8Array(44)], { type: 'audio/wav' }),
  startedAt: new Date(NOW + second * 1000),
  seconds: 1,
});

const pending = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

/** A server-sent-events body the test writes into, which ends with the request's signal. */
const eventStream = (signal: AbortSignal | null | undefined) => {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });
  const stream = {
    aborted: false,
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    send: (event: string, data: unknown) =>
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
    close: () => controller.close(),
  };
  signal?.addEventListener('abort', () => {
    stream.aborted = true;
    try {
      controller.error(new DOMException('The request was aborted.', 'AbortError'));
    } catch {
      // Already closed.
    }
  });
  return stream;
};

type FakeCapture = SpeechCapture & {
  track: MediaStreamTrack;
  onStretch: (stretch: SpeechStretch) => void;
  paused: boolean;
  stopped: boolean;
  /** What the worklet still holds; stopping hands it on. */
  inProgress?: SpeechStretch;
};

const transcribers: CallTranscriber[] = [];

/**
 * A transcriber with a fake MindRoom server and a fake microphone capture. `log` records, in
 * order, the requests to the call routes (`calls.join`, `speech <second>`, `leave`,
 * `calls.events`) and the capture's steps (`listen <track>`, `stop <track>`).
 */
const setup = ({ roomId = ROOM_ID }: { roomId?: string } = {}) => {
  const log: string[] = [];
  const streams: Array<ReturnType<typeof eventStream>> = [];
  const server = {
    session: vi.fn((): Response | Promise<Response> =>
      json({
        session_token: 'session',
        user_id: '@ann:example.org',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      })
    ),
    join: vi.fn((_init: RequestInit): Response | Promise<Response> => json({ call: CALL })),
    speech: vi.fn((_init: RequestInit): Response | Promise<Response> => json({ line: LINE })),
    leave: vi.fn((_init: RequestInit): Response | Promise<Response> => json({})),
    pause: vi.fn((init: RequestInit): Response | Promise<Response> => {
      const { holding } = JSON.parse(String(init.body)) as { holding: boolean };
      return json({ call: { ...CALL, holds: holding ? ['@ann:example.org'] : [] } });
    }),
    events: vi.fn((init: RequestInit): Response | Promise<Response> => {
      const stream = eventStream(init.signal);
      streams.push(stream);
      return stream.response;
    }),
  };
  const urls: string[] = [];
  /** What each Pause request was sent with. */
  const pauses: RequestInit[] = [];
  const request = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url === `${API_URL}/api/client-sessions`) return server.session();
    urls.push(url);
    const route = url.slice(url.lastIndexOf('/') + 1);
    if (route === 'speech') {
      const startedAt = (init.body as FormData).get('startedAt');
      log.push(`speech ${(Date.parse(String(startedAt)) - NOW) / 1000}`);
      return server.speech(init);
    }
    if (route === 'pause') {
      const { holding } = JSON.parse(String(init.body)) as { holding: boolean };
      log.push(`pause ${holding}`);
      pauses.push(init);
      return server.pause(init);
    }
    log.push(route);
    if (route === 'calls.join') return server.join(init);
    if (route === 'leave') return server.leave(init);
    if (route === 'calls.events') return server.events(init);
    throw new Error(`unexpected request ${url}`);
  });
  const captures: FakeCapture[] = [];
  const startCapture = vi.fn(
    async (track: MediaStreamTrack, onStretch: (stretch: SpeechStretch) => void) => {
      log.push(`listen ${track.id}`);
      const capture: FakeCapture = {
        track,
        onStretch,
        paused: false,
        stopped: false,
        setPaused: vi.fn((paused: boolean) => {
          capture.paused = paused;
        }),
        stop: vi.fn(async () => {
          log.push(`stop ${track.id}`);
          capture.stopped = true;
          if (capture.inProgress) onStretch(capture.inProgress);
        }),
      };
      captures.push(capture);
      return capture;
    }
  );
  const statuses: TranscriberStatus[] = [];
  const events: CallEvent[] = [];
  const onHoldRefused = vi.fn();
  const transcriber = new CallTranscriber({
    roomId,
    userId: '@ann:example.org',
    apiUrl: API_URL,
    getOpenIdToken: async () => TOKEN,
    request,
    startCapture,
    onStatus: (status) => statuses.push(status),
    onEvent: (event) => events.push(event),
    onHoldRefused,
  });
  transcribers.push(transcriber);
  const capture = (index = 0) => defined(captures[index], `capture ${index}`);
  const speeches = () => log.filter((entry) => entry.startsWith('speech'));
  /** The log without the stream's connections, which run beside everything else. */
  const steps = () => log.filter((entry) => entry !== 'calls.events');
  const joins = () => log.filter((entry) => entry === 'calls.join').length;
  const holds = () => log.filter((entry) => entry.startsWith('pause'));
  return {
    transcriber,
    server,
    log,
    urls,
    pauses,
    holds,
    onHoldRefused,
    streams,
    captures,
    capture,
    startCapture,
    statuses,
    events,
    speeches,
    steps,
    joins,
  };
};

/** Lets every step that is due run, after `ms` of fake time. */
const advance = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  // Every transcriber leaves, so no room waits for a leave from an earlier test.
  const ending = Promise.all(transcribers.splice(0).map((transcriber) => transcriber.end()));
  await advance(120_000);
  await ending;
  vi.useRealTimers();
});

describe('CallTranscriber joining', () => {
  it('joins at once, checks in every 20 seconds, and follows the live call once answered', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();

    expect(t.log).toEqual(['calls.join', 'calls.events']);
    expect(t.urls[0]).toBe(
      `${API_URL}/api/call-transcripts/v1/rooms/!room%3Aexample.org/calls.join`
    );
    expect(t.statuses).toEqual(['transcribing']);

    await advance(19_999);
    expect(t.joins()).toBe(1);
    await advance(1);
    expect(t.joins()).toBe(2);
    await advance(20_000);
    expect(t.joins()).toBe(3);
  });

  it.each([
    ['the server answered with an error', serverError],
    [
      'the server could not be reached',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])(
    'stays silent while no join has answered yet (%s), keeps checking in, and the first answer starts transcribing',
    async (_case, failure) => {
      const t = setup();
      // A server from before this feature: its cross-origin rules refuse these routes for good.
      t.server.join
        .mockImplementationOnce(failure)
        .mockImplementationOnce(failure)
        .mockImplementationOnce(failure);
      t.transcriber.setMicrophone(MIC_A);
      t.transcriber.start();
      await advance(40_000);

      expect(t.joins()).toBe(3);
      expect(t.statuses).toEqual([]);
      expect(t.startCapture).not.toHaveBeenCalled();
      expect(t.streams).toHaveLength(0);

      await advance(20_000);
      expect(t.statuses).toEqual(['transcribing']);
      expect(t.steps()).toEqual([
        'calls.join',
        'calls.join',
        'calls.join',
        'calls.join',
        'listen mic-a',
      ]);
      expect(t.streams).toHaveLength(1);
    }
  );

  it('retries a join refused as too many after Retry-After, silently', async () => {
    const t = setup();
    const tooMany = (seconds: string) => () =>
      json({ error: 'Slow down.', code: 'too-many-requests' }, 429, { 'Retry-After': seconds });
    t.server.join.mockImplementationOnce(tooMany('5'));
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance(4_999);
    expect(t.joins()).toBe(1);
    expect(t.statuses).toEqual([]);
    await advance(1);
    expect(t.joins()).toBe(2);
    expect(t.statuses).toEqual(['transcribing']);

    // Refused during the call, it stays transcribing, and no check-in goes before Retry-After.
    t.server.join.mockImplementationOnce(tooMany('30'));
    // The check-in at 20 s is refused; the one due at 40 s waits for the retry at 50 s.
    await advance(20_000);
    expect(t.joins()).toBe(3);
    await advance(24_999);
    expect(t.joins()).toBe(3);
    await advance(1);
    expect(t.joins()).toBe(4);
    expect(t.statuses).toEqual(['transcribing']);
    expect(t.capture().stopped).toBe(false);
  });

  it('does not check in again while the last check-in is still on its way', async () => {
    const t = setup();
    const slow = pending<Response>();
    t.server.join.mockImplementationOnce(() => slow.promise);
    t.transcriber.start();
    await advance(20_000);
    expect(t.joins()).toBe(1);

    slow.resolve(json({ call: CALL }));
    await advance(20_000);
    expect(t.joins()).toBe(2);
  });
});

describe('CallTranscriber in a room MindRoom does not transcribe', () => {
  it.each([404, 403])(
    'stays silent after a %s to the join, and sends nothing more',
    async (status) => {
      const t = setup();
      t.server.join.mockImplementation(() =>
        json({ error: 'Not here.', code: status === 404 ? 'not-found' : 'forbidden' }, status)
      );
      t.transcriber.setMicrophone(MIC_A);
      t.transcriber.start();
      await advance(60_000);

      expect(t.statuses).toEqual(['off']);
      expect(t.log).toEqual(['calls.join']);
      expect(t.startCapture).not.toHaveBeenCalled();

      await t.transcriber.end();
      expect(t.log).toEqual(['calls.join']);
    }
  );

  it('stops everything when MindRoom stops transcribing the room during the call', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    t.server.join.mockImplementation(() => json({ error: 'Not here.', code: 'not-found' }, 404));

    await advance(20_000);
    expect(t.statuses).toEqual(['transcribing', 'off']);
    expect(t.capture().stopped).toBe(true);
    expect(defined(t.streams[0], 'the stream').aborted).toBe(true);
    t.capture().onStretch(stretch(1));
    await advance(60_000);
    expect(t.joins()).toBe(2);
    expect(t.speeches()).toEqual([]);
    expect(t.streams).toHaveLength(1);

    await t.transcriber.end();
    expect(t.log).not.toContain('leave');
  });

  it("stops everything when the room's stream says it is not transcribed", async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    t.server.events.mockImplementationOnce(() =>
      json({ error: 'Not here.', code: 'not-found' }, 404)
    );
    await advance(60_000);

    expect(t.statuses).toEqual(['transcribing', 'off']);
    expect(t.capture().stopped).toBe(true);
    expect(t.joins()).toBe(1);
    expect(t.server.events).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the server refuses the sign-in', async () => {
    const t = setup();
    t.server.session.mockImplementation(() => json({ detail: 'not bound' }, 403));
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance(60_000);

    expect(t.statuses).toEqual(['off']);
    expect(t.log).toEqual([]);
    expect(t.server.session).toHaveBeenCalledTimes(1);
  });
});

describe('CallTranscriber uploads', () => {
  it('sends each stretch to the joined call, one at a time, and hands on its line', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    const first = pending<Response>();
    t.server.speech.mockImplementationOnce(() => first.promise);

    t.capture().onStretch(stretch(1));
    t.capture().onStretch(stretch(2));
    await advance();
    expect(t.speeches()).toEqual(['speech 1']);
    expect(t.urls).toContain(`${API_URL}/api/call-transcripts/v1/calls/call-1/speech`);

    first.resolve(json({ line: LINE }));
    await advance();
    expect(t.speeches()).toEqual(['speech 1', 'speech 2']);
    expect(t.events).toContainEqual({ type: 'line', line: LINE });
  });

  it('hands on no line for a stretch in which MindRoom heard no words', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    t.server.speech.mockImplementationOnce(() => json({ line: null }));

    t.capture().onStretch(stretch(1));
    t.capture().onStretch(stretch(2));
    await advance();
    expect(t.speeches()).toEqual(['speech 1', 'speech 2']);
    expect(t.events.filter((event) => event.type === 'line')).toEqual([
      { type: 'line', line: LINE },
    ]);
    expect(t.statuses).toEqual(['transcribing']);
  });

  it('retries a stretch refused as too many once, after Retry-After, waiting at most 10 seconds', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    const tooMany = (seconds: string) => () =>
      json({ error: 'Slow down.', code: 'too-many-requests' }, 429, { 'Retry-After': seconds });

    t.server.speech.mockImplementationOnce(tooMany('3'));
    t.capture().onStretch(stretch(1));
    await advance(2_999);
    expect(t.speeches()).toEqual(['speech 1']);
    await advance(1);
    expect(t.speeches()).toEqual(['speech 1', 'speech 1']);

    // Refused twice, the stretch is dropped and the next one goes.
    t.server.speech.mockImplementationOnce(tooMany('60')).mockImplementationOnce(tooMany('60'));
    t.capture().onStretch(stretch(2));
    t.capture().onStretch(stretch(3));
    await advance(9_999);
    expect(t.speeches()).toEqual(['speech 1', 'speech 1', 'speech 2']);
    await advance(1);
    expect(t.speeches()).toEqual(['speech 1', 'speech 1', 'speech 2', 'speech 2', 'speech 3']);
    expect(t.statuses).toEqual(['transcribing']);
  });

  it('gives an upload up after 30 seconds, and the next one goes', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    t.server.speech.mockImplementationOnce(unanswered);

    t.capture().onStretch(stretch(1));
    t.capture().onStretch(stretch(2));
    await advance(29_999);
    expect(t.speeches()).toEqual(['speech 1']);
    await advance(1);
    expect(t.speeches()).toEqual(['speech 1', 'speech 2']);
    expect(t.statuses).toEqual(['transcribing']);
  });

  it.each([
    [403, 'forbidden'],
    [404, 'not-found'],
  ])(
    'checks in at once after a %s to a stretch, and goes on with the call it answers',
    async (status, code) => {
      const t = setup();
      t.transcriber.setMicrophone(MIC_A);
      t.transcriber.start();
      await advance();
      t.server.speech.mockImplementationOnce(() =>
        json({ error: 'Not in the call.', code }, status)
      );
      t.server.join.mockImplementationOnce(() => json({ call: { ...CALL, id: 'call-2' } }));

      t.capture().onStretch(stretch(1));
      await advance();
      expect(t.joins()).toBe(2);

      t.capture().onStretch(stretch(2));
      await advance();
      expect(t.urls.at(-1)).toBe(`${API_URL}/api/call-transcripts/v1/calls/call-2/speech`);
      expect(t.statuses).toEqual(['transcribing']);
    }
  );
});

describe('CallTranscriber when MindRoom is unavailable', () => {
  it('stops listening and sending, and the first answered check-in resumes', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    t.server.speech.mockImplementationOnce(serverError);

    t.capture().onStretch(stretch(1));
    t.capture().onStretch(stretch(2));
    await advance();
    expect(t.statuses).toEqual(['transcribing', 'unavailable']);
    expect(t.speeches()).toEqual(['speech 1']);
    expect(t.capture().stopped).toBe(true);
    // What the stopped capture still hands on is not sent either.
    t.capture().onStretch(stretch(3));
    await advance();
    expect(t.speeches()).toEqual(['speech 1']);

    t.server.join.mockImplementationOnce(serverError);
    await advance(20_000);
    expect(t.statuses).toEqual(['transcribing', 'unavailable']);
    expect(t.captures).toHaveLength(1);

    await advance(20_000);
    expect(t.statuses).toEqual(['transcribing', 'unavailable', 'transcribing']);
    expect(t.capture(1).track).toBe(MIC_A);
    t.capture(1).onStretch(stretch(4));
    await advance();
    expect(t.speeches()).toEqual(['speech 1', 'speech 4']);
  });

  it('turns unavailable when a check-in gets no answer', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    t.server.join.mockImplementationOnce(unanswered);

    await advance(20_000);
    expect(t.statuses).toEqual(['transcribing']);
    await advance(15_000);
    expect(t.statuses).toEqual(['transcribing', 'unavailable']);
    expect(t.capture().stopped).toBe(true);
  });
});

describe('CallTranscriber microphone', () => {
  it('listens only while there is a microphone, and follows a switched one', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    // Muted: nothing to listen to.
    expect(t.startCapture).not.toHaveBeenCalled();

    t.transcriber.setMicrophone(MIC_A);
    await advance();
    expect(t.capture().track).toBe(MIC_A);

    // Switched: the stretch in progress on the old microphone still goes.
    t.capture().inProgress = stretch(1);
    t.transcriber.setMicrophone(MIC_B);
    await advance();
    expect(t.steps().slice(1, 3)).toEqual(['listen mic-a', 'stop mic-a']);
    expect([...t.steps().slice(3)].sort()).toEqual(['listen mic-b', 'speech 1']);
    expect(t.capture(1).track).toBe(MIC_B);

    // Muted again: listening stops, and nothing is sent.
    t.transcriber.setMicrophone(undefined);
    await advance();
    expect(t.capture(1).stopped).toBe(true);
    expect(t.captures).toHaveLength(2);

    t.transcriber.setMicrophone(MIC_B);
    await advance();
    expect(t.capture(2).track).toBe(MIC_B);
  });

  it('pauses listening at once, and a capture that starts later starts paused', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();

    t.transcriber.setPaused(true);
    expect(t.capture().paused).toBe(true);

    t.transcriber.setMicrophone(MIC_B);
    await advance();
    expect(t.capture(1).paused).toBe(true);

    t.transcriber.setPaused(false);
    expect(t.capture(1).paused).toBe(false);
  });

  it('tries again with the next microphone when listening could not start', async () => {
    const t = setup();
    t.startCapture.mockRejectedValueOnce(new Error('worklet blocked'));
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    expect(t.captures).toHaveLength(0);

    t.transcriber.setMicrophone(MIC_B);
    await advance();
    expect(t.capture().track).toBe(MIC_B);
  });
});

describe('CallTranscriber live events', () => {
  it('hands on the live events, and reconnects with backoff while in the call', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    const ready = { call: CALL, lines: [], names: { '@ann:example.org': 'Ann' } };
    defined(t.streams[0], 'the stream').send('ready', ready);
    await advance();
    expect(t.events).toEqual([{ type: 'ready', live: ready }]);

    // Dropped after it was ready: back after a second.
    defined(t.streams[0], 'the stream').close();
    await advance(999);
    expect(t.streams).toHaveLength(1);
    await advance(1);
    expect(t.streams).toHaveLength(2);

    // Failing without getting ready, it waits twice as long each time.
    t.server.events.mockImplementationOnce(serverError);
    defined(t.streams[1], 'the second stream').close();
    await advance(1_999);
    expect(t.server.events).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(t.server.events).toHaveBeenCalledTimes(3);
    await advance(3_999);
    expect(t.server.events).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(t.streams).toHaveLength(3);

    // Ready again, it starts over at a second.
    defined(t.streams[2], 'the third stream').send('ready', ready);
    defined(t.streams[2], 'the third stream').close();
    await advance(1_000);
    expect(t.streams).toHaveLength(4);

    await t.transcriber.end();
    expect(defined(t.streams[3], 'the fourth stream').aborted).toBe(true);
    await advance(60_000);
    expect(t.server.events).toHaveBeenCalledTimes(5);
  });

  it('checks in at once when the server ends the call this device is in', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();

    defined(t.streams[0], 'the stream').send('ended', { callId: 'call-1' });
    await advance();
    expect(t.joins()).toBe(2);

    defined(t.streams[0], 'the stream').send('ended', { callId: 'call-0' });
    await advance();
    expect(t.joins()).toBe(2);
  });
});

describe('CallTranscriber Pause', () => {
  const ANN = '@ann:example.org';
  const held = { ...CALL, holds: [ANN] };
  const refused = () => json({ error: 'You are not in this call.', code: 'not-found' }, 404);

  it('takes and lets go of the hold on the joined call, sent to outlast the page, and hands on each answer', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();

    t.transcriber.setHolding(true);
    await advance();
    t.transcriber.setHolding(false);
    await advance();

    expect(t.holds()).toEqual(['pause true', 'pause false']);
    expect(t.urls).toContain(`${API_URL}/api/call-transcripts/v1/calls/call-1/pause`);
    // A release on the page going away must still reach MindRoom.
    expect(t.pauses.map((init) => init.keepalive)).toEqual([true, true]);
    expect(t.events).toEqual([
      { type: 'call', call: held },
      { type: 'call', call: CALL },
    ]);
    expect(t.onHoldRefused).not.toHaveBeenCalled();
  });

  it('never hands on the holds a check-in answers with', async () => {
    const t = setup();
    t.server.join.mockImplementation(() => json({ call: held }));
    t.transcriber.start();
    await advance(40_000);
    expect(t.joins()).toBe(3);
    expect(t.events).toEqual([]);
  });

  it('reports a refused hold, and sends nothing more for it', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    t.server.pause.mockImplementationOnce(refused);

    t.transcriber.setHolding(true);
    await advance(60_000);
    expect(t.onHoldRefused).toHaveBeenCalledTimes(1);
    expect(t.holds()).toEqual(['pause true']);
    expect(t.events).toEqual([]);
  });

  it('refuses a hold at once while no join has answered', async () => {
    const t = setup();
    t.server.join.mockImplementation(serverError);
    t.transcriber.start();
    await advance();

    t.transcriber.setHolding(true);
    await advance();
    expect(t.onHoldRefused).toHaveBeenCalledTimes(1);
    expect(t.holds()).toEqual([]);
  });

  it('tries a refused release again until MindRoom no longer lists the hold', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    t.transcriber.setHolding(true);
    await advance();
    t.server.pause.mockImplementation(serverError);

    t.transcriber.setHolding(false);
    await advance();
    expect(t.holds()).toEqual(['pause true', 'pause false']);
    await advance(1_000);
    expect(t.holds()).toHaveLength(3);
    await advance(2_000);
    expect(t.holds()).toHaveLength(4);

    // The stream no longer lists the hold (the server let it go after all): no more tries.
    defined(t.streams[0], 'the stream').send('call', CALL);
    await advance(60_000);
    expect(t.holds()).toHaveLength(4);
    expect(t.onHoldRefused).not.toHaveBeenCalled();
  });

  it("never lets go of a hold another of this person's devices took", async () => {
    const phone = setup();
    const laptop = setup();
    phone.transcriber.start();
    laptop.transcriber.start();
    await advance();

    phone.transcriber.setHolding(true);
    await advance();
    // Holds are per person: the laptop hears Ann holds Pause, which her phone took.
    defined(laptop.streams[0], 'the stream').send('call', held);
    await advance(60_000);
    expect(laptop.holds()).toEqual([]);

    phone.transcriber.setHolding(false);
    await advance();
    expect(phone.holds()).toEqual(['pause true', 'pause false']);
  });

  it('lets go again of a hold it took that MindRoom answered after the release', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    const hold = pending<Response>();
    t.server.pause.mockImplementationOnce(() => hold.promise);

    t.transcriber.setHolding(true);
    await advance();
    t.transcriber.setHolding(false);
    await advance();
    expect(t.holds()).toEqual(['pause true', 'pause false']);

    // The hold went through after the release: it is this device's to let go of.
    hold.resolve(json({ call: held }));
    await advance();
    expect(t.holds()).toEqual(['pause true', 'pause false', 'pause false']);
  });

  it.each([
    [
      'never came',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
    ['was a server error', serverError],
  ])('lets go of a hold whose answer %s, as MindRoom may have taken it', async (_case, failure) => {
    const t = setup();
    t.transcriber.start();
    await advance();
    t.server.pause.mockImplementationOnce(failure);

    t.transcriber.setHolding(true);
    await advance();
    expect(t.onHoldRefused).toHaveBeenCalledTimes(1);
    expect(t.holds()).toEqual(['pause true', 'pause false']);
  });

  it('gives a hold without an answer up after 15 seconds, and lets go of it, as MindRoom may have taken it', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    t.server.pause.mockImplementationOnce(unanswered);

    t.transcriber.setHolding(true);
    await advance(14_999);
    expect(t.onHoldRefused).not.toHaveBeenCalled();
    expect(t.holds()).toEqual(['pause true']);
    await advance(1);
    expect(t.onHoldRefused).toHaveBeenCalledTimes(1);
    expect(t.holds()).toEqual(['pause true', 'pause false']);
  });

  it('gives a release without an answer up after 15 seconds, and tries again', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    t.transcriber.setHolding(true);
    await advance();
    t.server.pause.mockImplementationOnce(unanswered);

    t.transcriber.setHolding(false);
    await advance(14_999);
    expect(t.holds()).toEqual(['pause true', 'pause false']);
    await advance(1_001);
    expect(t.holds()).toEqual(['pause true', 'pause false', 'pause false']);
    expect(t.events.at(-1)).toEqual({ type: 'call', call: CALL });

    // The hung release no longer holds up the next hold and its release.
    t.transcriber.setHolding(true);
    await advance();
    t.transcriber.setHolding(false);
    await advance();
    expect(t.holds()).toEqual([
      'pause true',
      'pause false',
      'pause false',
      'pause true',
      'pause false',
    ]);
  });

  it('owes the release of a later hold when an earlier release answers last', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    t.transcriber.setHolding(true);
    await advance();
    const release = pending<Response>();
    t.server.pause.mockImplementationOnce(() => release.promise);

    t.transcriber.setHolding(false);
    await advance();
    t.transcriber.setHolding(true);
    await advance();
    t.transcriber.setHolding(false);
    await advance();
    expect(t.holds()).toEqual(['pause true', 'pause false', 'pause true']);

    // The first release answers last, without the hold: the second hold is still this device's.
    release.resolve(json({ call: CALL }));
    await advance();
    expect(t.holds()).toEqual(['pause true', 'pause false', 'pause true', 'pause false']);
  });

  it('lets go of its later hold once the stream lists it, after an earlier release answered last', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    t.transcriber.setHolding(true);
    await advance();
    const release = pending<Response>();
    t.server.pause.mockImplementationOnce(() => release.promise);
    t.transcriber.setHolding(false);
    await advance();
    t.transcriber.setHolding(true);
    await advance();
    t.transcriber.setHolding(false);
    await advance();

    // The first release answers last, without the hold, and the next one fails.
    t.server.pause.mockImplementationOnce(serverError);
    release.resolve(json({ call: CALL }));
    await advance();
    expect(t.holds()).toEqual(['pause true', 'pause false', 'pause true', 'pause false']);

    // The stream then lists the hold: still this device's to let go of.
    defined(t.streams[0], 'the stream').send('call', held);
    await advance();
    expect(t.holds()).toEqual([
      'pause true',
      'pause false',
      'pause true',
      'pause false',
      'pause false',
    ]);
  });

  it('takes the hold again when a release answers after Pause was pressed again', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    t.transcriber.setHolding(true);
    await advance();
    const release = pending<Response>();
    t.server.pause.mockImplementationOnce(() => release.promise);

    t.transcriber.setHolding(false);
    await advance();
    t.transcriber.setHolding(true);
    await advance();
    // MindRoom let go after taking the second hold: still pressed here, it is taken again.
    release.resolve(json({ call: CALL }));
    await advance();
    expect(t.holds()).toEqual(['pause true', 'pause false', 'pause true', 'pause true']);
    expect(t.onHoldRefused).not.toHaveBeenCalled();
  });

  it('stops trying to let go once the call ends here, as leaving lets go', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    t.transcriber.setHolding(true);
    await advance();
    t.server.pause.mockImplementation(serverError);
    t.transcriber.setHolding(false);
    await advance();

    await t.transcriber.end();
    await advance(60_000);
    expect(t.holds()).toEqual(['pause true', 'pause false']);
    expect(t.log.at(-1)).toBe('leave');
  });
});

describe('CallTranscriber ending', () => {
  it('stops listening, lets the queued uploads finish, then leaves', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    const upload = pending<Response>();
    t.server.speech.mockImplementationOnce(() => upload.promise);
    t.capture().onStretch(stretch(1));
    t.capture().inProgress = stretch(2);
    await advance();

    let ended = false;
    const ending = t.transcriber.end().then(() => {
      ended = true;
    });
    await advance();
    expect(t.steps()).toEqual(['calls.join', 'listen mic-a', 'speech 1', 'stop mic-a']);
    expect(defined(t.streams[0], 'the stream').aborted).toBe(true);
    expect(ended).toBe(false);

    upload.resolve(json({ line: LINE }));
    await advance();
    expect(t.steps().slice(4)).toEqual(['speech 2', 'leave']);
    expect(t.urls.at(-1)).toBe(`${API_URL}/api/call-transcripts/v1/calls/call-1/leave`);
    await ending;
    expect(ended).toBe(true);

    // Nothing after the leave: no check-ins, no stream.
    await advance(60_000);
    expect(t.steps()).toHaveLength(6);
    expect(t.streams).toHaveLength(1);
  });

  it('stops listening at once, before a check-in on its way answers', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    const answer = pending<Response>();
    t.server.join.mockImplementationOnce(() => answer.promise);
    await advance(20_000);
    expect(t.joins()).toBe(2);

    const ending = t.transcriber.end();
    expect(t.capture().stop).toHaveBeenCalledTimes(1);
    await advance();
    expect(t.steps()).toEqual(['calls.join', 'listen mic-a', 'calls.join', 'stop mic-a']);

    answer.resolve(json({ call: CALL }));
    await ending;
    expect(t.steps().slice(4)).toEqual(['leave']);
    expect(t.captures).toHaveLength(1);
  });

  it('drops the rest of the queue once an upload gives up while leaving', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    t.server.speech.mockImplementation(unanswered);
    t.capture().onStretch(stretch(1));
    t.capture().onStretch(stretch(2));
    t.capture().inProgress = stretch(3);
    await advance();

    let ended = false;
    const ending = t.transcriber.end().then(() => {
      ended = true;
    });
    await advance(29_999);
    expect(ended).toBe(false);
    await advance(1);
    await ending;
    expect(t.speeches()).toEqual(['speech 1']);
    expect(t.steps().at(-1)).toBe('leave');
  });

  it('waits for a join on its way, so it knows which call to leave', async () => {
    const t = setup();
    const answer = pending<Response>();
    t.server.join.mockImplementationOnce(() => answer.promise);
    t.transcriber.start();
    await advance();

    const ending = t.transcriber.end();
    await advance();
    expect(t.log).toEqual(['calls.join']);

    answer.resolve(json({ call: CALL }));
    await ending;
    expect(t.log).toEqual(['calls.join', 'leave']);
  });

  it('makes a new join to the same room wait for the leave', async () => {
    const first = setup();
    first.transcriber.start();
    await advance();
    const leave = pending<Response>();
    first.server.leave.mockImplementationOnce(() => leave.promise);
    const firstEnding = first.transcriber.end();
    await advance();
    expect(first.log.at(-1)).toBe('leave');

    const second = setup();
    second.transcriber.start();
    const elsewhere = setup({ roomId: OTHER_ROOM_ID });
    elsewhere.transcriber.start();
    await advance();
    expect(second.log).toEqual([]);
    expect(elsewhere.joins()).toBe(1);

    leave.resolve(json({}));
    await firstEnding;
    await advance();
    expect(second.log[0]).toBe('calls.join');
  });

  it('gives a leave without an answer up after 15 seconds, and the next join goes', async () => {
    const first = setup();
    first.transcriber.start();
    await advance();
    first.server.leave.mockImplementationOnce(unanswered);
    const firstEnding = first.transcriber.end();

    const second = setup();
    second.transcriber.start();
    await advance(14_999);
    expect(second.joins()).toBe(0);
    await advance(1);
    await firstEnding;
    await advance();
    expect(second.joins()).toBe(1);
  });

  it('sends no leave when no join ever answered', async () => {
    const t = setup();
    t.server.join.mockImplementation(serverError);
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();

    await t.transcriber.end();
    // It never joined, so there is no call to leave.
    expect(t.log).toEqual(['calls.join']);
  });
});
