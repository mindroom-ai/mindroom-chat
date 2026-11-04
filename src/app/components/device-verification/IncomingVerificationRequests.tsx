import React, { useEffect, useState } from 'react';
import { CryptoEvent, type VerificationRequest } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { SecurityOverlay } from './SecurityOverlay';
import { VerificationRequestDialog, cancelPendingVerification } from './VerificationRequestDialog';

/**
 * Opens the verification dialog when another device or person asks this one to verify, on any
 * page. One request shows at a time: while it is in flight, newer requests are left unanswered
 * and time out on their own.
 */
export function IncomingVerificationRequests() {
  const client = useMatrixClient();
  const [shown, setShown] = useState<VerificationRequest>();

  useEffect(() => {
    const receive = (request: VerificationRequest) => {
      if (!request.pending) return;
      setShown((current) => (current?.pending ? current : request));
    };
    client.on(CryptoEvent.VerificationRequestReceived, receive);
    return () => {
      client.off(CryptoEvent.VerificationRequestReceived, receive);
    };
  }, [client]);

  if (!shown) return null;
  const close = () => setShown(undefined);
  const dismiss = () => {
    cancelPendingVerification(shown);
    close();
  };
  return (
    <SecurityOverlay onClose={dismiss}>
      <VerificationRequestDialog request={shown} onClose={close} />
    </SecurityOverlay>
  );
}
