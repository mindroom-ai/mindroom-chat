import React, { MouseEventHandler, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { Box, Chip, Icon, Icons, PopOut, RectCords, Spinner, Text, color, config } from 'folds';
import { Menu, MenuItem } from './glass/GlassPrimitives';
import { SettingTile } from './setting-tile';
import {
  SecretStorageKeyContent,
  SecretStorageRecoveryKey,
  SecretStorageRecoveryPassphrase,
} from './SecretStorage';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { storePrivateKey } from '../../client/secretStorageKeys';

// Thrown in English and translated when shown, so a retained error follows language changes.
const CRYPTO_NOT_FOUND = 'Unexpected Error! Crypto object not found.';
const INTERNAL_ERRORS: ReadonlySet<string> = new Set([CRYPTO_NOT_FOUND]);

enum VerificationMethod {





  value: VerificationMethod;
  hasPassphrase: boolean;
  onChange: (method: VerificationMethod) => void;
};

function ManualVerificationMethodSwitcher({
  value,
  hasPassphrase,
  onChange,



  const label = (method: VerificationMethod) =>
    method === VerificationMethod.RecoveryKey
      ? t('sharedUi.manualVerification.recoveryKey')
      : t('sharedUi.manualVerification.recoveryPassphrase');

  const handleOpen: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };
  const handleSelect = (method: VerificationMethod) => {
    onChange(method);
    setMenuAnchor(undefined);
  };

  const methods = hasPassphrase
    ? [VerificationMethod.RecoveryKey, VerificationMethod.RecoveryPassphrase]
    : [VerificationMethod.RecoveryKey];

  return (
    <>
      <Chip
        variant="Secondary"
        radii="Pill"
        after={<Icon src={Icons.ChevronBottom} size="100" />}
        onClick={handleOpen}
        aria-haspopup="menu"
        aria-expanded={!!menuAnchor}
      >
        <Text size="B300">{label(value)}</Text>
      </Chip>
      <PopOut











            }}
          >
            <Menu>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                {methods.map((method) => (
                  <MenuItem
                    key={method}
                    size="300"
                    radii="300"
                    aria-pressed={method === value}
                    onClick={() => handleSelect(method)}
                  >
                    <Text size="T300">{label(method)}</Text>
                  </MenuItem>
                ))}
              </Box>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}




};

/** Verifies this device by unlocking secret storage with the recovery key or passphrase. */






  const passphraseContent = secretStorageKeyContent.passphrase;
  const [method, setMethod] = useState(VerificationMethod.RecoveryKey);

  const [verifyState, verify] = useAsyncCallback(



        if (!crypto) throw new Error(CRYPTO_NOT_FOUND);
        storePrivateKey(secretStorageKeyId, recoveryKey);
        // With the key cached, bootstrapping imports the account's cross-signing keys from
        // secret storage and signs this device with them.
        await crypto.bootstrapCrossSigning({});
        await crypto.loadSessionBackupPrivateKeyFromSecretStorage().catch(() => undefined);
        await crypto.checkKeyBackupAndEnable();
      },
      [mx, secretStorageKeyId]
    )
  );

  const handleDecodedRecoveryKey = (recoveryKey: Uint8Array) => {
    verify(recoveryKey).catch(() => undefined);
  };

  const errorMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return INTERNAL_ERRORS.has(message)
      ? t('sharedUi.deviceVerificationSetup.unexpectedError')
      : message;
  };

  return (
    <Box direction="Column" gap="200">
      <SettingTile
        title={t('sharedUi.manualVerification.verifyManually')}
        description={t('sharedUi.manualVerification.selectAVerificationMethod')}
        after={
          <ManualVerificationMethodSwitcher
            value={method}
            hasPassphrase={!!passphraseContent}
            onChange={setMethod}
          />





        </Text>
      ) : (
        <>
          {method === VerificationMethod.RecoveryPassphrase && passphraseContent ? (
            <SecretStorageRecoveryPassphrase
              keyContent={secretStorageKeyContent}
              passphraseContent={passphraseContent}






            />
          )}




            </Text>
          )}
        </>
      )}
    </Box>
  );
}
