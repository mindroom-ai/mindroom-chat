import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IOpenIDToken } from 'matrix-js-sdk';
import { ClientSessions } from '../../computer/clientSessions';
import { CallTranscriber, type TranscriberStatus } from './callTranscriber';
import type { TranscriptCall, TranscriptLine } from './api';
import { startSpeechCapture, type SpeechCapture, type SpeechStretch } from './speechCapture';
import type { LiveUpdate } from './transcriptionState';
import { defined } from '../../../test/utils/defined';

// The speech model, which one test loads through the real capture: it never finishes loading.
vi.mock('@ricky0123/vad-web', () => ({
  MicVAD: { new: () => new Promise(() => undefined) },
  utils: {},
}));

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
  pausedBy: null,
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

type FakeCapture = SpeechCapture & {
  track: MediaStreamTrack;
  onStretch: (stretch: SpeechStretch) => void;
  paused: boolean;
  muted: boolean;
  stopped: boolean;
  /** What the capture still holds; stopping or muting hands it on. */
  inProgress?: SpeechStretch;
};

const transcribers: CallTranscriber[] = [];

/**
 * A transcriber with a fake MindRoom server and a fake microphone capture. `log` records, in
 * order, the requests to the call routes (`calls.join`, `speech <second>`, `pause <paused>`,
 * `leave`, `calls.live`) and the capture's steps (`listen <track>`, `stop <track>`).
 */
