import { createClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { closeClient } from './closeClient';

describe('closeClient', () => {
  it('stops the client and then closes its sync store', () => {
    const calls: string[] = [];
    const client = {
      stopClient: vi.fn(() => calls.push('stop')),
      store: { destroy: vi.fn(async () => void calls.push('close store')) },
    };

    closeClient(client as never);

    expect(calls).toEqual(['stop', 'close store']);
  });

  it('logs a store that fails to close instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failure = new Error('blocked');
    const client = {
      stopClient: vi.fn(),
      store: { destroy: vi.fn(async () => Promise.reject(failure)) },
    };

    expect(() => closeClient(client as never)).not.toThrow();
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('[client] could not close the sync store', failure)
    );
    warn.mockRestore();
  });

  it('sends no first /sync when the client closes while its sync starts', async () => {
    // The sync start awaits the push rules and the filter before it sends the first /sync. A
    // close in that window used to send it anyway, with the stopped client's aborted signal, and
    // nothing awaited its rejection: an uncaught "signal is aborted without reason".
    let answerFilter!: () => void;
    const filterHeld = new Promise<void>((resolve) => {
      answerFilter = resolve;
    });
    const requested: string[] = [];
    const json = (body: object) =>
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const { pathname } = new URL(String(input));
      requested.push(pathname);
      if (init?.signal?.aborted) throw init.signal.reason;
      if (pathname.endsWith('/filter')) {
        await filterHeld;
        return json({ filter_id: 'filter-1' });
      }
      if (pathname.endsWith('/versions')) return json({ versions: ['v1.11'] });
      if (pathname.endsWith('/pushrules/')) return json({ global: {} });
      return json({});
    };
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    const client = createClient({
      baseUrl: 'https://matrix.example',
      userId: '@reader:example',
      deviceId: 'DEVICE',
      accessToken: 'token',
      fetchFn,
    });
    try {
      await client.startClient({ lazyLoadMembers: true });
      await vi.waitFor(() => expect(requested.some((path) => path.endsWith('/filter'))).toBe(true));

      closeClient(client);
      answerFilter();
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });

      expect(requested.filter((path) => path.endsWith('/sync'))).toEqual([]);
      expect(rejections).toEqual([]);
    } finally {
      answerFilter();
      process.off('unhandledRejection', onRejection);
    }
  });
});
