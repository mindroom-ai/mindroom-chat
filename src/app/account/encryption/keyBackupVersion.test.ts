import { describe, expect, it, vi } from 'vitest';
import { MatrixError, Method, type MatrixClient } from 'matrix-js-sdk';
import { fetchKeyBackupVersion } from './keyBackupVersion';

const answering = (answer: () => Promise<unknown>) => {
  const authedRequest = vi.fn(answer);
  return { client: { http: { authedRequest } } as unknown as MatrixClient, authedRequest };
};

/** A refusal from the server, as the SDK's HTTP layer raises it. */
const refusal = (status: number, errcode?: string) =>
  new MatrixError({ errcode, error: `refused with ${status}` }, status);

describe('fetchKeyBackupVersion', () => {
  it("asks the server for the account's latest backup and answers what it says", async () => {
    const backup = { version: '3', algorithm: 'm.megolm_backup.v1.curve25519-aes-sha2' };
    const { client, authedRequest } = answering(async () => backup);

    await expect(fetchKeyBackupVersion(client)).resolves.toEqual(backup);

    expect(authedRequest).toHaveBeenCalledWith(
      Method.Get,
      '/room_keys/version',
      undefined,
      undefined,
      { prefix: '/_matrix/client/v3' }
    );
  });

  it('answers that there is none when the server says M_NOT_FOUND', async () => {
    const { client } = answering(async () => Promise.reject(refusal(404, 'M_NOT_FOUND')));
    await expect(fetchKeyBackupVersion(client)).resolves.toBeNull();
  });

  it('answers that there is none for a 404 without an errcode', async () => {
    const { client } = answering(async () => Promise.reject(refusal(404)));
    await expect(fetchKeyBackupVersion(client)).resolves.toBeNull();
  });

  it.each([
    ['a rate limit', refusal(429, 'M_LIMIT_EXCEEDED')],
    ['a server error', refusal(500, 'M_UNKNOWN')],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('rejects on %s, which says nothing about whether a backup exists', async (_name, error) => {
    const { client } = answering(async () => Promise.reject(error));
    await expect(fetchKeyBackupVersion(client)).rejects.toBe(error);
  });
});
