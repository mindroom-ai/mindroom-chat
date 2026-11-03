import { useEffect, useState } from 'react';
import { MatrixError, Method } from 'matrix-js-sdk';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from '../../hooks/useMatrixClient';

/**
 * Whether the account has a server-side key backup. `unknown` until the server has answered
 * definitively: a failed or rate-limited request is not proof that there is no backup.
 */
export type KeyBackupPresence = 'unknown' | 'present' | 'absent';

const isNotFound = (error: unknown): boolean =>
  error instanceof MatrixError && (error.errcode === 'M_NOT_FOUND' || error.httpStatus === 404);

/** Asks the homeserver for the current key backup version, and asks again when backup changes. */
export const useKeyBackupPresence = (): KeyBackupPresence => {
  const mx = useMatrixClient();
  const [presence, setPresence] = useState<KeyBackupPresence>('unknown');

  useEffect(() => {
    let active = true;
    let request = 0;
    const check = () => {
      request += 1;
      const current = request;
      mx.http
        .authedRequest(Method.Get, '/room_keys/version', undefined, undefined, {
          prefix: '/_matrix/client/v3',
        })
        .then(
          (response) => {
            if (!active || current !== request) return;
            const version = (response as { version?: unknown } | undefined)?.version;
            setPresence(typeof version === 'string' && version ? 'present' : 'unknown');
          },
          (error: unknown) => {
            if (!active || current !== request) return;
            setPresence(isNotFound(error) ? 'absent' : 'unknown');
          }
        );
    };

    setPresence('unknown');
    check();
    mx.on(CryptoEvent.KeyBackupStatus, check);
    return () => {
      active = false;
      mx.removeListener(CryptoEvent.KeyBackupStatus, check);
    };
  }, [mx]);

  return presence;
};
