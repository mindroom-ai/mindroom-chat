import { describe, expect, it, vi } from 'vitest';
import type { ClientSessions } from '../../computer/clientSessions';
import {
  DICTATION_STATUS_CACHE_TTL_MS,
  DictationApiError,
  DictationClient,
  expireTransientDictationCache,
  probeDictationAvailability,
  readCachedDictationAvailability,
  readCachedDictationRetryAt,
  readRetryAfterMs,
} from './api';

const makeSessions = (
  send = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
): ClientSessions => ({ send }) as unknown as ClientSessions;

describe('DictationClient', () => {
  it('probes GET /api/dictation/v1/status with optional encoded room_id', async () => {
    const send = vi.fn(async () =>
      Response.json({ enabled: true, maxSegmentSeconds: 30, maxSegmentBytes: 1_000_000 })
    );
    const client = new DictationClient(makeSessions(send));

    const withoutRoom = await client.status();
    expect(withoutRoom).toEqual({
      enabled: true,
      maxSegmentSeconds: 30,
      maxSegmentBytes: 1_000_000,
    });
    expect(send).toHaveBeenLastCalledWith('/api/dictation/v1/status', {
      method: 'GET',
      signal: undefined,
    });

    await client.status('!room:example.org');
    expect(send).toHaveBeenLastCalledWith('/api/dictation/v1/status?room_id=!room%3Aexample.org', {
      method: 'GET',
      signal: undefined,
    });
  });

  it('posts multipart FormData to /api/dictation/v1/transcribe with audio, prompt, and room_id', async () => {
    const send = vi.fn(async (_path: string, _init?: RequestInit) =>
      Response.json({ text: 'Hello world', seconds: 2.4 })
    );
    const client = new DictationClient(makeSessions(send));
    const wav = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' });

    const res = await client.transcribe(wav, {
      prompt: 'Prior words',
      roomId: '!room:example.org',
    });
    expect(res).toEqual({ text: 'Hello world', seconds: 2.4 });

    const [path, init] = send.mock.calls[0] ?? [];
    expect(path).toBe(
      `/api/dictation/v1/transcribe?room_id=${encodeURIComponent('!room:example.org')}`
    );
    expect(init?.method).toBe('POST');
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const audio = form.get('audio') as File;
    expect(audio.name).toBe('speech.wav');
    expect(form.get('prompt')).toBe('Prior words');
    expect(form.has('room_id')).toBe(false);

    // Omits optional fields and query string when absent (e.g. segment 0).
    await client.transcribe(wav);
    expect(send.mock.calls[1]?.[0]).toBe('/api/dictation/v1/transcribe');
    const form0 = send.mock.calls[1]?.[1]?.body as FormData;
    expect(form0.has('prompt')).toBe(false);
    expect(form0.has('room_id')).toBe(false);
  });

  it('parses refusal JSON and Retry-After headers into DictationApiError', async () => {
    const send = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Too many requests', code: 'too-many-requests' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '3' },
        })
    );
    const client = new DictationClient(makeSessions(send));

    await expect(client.transcribe(new Blob(['a']))).rejects.toMatchObject({
      name: 'DictationApiError',
      status: 429,
      code: 'too-many-requests',
      message: 'Too many requests',
      retryAfterMs: 3000,
    });
    expect(readRetryAfterMs('5')).toBe(5000);
    expect(readRetryAfterMs(new Date(Date.now() + 10_000).toUTCString())).toBeGreaterThan(5000);
    expect(readRetryAfterMs('invalid')).toBeUndefined();
    expect(new DictationApiError('fail', 503, 'unavailable').code).toBe('unavailable');
  });
});

