import React, { FormEventHandler, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Spinner, Text, color } from 'folds';
import type { SecretStorageKeyDescriptionAesV1 } from 'matrix-js-sdk/lib/secret-storage';
import { decodeRecoveryKey, deriveRecoveryKeyFromPassphrase } from 'matrix-js-sdk/lib/crypto-api';
import { PasswordInput } from './password-input';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { useAlive } from '../hooks/useAlive';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';

/** `m.secret_storage.key.*` passphrase info (PBKDF2 settings). */











  iv?: string;
  mac?: string;
  passphrase?: SecretStoragePassphraseContent;
};

// Thrown in English and translated when shown, so a retained error follows language changes.
const INVALID_PASSPHRASE = 'Invalid recovery passphrase.';
const INVALID_KEY = 'Invalid recovery key.';

const useRecoveryErrorText = () => {
  const { t } = useTranslation();
  return (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    if (message === INVALID_PASSPHRASE)
      return t('sharedUi.secretStorage.invalidRecoveryPassphrase');
    if (message === INVALID_KEY) return t('sharedUi.secretStorage.invalidRecoveryKey');
    return message;
  };
};

type RecoveryFormProps = {
  label: string;
  inputName: string;
  loading: boolean;
  errorText?: string;
  onValue: (value: string) => void;
};

function RecoveryForm({ label, inputName, loading, errorText, onValue }: RecoveryFormProps) {




    const input = (evt.target as HTMLFormElement & Record<string, HTMLInputElement | undefined>)[
      inputName
    ];
    const value = input?.value.trim();
    if (!value || loading) return;
    onValue(value);
  };

  return (
    <Box as="form" onSubmit={handleSubmit} direction="Column" gap="400">
      <Box direction="Column" gap="100">
        <Text size="L400">{label}</Text>
        <PasswordInput
          name={inputName}
          size="400"
          variant="Background"
          outlined
          required
          autoFocus
          readOnly={loading}
        />
        {errorText !== undefined && (
          <Text size="T200" style={{ color: color.Critical.Main }}>
            <b>{errorText}</b>
          </Text>
        )}
      </Box>
      <Button
        type="submit"
        variant="Primary"
        disabled={loading}
        before={loading ? <Spinner size="200" variant="Primary" fill="Solid" /> : undefined}
      >
        <Text as="span" size="B400">
          {t('sharedUi.secretStorage.verify')}
        </Text>
      </Button>
    </Box>
  );
}





};

/** Asks for the recovery passphrase and hands on the key it derives once secret storage accepts it. */








  const errorText = useRecoveryErrorText();

  const [state, decode] = useAsyncCallback(
    useCallback(
      async (passphrase: string) => {
        const key = await deriveRecoveryKeyFromPassphrase(
          passphrase,
          passphraseContent.salt,
          passphraseContent.iterations,
          passphraseContent.bits
        );
        const valid = await mx.secretStorage.checkKey(
          key,
          keyContent as SecretStorageKeyDescriptionAesV1
        );
        if (!valid) throw new Error(INVALID_PASSPHRASE);
        if (alive()) onDecodedRecoveryKey(key);
        return key;
      },
      [mx, alive, keyContent, passphraseContent, onDecodedRecoveryKey]
    )
  );

  return (
    <RecoveryForm
      label={t('sharedUi.secretStorage.recoveryPassphrase')}
      inputName="recoveryPassphraseInput"
      loading={state.status === AsyncStatus.Loading}
      errorText={state.status === AsyncStatus.Error ? errorText(state.error) : undefined}
      onValue={decode}
    />
  );
}




};

/** Asks for the recovery key and hands it on once secret storage accepts it. */







  const errorText = useRecoveryErrorText();

  const [state, decode] = useAsyncCallback(
    useCallback(
      async (recoveryKey: string) => {
        let key: Uint8Array;
        try {
          key = decodeRecoveryKey(recoveryKey);
        } catch {
          throw new Error(INVALID_KEY);
        }
        const valid = await mx.secretStorage.checkKey(
          key,
          keyContent as SecretStorageKeyDescriptionAesV1
        );
        if (!valid) throw new Error(INVALID_KEY);
        if (alive()) onDecodedRecoveryKey(key);
        return key;
      },
      [mx, alive, keyContent, onDecodedRecoveryKey]
    )
  );

  return (
    <RecoveryForm
      label={t('sharedUi.secretStorage.recoveryKey')}
      inputName="recoveryKeyInput"
      loading={state.status === AsyncStatus.Loading}
      errorText={state.status === AsyncStatus.Error ? errorText(state.error) : undefined}
      onValue={decode}
    />
  );
}
