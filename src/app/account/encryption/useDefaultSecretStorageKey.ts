import { useEffect, useState } from 'react';
import { ClientEvent, type MatrixEvent } from 'matrix-js-sdk';
import type { SecretStorageKeyTuple } from 'matrix-js-sdk/lib/secret-storage';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';

/**
 * The account's default secret storage key (spec: "Secret storage"), read again whenever secret
 * storage account data changes; `null` when the account has none, `undefined` until the first
 * answer and after a failed read.
 */
export const useDefaultSecretStorageKey = (): SecretStorageKeyTuple | null | undefined => {
  const client = useMatrixClient();
  const [key, setKey] = useState<SecretStorageKeyTuple | null>();

  useEffect(() => {
    let mounted = true;
    // Reads can answer out of order; only the latest one's answer counts.
    let latest = 0;
    const read = () => {
      latest += 1;
      const request = latest;
      const current = () => mounted && request === latest;
      client.secretStorage.getKey().then(
        (tuple) => current() && setKey(tuple),
        () => current() && setKey(undefined)
      );
    };
    const onAccountData = (event: MatrixEvent) => {
      if (event.getType().startsWith('m.secret_storage.')) read();
    };
    read();
    client.on(ClientEvent.AccountData, onAccountData);
    return () => {
      mounted = false;
      client.off(ClientEvent.AccountData, onAccountData);
    };
  }, [client]);

  return key;
};
