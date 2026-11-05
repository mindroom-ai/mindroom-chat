import { ClientPrefix, MatrixError, Method, type MatrixClient } from 'matrix-js-sdk';
import type { KeyBackupInfo } from 'matrix-js-sdk/lib/crypto-api';

/** The server's way of saying the account has no key backup: a 404, with or without `M_NOT_FOUND`. */
const isNoBackupAnswer = (error: unknown): boolean =>
  error instanceof MatrixError && (error.errcode === 'M_NOT_FOUND' || error.httpStatus === 404);

/**
 * The account's latest server-side key backup (spec: "Server-side key backups",
 * `GET /room_keys/version`), asked of the server itself rather than the SDK's cached copy.
 * Resolves to `null` only when the server says there is none. Any other failure (offline, rate
 * limited, a server error) rejects: it tells nothing about whether a backup exists.
 */
export const fetchKeyBackupVersion = async (
  client: Pick<MatrixClient, 'http'>
): Promise<KeyBackupInfo | null> => {
  try {
    return await client.http.authedRequest<KeyBackupInfo>(
      Method.Get,
      '/room_keys/version',
      undefined,
      undefined,
      { prefix: ClientPrefix.V3 }
    );
  } catch (error) {
    if (isNoBackupAnswer(error)) return null;
    throw error;
  }
};