const setup = ({
  roomId = ROOM_ID,
  listen,
}: {
  roomId?: string;
  /** Listens with this in place of the fake capture. */
  listen?: typeof startSpeechCapture;
} = {}) => {
  const log: string[] = [];
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
      const { paused } = JSON.parse(String(init.body)) as { paused: boolean };
      return json({ call: { ...CALL, pausedBy: paused ? '@ann:example.org' : null } });
    }),
    live: vi.fn((_url: string): Response | Promise<Response> =>
      json({ call: CALL, lines: [], names: {} })
    ),
  };
  const urls: string[] = [];
  const request = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url === `${API_URL}/api/client-sessions` && init.method === 'DELETE') {
      log.push('revoke');
      return new Response(null, { status: 204 });
    }
    if (url === `${API_URL}/api/client-sessions`) return server.session();
    urls.push(url);
    const route = url.slice(url.lastIndexOf('/') + 1).replace(/\?.*/, '');
    if (route === 'speech') {
      const startedAt = (init.body as FormData).get('startedAt');
      log.push(`speech ${(Date.parse(String(startedAt)) - NOW) / 1000}`);
      return server.speech(init);
    }
    if (route === 'pause') {
      const { paused } = JSON.parse(String(init.body)) as { paused: boolean };
      log.push(`pause ${paused}`);
      return server.pause(init);
    }
    log.push(route);
    if (route === 'calls.join') return server.join(init);
    if (route === 'leave') return server.leave(init);
    if (route === 'calls.live') return server.live(url);
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
        muted: false,
        setPaused: vi.fn((paused: boolean) => {
          capture.paused = paused;
        }),
        // Told again what it is already, it does nothing.
        setMuted: vi.fn((muted: boolean) => {
          if (muted === capture.muted) return;
          log.push(`${muted ? 'mute' : 'unmute'} ${track.id}`);
          capture.muted = muted;
          if (muted && capture.inProgress) onStretch(capture.inProgress);
          capture.inProgress = undefined;
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
  const updates: LiveUpdate[] = [];
  const sessions = new ClientSessions({
    apiUrl: API_URL,
    getOpenIdToken: async () => TOKEN,
    request,
  });
  const transcriber = new CallTranscriber({
    roomId,
    sessions,
    startCapture: listen ?? startCapture,
    onStatus: (status) => statuses.push(status),
    onUpdate: (update) => updates.push(update),
  });
  transcribers.push(transcriber);
  const capture = (index = 0) => defined(captures[index], `capture ${index}`);
  const speeches = () => log.filter((entry) => entry.startsWith('speech'));
  /** The log without the reads of the live call, which run beside everything else. */
  const steps = () => log.filter((entry) => entry !== 'calls.live');
  const joins = () => log.filter((entry) => entry === 'calls.join').length;
  const reads = () => log.filter((entry) => entry === 'calls.live').length;
  const pauses = () => log.filter((entry) => entry.startsWith('pause'));
  return {
    transcriber,
    sessions,
    server,
    log,
    urls,
    pauses,
    captures,
    capture,
    startCapture,
    statuses,
    updates,
    speeches,
    steps,
    joins,
    reads,
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
  it('joins at once, checks in every 20 seconds, and reads the live call once answered', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();

    expect(t.log).toEqual(['calls.join', 'calls.live']);
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
      expect(t.reads()).toBe(0);

      await advance(20_000);
      expect(t.statuses).toEqual(['transcribing']);
      expect(t.steps()).toEqual([
        'calls.join',
        'calls.join',
        'calls.join',
        'calls.join',
        'listen mic-a',
      ]);
      expect(t.reads()).toBe(1);
    }
  );

  it("hands on the join's call, and starts listening paused when it says the call is paused", async () => {
    const t = setup();
    const paused = {
      ...CALL,
      members: ['@ann:example.org', '@bob:example.org'],
      pausedBy: '@bob:example.org',
    };
    t.server.join.mockImplementationOnce(() => json({ call: paused }));
    t.server.live.mockImplementation(() => json({ call: paused, lines: [], names: {} }));
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();

    expect(t.updates[0]).toEqual({ type: 'call', call: paused });
    expect(t.capture().paused).toBe(true);
  });

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
    const reads = t.reads();
    t.capture().onStretch(stretch(1));
    await advance(60_000);
    expect(t.joins()).toBe(2);
    expect(t.speeches()).toEqual([]);
    expect(t.reads()).toBe(reads);

    await t.transcriber.end();
    expect(t.log).not.toContain('leave');
  });

  it('stops everything when a read of the live call says the room is not transcribed', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    t.server.live.mockImplementationOnce(() =>
      json({ error: 'Not here.', code: 'not-found' }, 404)
    );
    await advance(60_000);

    expect(t.statuses).toEqual(['transcribing', 'off']);
    expect(t.capture().stopped).toBe(true);
    expect(t.joins()).toBe(1);
    expect(t.reads()).toBe(1);
  });

  it.each([
    ['a failed Pause request', 'pause', serverError],
    ['a failed check-in', 'join', serverError],
    [
      'an answered Pause request',
      'pause',
      () => json({ call: { ...CALL, pausedBy: '@ann:example.org' } }),
    ],
  ] as const)(
    'stays off, for good, when %s arrives after a read said the room is not transcribed',
    async (_case, route, late) => {
      const t = setup();
      t.transcriber.setMicrophone(MIC_A);
      t.transcriber.start();
      await advance();
      const answer = pending<Response>();
      t.server[route].mockImplementationOnce(() => answer.promise);
      if (route === 'pause') void t.transcriber.pause(true);
      else await advance(20_000);
      t.server.live.mockImplementationOnce(() =>
        json({ error: 'Not here.', code: 'not-found' }, 404)
      );
      await advance(2_000);
      expect(t.statuses).toEqual(['transcribing', 'off']);

      answer.resolve(late());
      await advance(60_000);
      expect(t.statuses).toEqual(['transcribing', 'off']);
      expect(t.updates.filter((update) => update.type === 'call')).toHaveLength(1);
    }
  );

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
    expect(t.updates).toContainEqual({ type: 'line', line: LINE });
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
    expect(t.updates.filter((update) => update.type === 'line')).toEqual([
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

  it.each([
    ['answers with an error', serverError],
    [
      'cannot be reached',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])(
    'turns unavailable when a read of the live call fails (%s), and the first answered check-in resumes',
    async (_case, failure) => {
      const t = setup();
      t.transcriber.setMicrophone(MIC_A);
      t.transcriber.start();
      await advance();
      t.server.live.mockImplementationOnce(failure);

      await advance(2_000);
      expect(t.statuses).toEqual(['transcribing', 'unavailable']);
      expect(t.capture().stopped).toBe(true);
      t.capture().onStretch(stretch(1));
      await advance();
      expect(t.speeches()).toEqual([]);

      // Reading goes on, and the next check-in resumes.
      await advance(2_000);
      expect(t.reads()).toBe(3);
      await advance(16_000);
      expect(t.statuses).toEqual(['transcribing', 'unavailable', 'transcribing']);
      expect(t.capture(1).track).toBe(MIC_A);
    }
  );

  it.each([
    ['answers with an error', serverError, 0],
    ['gets no answer', unanswered, 15_000],
  ])(
    'turns unavailable when a Pause request %s, and the first answered check-in resumes',
    async (_case, failure, wait) => {
      const t = setup();
      t.transcriber.setMicrophone(MIC_A);
      t.transcriber.start();
      await advance();
      t.server.pause.mockImplementationOnce(failure);

      const pausing = t.transcriber.pause(true);
      await advance(wait);
      await pausing;
      expect(t.statuses).toEqual(['transcribing', 'unavailable']);
      expect(t.capture().stopped).toBe(true);
      t.capture().onStretch(stretch(1));
      await advance();
      expect(t.speeches()).toEqual([]);

      await advance(20_000 - wait);
      expect(t.statuses).toEqual(['transcribing', 'unavailable', 'transcribing']);
      expect(t.capture(1).track).toBe(MIC_A);
    }
  );

  it('goes on with the later uploads and the leave when a callback throws during an upload', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    t.server.speech.mockImplementationOnce(serverError);
    const push = t.statuses.push.bind(t.statuses);
    t.statuses.push = () => {
      throw new Error('The view is gone.');
    };
    t.capture().onStretch(stretch(1));
    await advance();
    t.statuses.push = push;

    await advance(20_000);
    defined(t.captures.at(-1), 'a capture').onStretch(stretch(2));
    await advance();
    expect(t.speeches()).toEqual(['speech 1', 'speech 2']);
    await expect(t.transcriber.end()).resolves.toBeUndefined();
    expect(t.steps().at(-1)).toBe('leave');
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

    // Muted: listening waits, its model loaded, and the stretch in progress goes.
    t.capture(1).inProgress = stretch(2);
    t.transcriber.setMicrophone(undefined);
    await advance();
    expect(t.steps().slice(5)).toEqual(['mute mic-b', 'speech 2']);
    expect(t.capture(1).stopped).toBe(false);

    // Unmuted: the same capture listens again at once.
    t.transcriber.setMicrophone(MIC_B);
    await advance();
    expect(t.steps().slice(7)).toEqual(['unmute mic-b']);
    expect(t.captures).toHaveLength(2);

    // Unmuted with another microphone: that one gets a capture of its own.
    t.transcriber.setMicrophone(undefined);
    t.transcriber.setMicrophone(MIC_A);
    await advance();
    expect(t.steps().slice(8)).toEqual(['stop mic-b', 'listen mic-a']);
    expect(t.capture(2).track).toBe(MIC_A);
  });

  it('stops a muted capture when MindRoom becomes unavailable, and when the call ends here', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    t.transcriber.setMicrophone(undefined);
    await advance();
    expect(t.capture().muted).toBe(true);
    t.server.join.mockImplementationOnce(serverError);
    await advance(20_000);
    expect(t.statuses).toEqual(['transcribing', 'unavailable']);
    expect(t.capture().stopped).toBe(true);

    await advance(20_000);
    t.transcriber.setMicrophone(MIC_A);
    await advance();
    t.transcriber.setMicrophone(undefined);
    await advance();
    expect(t.capture(1).muted).toBe(true);
    await t.transcriber.end();
    expect(t.capture(1).stopped).toBe(true);
  });

  it('pauses listening at once for a request pressed here, and a capture that starts later starts paused', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();

    t.transcriber.setRequestPending(true);
    expect(t.capture().paused).toBe(true);

    t.transcriber.setMicrophone(MIC_B);
    await advance();
    expect(t.capture(1).paused).toBe(true);

    t.transcriber.setRequestPending(false);
    expect(t.capture(1).paused).toBe(false);
  });

  it('pauses listening while MindRoom says the call is paused, and resumes when it says so', async () => {
    const t = setup();
    const paused = { ...CALL, pausedBy: '@bob:example.org' };
    t.server.join.mockImplementationOnce(() => json({ call: paused }));
    t.server.live.mockImplementationOnce(() => json({ call: paused, lines: [], names: {} }));
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    expect(t.capture().paused).toBe(true);

    // The next read says the call resumed.
    await advance(2_000);
    expect(t.capture().paused).toBe(false);

    // A request pressed here keeps it paused until it is answered.
    t.transcriber.setRequestPending(true);
    await advance(2_000);
    expect(t.capture().paused).toBe(true);
  });

  it('tries again with the next microphone when listening could not start', async () => {
    const t = setup();
    t.startCapture.mockRejectedValueOnce(new Error('capture blocked'));
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    expect(t.captures).toHaveLength(0);

    t.transcriber.setMicrophone(MIC_B);
    await advance();
    expect(t.capture().track).toBe(MIC_B);
  });
});

