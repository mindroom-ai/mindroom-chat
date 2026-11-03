import { useEffect } from 'react';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from './useMatrixClient';

/** Calls `onChange` with the user IDs whose device lists the crypto store just updated. */
export const useDeviceListChange = (
  onChange: (userIds: string[], initialFetch: boolean) => void










