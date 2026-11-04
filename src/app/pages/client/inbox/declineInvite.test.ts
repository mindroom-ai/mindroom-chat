import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { declineInvite } from './declineInvite';

const clientWith = (leave: () => Promise<unknown>, forget: () => Promise<unknown>) =>
  ({ leave: vi.fn(leave), forget: vi.fn(forget) } as unknown as MatrixClient & {
    leave: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
  });

describe('declineInvite', () => {
  it('leaves the room and then forgets it', async () => {
    const order: string[] = [];
    const client = clientWith(
      async () => order.push('leave'),
      async () => order.push('forget')
    );
    await declineInvite(client, '!r:s');
    expect(order).toEqual(['leave', 'forget']);
    expect(client.forget).toHaveBeenCalledWith('!r:s');
  });

  it('fails with the leave and never forgets a room it could not leave', async () => {
    const client = clientWith(
      () => Promise.reject(new Error('M_FORBIDDEN')),
      async () => undefined
    );
    await expect(declineInvite(client, '!r:s')).rejects.toThrow('M_FORBIDDEN');
    expect(client.forget).not.toHaveBeenCalled();
  });

  it('counts the invite as declined when only forgetting fails', async () => {
    const client = clientWith(
      async () => undefined,
      () => Promise.reject(new Error('offline'))
    );
    await expect(declineInvite(client, '!r:s')).resolves.toBeUndefined();
  });
});
