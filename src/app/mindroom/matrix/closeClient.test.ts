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
});