describe('CallTranscriber live call', () => {
  it('hands on each read, asking for the lines after the last one read, until the call ends here', async () => {
    const t = setup();
    const live = { call: CALL, lines: [LINE], names: { '@ann:example.org': 'Ann' } };
    t.server.live.mockImplementationOnce(() => json(live));
    t.transcriber.start();
    await advance();
    expect(t.updates).toEqual([
      { type: 'call', call: CALL },
      { type: 'live', live },
    ]);
    expect(t.urls.at(-1)).toBe(
      `${API_URL}/api/call-transcripts/v1/rooms/!room%3Aexample.org/calls.live`
    );

    await advance(1_999);
    expect(t.reads()).toBe(1);
    await advance(1);
    expect(t.reads()).toBe(2);
    expect(t.urls.at(-1)).toBe(
      `${API_URL}/api/call-transcripts/v1/rooms/!room%3Aexample.org/calls.live?after=line-1`
    );

    await t.transcriber.end();
    await advance(60_000);
    expect(t.reads()).toBe(2);
  });
});

describe('CallTranscriber live call sent before an answer', () => {
  const paused = { ...CALL, pausedBy: '@ann:example.org' };

  it("keeps the call a Pause answered when a read sent before the answer arrives after it, with the read's lines", async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    const read = pending<Response>();
    t.server.live.mockImplementationOnce(() => read.promise);
    await advance(2_000);
    expect(t.reads()).toBe(2);

    await t.transcriber.pause(true);
    read.resolve(json({ call: CALL, lines: [LINE], names: { '@ann:example.org': 'Ann' } }));
    await advance();
    expect(t.updates.slice(-2)).toEqual([
      { type: 'call', call: paused },
      {
        type: 'live',
        live: { call: paused, lines: [LINE], names: { '@ann:example.org': 'Ann' } },
      },
    ]);

    // A read sent after the answer tells the call as it is.
    await advance(2_000);
    expect(t.updates.at(-1)).toEqual({ type: 'live', live: { call: CALL, lines: [], names: {} } });
  });

  it('keeps the call a join answered when a read sent before it arrives after it', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    const read = pending<Response>();
    t.server.live.mockImplementationOnce(() => read.promise);
    t.server.join.mockImplementationOnce(() => json({ call: paused }));
    await advance(18_000);
    expect(t.joins()).toBe(1);
    await advance(2_000);
    expect(t.joins()).toBe(2);

    read.resolve(json({ call: CALL, lines: [], names: {} }));
    await advance();
    expect(t.updates.at(-1)).toEqual({
      type: 'live',
      live: { call: paused, lines: [], names: {} },
    });
  });
});

