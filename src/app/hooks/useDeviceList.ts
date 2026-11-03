import { useEffect } from 'react';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from './useMatrixClient';

type DevicesUpdatedListener = (userIds: string[], initialFetch: boolean) => void;

/**
 * Subscribes `listener` to the crypto store's device-list updates for as long as the calling
 * component stays mounted. It receives the user IDs whose lists changed and whether this was the
 * first fetch of them.
 */
export function useDeviceListChange(listener: DevicesUpdatedListener): void {
  const client = useMatrixClient();

  useEffect(() => {
    const unsubscribe = () => {
      client.off(CryptoEvent.DevicesUpdated, listener);
    };
    client.on(CryptoEvent.DevicesUpdated, listener);
    return unsubscribe;
  }, [client, listener]);
}
