import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Spinner, Text, color } from 'folds';
import type { VerificationRequest } from 'matrix-js-sdk/lib/crypto-api';
import { SecurityDialog } from '../verification/SecurityDialog';
import {
  VerificationRequestDialog,
  cancelPendingVerification,
} from '../verification/VerificationRequestDialog';
import { ErrorDetail } from '../../ui/ErrorDetail';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useAlive } from '../../lib/hooks/useAlive';
import { describeError } from '../../lib/describeError';
import { RecoveryUnlock } from './RecoveryUnlock';
import type { DefaultSecretStorageKey } from './recoveryState';

const KEY = 'sharedUi.recoveryPassword';

type RecoveryUnlockDialogProps = {
  secretStorageKey: DefaultSecretStorageKey;
  onClose: () => void;
  /** The person has no recovery password any more. */
  onForgot: () => void;
  onSetPassword?: () => void;
};

/** Asks for the recovery password, or hands over to a verification from another device. */
export function RecoveryUnlockDialog({
  secretStorageKey,
  onClose,
  onForgot,
  onSetPassword,
}: RecoveryUnlockDialogProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const [request, setRequest] = useState<VerificationRequest>();
  const [unlocked, setUnlocked] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<{ failure: unknown }>();

  const verifyWithDevice = () => {
    const crypto = client.getCrypto();
    if (!crypto || requesting) return;
    setRequesting(true);
    setError(undefined);
    crypto
      .requestOwnUserVerification()
      .then((own) => alive() && setRequest(own))
      .catch((failure: unknown) => alive() && setError({ failure }))
      .finally(() => alive() && setRequesting(false));
  };

  if (request) {
    return (
      <VerificationRequestDialog
        request={request}
        onClose={() => {
          cancelPendingVerification(request);
          onClose();
        }}
      />
    );
  }

  return (
    <SecurityDialog title={t(`${KEY}.unlockTitle`)} onClose={onClose}>
      <Text size="T300">{t(`${KEY}.unlockIntro`)}</Text>
      <RecoveryUnlock
        secretStorageKey={secretStorageKey}
        onSetPassword={onSetPassword}
        onUnlocked={() => setUnlocked(true)}
      />
      {!unlocked && (
        <Box direction="Column" gap="100" alignItems="Start">
          <Button
            size="300"
            radii="300"
            variant="Secondary"
            fill="None"
            disabled={requesting}
            before={requesting ? <Spinner size="50" variant="Secondary" /> : undefined}
            onClick={verifyWithDevice}
          >
            <Text size="B300">{t(`${KEY}.verifyWithDevice`)}</Text>
          </Button>
          <Button size="300" radii="300" variant="Secondary" fill="None" onClick={onForgot}>
            <Text size="B300">{t(`${KEY}.forgot`)}</Text>
          </Button>
          {error && (
            <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
              {describeError(t, error.failure)}
              <ErrorDetail error={error.failure} />
            </Text>
          )}
        </Box>
      )}
      <Button variant="Secondary" fill="Soft" onClick={onClose}>
        <Text size="B400">{t(unlocked ? `${KEY}.done` : `${KEY}.notNow`)}</Text>
      </Button>
    </SecurityDialog>
  );
}