describe('CallTranscriber Pause', () => {
  const paused = { ...CALL, pausedBy: '@ann:example.org' };

  it('pauses and resumes the joined call for everyone, and hands on each answer', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    t.updates.length = 0;

    await t.transcriber.pause(true);
    await t.transcriber.pause(false);
    expect(t.pauses()).toEqual(['pause true', 'pause false']);
    expect(t.urls).toContain(`${API_URL}/api/call-transcripts/v1/calls/call-1/pause`);
    expect(t.updates.filter((update) => update.type === 'call')).toEqual([
      { type: 'call', call: paused },
      { type: 'call', call: CALL },
    ]);
  });

  it('sends nothing while no join has answered', async () => {
    const t = setup();
    t.server.join.mockImplementation(serverError);
    t.transcriber.start();
    await advance();

    await t.transcriber.pause(true);
    expect(t.pauses()).toEqual([]);
  });

  it('hands on nothing for a refused request, which checks in, nor one without an answer after 15 seconds', async () => {
    const t = setup();
    t.transcriber.start();
    await advance();
    t.server.pause
      .mockImplementationOnce(() => json({ error: 'Not in the call.', code: 'not-found' }, 404))
      .mockImplementationOnce(unanswered);

    await t.transcriber.pause(true);
    await advance();
    // Not (or no longer) in the call: the check-in finds out.
    expect(t.joins()).toBe(2);
    expect(t.statuses).toEqual(['transcribing']);
    t.updates.length = 0;
    let answered = false;
    const pausing = t.transcriber.pause(true).then(() => {
      answered = true;
    });
    await advance(14_999);
    expect(answered).toBe(false);
    await advance(1);
    await pausing;
    expect(t.pauses()).toEqual(['pause true', 'pause true']);
    expect(t.updates.filter((update) => update.type === 'call')).toEqual([]);
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
    expect(ended).toBe(false);

    upload.resolve(json({ line: LINE }));
    await advance();
    expect(t.steps().slice(4)).toEqual(['speech 2', 'leave']);
    expect(t.urls.at(-1)).toBe(`${API_URL}/api/call-transcripts/v1/calls/call-1/leave`);
    await ending;
    expect(ended).toBe(true);

    // Nothing after the leave: no check-ins, no reads.
    await advance(60_000);
    expect(t.log).toEqual([
      'calls.join',
      'calls.live',
      'listen mic-a',
      'speech 1',
      'stop mic-a',
      'speech 2',
      'leave',
    ]);
  });

  it('leaves at once as the page goes away, with the session it has, dropping the queued stretches', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    const upload = pending<Response>();
    t.server.speech.mockImplementationOnce(() => upload.promise);
    t.capture().onStretch(stretch(1));
    t.capture().onStretch(stretch(2));
    t.capture().inProgress = stretch(3);
    await advance();

    void t.transcriber.leaveNow();
    expect(t.steps()).toEqual(['calls.join', 'listen mic-a', 'speech 1', 'leave', 'stop mic-a']);
    const init = defined(t.server.leave.mock.calls[0], 'the leave')[0];
    expect(init.keepalive).toBe(true);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer session');
    expect(t.server.session).toHaveBeenCalledTimes(1);

    // Nothing more is sent, not even a second leave.
    upload.resolve(json({ line: LINE }));
    await t.transcriber.end();
    await advance(60_000);
    expect(t.steps()).toEqual(['calls.join', 'listen mic-a', 'speech 1', 'leave', 'stop mic-a']);
  });

  it('finishes its uploads and leaves before sign-out ends the session, once ending', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    const upload = pending<Response>();
    t.server.speech.mockImplementationOnce(() => upload.promise);
    t.capture().onStretch(stretch(1));
    t.capture().inProgress = stretch(2);
    await advance();

    // The call was hung up, and its uploads are still going out as the person signs out.
    const ending = t.transcriber.end();
    const revoked = t.sessions.revoke();
    await advance(1_000);
    upload.resolve(json({ line: LINE }));
    await ending;
    await revoked;
    expect(t.steps()).toEqual([
      'calls.join',
      'listen mic-a',
      'speech 1',
      'stop mic-a',
      'speech 2',
      'leave',
      'revoke',
    ]);
  });

  it('takes its sign-out leave back once its ending settled', async () => {
    const sessions = new ClientSessions({ apiUrl: API_URL, getOpenIdToken: async () => TOKEN });
    const takeBack = vi.fn();
    vi.spyOn(sessions, 'beforeRevoke').mockReturnValue(takeBack);
    const transcriber = new CallTranscriber({
      roomId: OTHER_ROOM_ID,
      sessions,
      onStatus: () => undefined,
      onUpdate: () => undefined,
    });

    const ending = transcriber.end();
    expect(takeBack).not.toHaveBeenCalled();
    await ending;
    expect(takeBack).toHaveBeenCalledTimes(1);
  });

  it('leaves with its session before sign-out ends it, and not once the call ended', async () => {
    const t = setup();
    t.transcriber.setMicrophone(MIC_A);
    t.transcriber.start();
    await advance();
    const left = pending<Response>();
    t.server.leave.mockImplementationOnce(() => left.promise);

    const revoked = t.sessions.revoke();
    await advance();
    expect(t.steps()).toEqual(['calls.join', 'listen mic-a', 'leave', 'stop mic-a']);
    left.resolve(json({}));
    await revoked;
    expect(t.steps()).toEqual(['calls.join', 'listen mic-a', 'leave', 'stop mic-a', 'revoke']);

    const ended = setup({ roomId: OTHER_ROOM_ID });
    ended.transcriber.start();
    await advance();
    await ended.transcriber.end();
    await ended.sessions.revoke();
    expect(ended.steps()).toEqual(['calls.join', 'leave', 'revoke']);
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

  it('leaves, and lets the next join go, when the speech model never loads', async () => {
    const contexts: Array<{ closed: boolean }> = [];
    vi.stubGlobal(
      'AudioContext',
      class {
        closed = false;

        state = 'running';

        constructor() {
          contexts.push(this);
        }

        async close() {
          this.closed = true;
        }
      }
    );
    // The page, where the capture listens for clicks and key presses.
    vi.stubGlobal('window', new EventTarget());
    try {
      const first = setup({ listen: startSpeechCapture });
      first.transcriber.setMicrophone(MIC_A);
      first.transcriber.start();
      await advance();
      // The leave does not wait for the model.
      void first.transcriber.end();
      await advance();
      expect(first.steps()).toEqual(['calls.join', 'leave']);
      expect(contexts.map(({ closed }) => closed)).toEqual([true]);

      const second = setup();
      second.transcriber.start();
      await advance();
      expect(second.joins()).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
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
