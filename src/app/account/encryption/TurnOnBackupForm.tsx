import { FormEventHandler, useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Spinner, Text, color } from 'folds';
import { PasswordInput } from '../../ui/PasswordInput';
import { ErrorDetail } from '../../ui/ErrorDetail';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../../lib/hooks/useAsyncCallback';
import { keyFromRecoveryInput } from './recoveryInput';
import type { DefaultSecretStorageKey } from './recoveryState';
import { turnOnKeyBackup } from './turnOnKeyBackup';
import { useRecoveryFailureText } from './useRecoveryFailureText';

const KEY = 'sharedUi.recoveryPassword';

type TurnOnBackupFormProps = {
  secretStorageKey: DefaultSecretStorageKey;
  /** Called once the backup exists. */
  onDone: () => void;
  /** Called when turning it on failed, which may have left a backup on the server. */
  onFailed?: () => void;
};

/**
 * Asks for the recovery password (or key) once and turns key backup on with it, for an account
 * that has secret storage but no backup.
 */
export function TurnOnBackupForm({ secretStorageKey, onDone, onFailed }: TurnOnBackupFormProps) {
  const { keyId, keyContent, hasPassphrase } = secretStorageKey;
  const { t } = useTranslation();
  const client = useMatrixClient();
  const inputId = useId();
  const describeFailure = useRecoveryFailureText();

  const [state, turnOn] = useAsyncCallback(
    useCallback(
      async (input: string) => {
        const key = await keyFromRecoveryInput(client, input, keyContent);
        await turnOnKeyBackup(client, keyId, key);
      },
      [client, keyId, keyContent]
    )
  );
  const loading = state.status === AsyncStatus.Loading;
  const failure = state.status === AsyncStatus.Error ? describeFailure(state.error) : undefined;

  const submit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    const field = new FormData(evt.currentTarget).get('recoveryInput');
    const value = typeof field === 'string' ? field.trim() : '';
    if (!value || loading) return;
    turnOn(value).then(onDone, () => onFailed?.());
  };

  return (
    <Box as="form" direction="Column" gap="200" onSubmit={submit}>
      <Text size="T200">{t(`${KEY}.turnOnIntro`)}</Text>
      <Text as="label" htmlFor={inputId} size="L400">
        {t(hasPassphrase ? `${KEY}.passwordLabel` : `${KEY}.keyLabel`)}
      </Text>
      <PasswordInput
        id={inputId}
        name="recoveryInput"
        size="300"
        variant="Background"
        outlined
        required
        autoFocus
        autoComplete="off"
        readOnly={loading}
      />
      {failure && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          <b>{failure.text}</b>
          <ErrorDetail error={failure.detailOf} />
        </Text>
      )}
      <Button
        type="submit"
        size="300"
        radii="300"
        variant="Primary"
        disabled={loading}
        before={loading ? <Spinner size="50" variant="Primary" fill="Solid" /> : undefined}
      >
        <Text size="B300">{t(`${KEY}.turnOnBackup`)}</Text>
      </Button>
    </Box>
  );
}
