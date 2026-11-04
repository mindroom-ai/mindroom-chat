import { useEffect, useState } from 'react';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { fetchKeyBackupVersion } from '../../utils/keyBackupVersion';

/**
 * Whether the account has a server-side key backup. `unknown` until the server has answered
 * definitively: a failed or rate-limited request is not proof that there is no backup.
 */
export type KeyBackupPresence = 'unknown' | 'present' | 'absent';

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
      fetchKeyBackupVersion(mx).then(
        (backup) => {
          if (!active || current !== request) return;
          if (backup === null) {
            setPresence('absent');
            return;
          }
          const version: unknown = backup.version;
          setPresence(typeof version === 'string' && version ? 'present' : 'unknown');
        },
        () => {
          if (active && current === request) setPresence('unknown');
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
