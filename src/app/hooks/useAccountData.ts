import { useEffect, useState } from 'react';
import { AccountDataEvents, ClientEvent, MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';

/**
 * The account data event of `type`, or undefined before it exists. Returns the same event until
 * the client stores a new one of that type.
 */
export const useAccountData = (type: string): MatrixEvent | undefined => {
  const mx = useMatrixClient();
  const [event, setEvent] = useState(() => mx.getAccountData(type as keyof AccountDataEvents));

  useEffect(() => {
    setEvent(mx.getAccountData(type as keyof AccountDataEvents));
    const handleAccountData = (accountEvent: MatrixEvent) => {








  return event;
};