describe('probeDictationAvailability cache', () => {
  it('deduplicates concurrent probes and respects the 5-minute TTL', async () => {
    let resolveResponse!: (res: Response) => void;
    const send = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        })
    );
    const sessions = makeSessions(send);
    let clock = 10_000;
    const now = () => clock;

    const p1 = probeDictationAvailability(sessions, '!r:ex', undefined, now);
    const p2 = probeDictationAvailability(sessions, '!r:ex', undefined, now);
    expect(send).toHaveBeenCalledTimes(1);

    resolveResponse(
      Response.json({ enabled: true, maxSegmentSeconds: 30, maxSegmentBytes: 1_000_000 })
    );
    await expect(Promise.all([p1, p2])).resolves.toEqual([true, true]);
    expect(readCachedDictationAvailability(sessions, '!r:ex', clock)).toBe(true);

    // Still fresh within 5 minutes.
    clock += DICTATION_STATUS_CACHE_TTL_MS - 1;
    expect(await probeDictationAvailability(sessions, '!r:ex', undefined, now)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);

    // Expired after 5 minutes -> re-probes.
    clock += 2;
    expect(readCachedDictationAvailability(sessions, '!r:ex', clock)).toBeUndefined();
    send.mockResolvedValueOnce(
      Response.json({ enabled: false, maxSegmentSeconds: 30, maxSegmentBytes: 1_000_000 })
    );
    expect(await probeDictationAvailability(sessions, '!r:ex', undefined, now)).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('caches 403 and 404 silently as false for the full TTL', async () => {
    const send = vi.fn(
      async () => new Response(JSON.stringify({ code: 'forbidden' }), { status: 403 })
    );
    const sessions = makeSessions(send);
    const now = () => 50_000;

    expect(await probeDictationAvailability(sessions, '!r:ex', undefined, now)).toBe(false);
    expect(readCachedDictationAvailability(sessions, '!r:ex', 50_000 + 60_000)).toBe(false);
    expect(readCachedDictationRetryAt(sessions, '!r:ex')).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('marks 503/network failures as transient with bounded exponential backoff and resets on recovery', async () => {
    let clock = 100_000;
    const now = () => clock;
    const send = vi.fn(async () => new Response('unavailable', { status: 503 }));
    const sessions = makeSessions(send);

    for (const expectedDelay of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      expect(await probeDictationAvailability(sessions, '!r:ex', undefined, now)).toBe(false);
      const retryAt = clock + expectedDelay;
      expect(readCachedDictationRetryAt(sessions, '!r:ex')).toBe(retryAt);
      expect(readCachedDictationAvailability(sessions, '!r:ex', retryAt - 1)).toBe(false);
      clock = retryAt + 1;
      expect(readCachedDictationAvailability(sessions, '!r:ex', clock)).toBeUndefined();
    }

    // Success clears transient state and backoff counter; a later 503 starts back at 30 s.
    send.mockResolvedValueOnce(
      Response.json({ enabled: true, maxSegmentSeconds: 30, maxSegmentBytes: 1_000_000 })
    );
    expect(await probeDictationAvailability(sessions, '!r:ex', undefined, now)).toBe(true);
    expect(readCachedDictationRetryAt(sessions, '!r:ex')).toBeUndefined();

    clock += DICTATION_STATUS_CACHE_TTL_MS + 1;
    expect(await probeDictationAvailability(sessions, '!r:ex', undefined, now)).toBe(false);
    expect(readCachedDictationRetryAt(sessions, '!r:ex')).toBe(clock + 30_000);

    // Permanent 403 also clears transient state and caches for the full TTL.
    clock += 30_001;
    send.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    expect(await probeDictationAvailability(sessions, '!r:ex', undefined, now)).toBe(false);
    expect(readCachedDictationRetryAt(sessions, '!r:ex')).toBeUndefined();
    expect(readCachedDictationAvailability(sessions, '!r:ex', clock + 60_000)).toBe(false);
  });

  it('preserves transient state across in-flight re-probes and resets backoff on expireTransientDictationCache', async () => {
    let clock = 10_000;
    const now = () => clock;
    const send = vi.fn<() => Promise<Response>>();
    send.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    send.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    const sessions = makeSessions(send);

    await probeDictationAvailability(sessions, '!r:ex', undefined, now);
    clock += 30_001;
    await probeDictationAvailability(sessions, '!r:ex', undefined, now);
    expect(readCachedDictationRetryAt(sessions, '!r:ex')).toBe(clock + 60_000);

    // Expiring transient cache marks it immediately stale, keeps transient flag, and resets backoff to 30 s.
    expireTransientDictationCache(sessions, '!r:ex');
    expect(readCachedDictationRetryAt(sessions, '!r:ex')).toBe(0);
    expect(readCachedDictationAvailability(sessions, '!r:ex', clock)).toBeUndefined();

    let resolveInFlight!: (res: Response) => void;
    send.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveInFlight = resolve;
        })
    );
    const pending = probeDictationAvailability(sessions, '!r:ex', undefined, now);
    // Transient flag stays set while the re-probe is in flight (no UI flicker).
    expect(readCachedDictationRetryAt(sessions, '!r:ex')).toBe(0);
    resolveInFlight(new Response('unavailable', { status: 503 }));
    expect(await pending).toBe(false);
    expect(readCachedDictationRetryAt(sessions, '!r:ex')).toBe(clock + 30_000);

    // No-op for non-transient entries.
    send.mockResolvedValueOnce(
      Response.json({ enabled: true, maxSegmentSeconds: 30, maxSegmentBytes: 1_000_000 })
    );
    clock += 30_001;
    expect(await probeDictationAvailability(sessions, '!r:ex', undefined, now)).toBe(true);
    expireTransientDictationCache(sessions, '!r:ex');
    expect(readCachedDictationAvailability(sessions, '!r:ex', clock)).toBe(true);
  });
});
