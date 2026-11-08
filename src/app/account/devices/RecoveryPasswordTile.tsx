import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text, color } from 'folds';
import { ClientEvent, type MatrixEvent } from 'matrix-js-sdk';
import { SettingTile } from '../../ui/SettingTile';
import { SecurityOverlay } from '../verification/SecurityOverlay';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { ChangeRecoveryPassword } from '../encryption/ChangeRecoveryPassword';
import { useRecoveryState, type DefaultSecretStorageKey } from '../encryption/recoveryState';

const KEY = 'sharedUi.recoveryPassword';

/** The account data that decides `getSecretStorageStatus().ready`: the default key and the secrets. */
const affectsSecretStorage = (type: string): boolean =>
  type.startsWith('m.secret_storage.') ||
  type.startsWith('m.cross_signing.') ||
  type === 'm.megolm_backup.v1';

/**
 * Whether secret storage holds every secret this session knows of, read on mount and again when
 * the default key or one of the secrets changes in account data. Only the newest read's answer is
 * kept. A failed read keeps the answer shown before it (complete until a read says otherwise).
 */
const useSecretStorageReady = (): boolean => {
  const client = useMatrixClient();
  const [ready, setReady] = useState(true);
  useEffect(() => {
    let newest = 0;
    let mounted = true;
    const read = () => {
      newest += 1;
      const request = newest;
      client
        .getCrypto()
        ?.getSecretStorageStatus()
        .then(
          (status) => mounted && request === newest && setReady(status.ready),
          () => undefined
        );
    };
    const onAccountData = (event: MatrixEvent) => {
      if (affectsSecretStorage(event.getType())) read();
    };
    read();
    client.on(ClientEvent.AccountData, onAccountData);
    return () => {
      mounted = false;
      client.off(ClientEvent.AccountData, onAccountData);
    };
  }, [client]);
  return ready;
};

function RecoveryPasswordRow({ secretStorageKey }: { secretStorageKey: DefaultSecretStorageKey }) {
  const { t } = useTranslation();
  const ready = useSecretStorageReady();
  const [open, setOpen] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <SettingTile
      focusId="recoveryPassword"
      title={t(`${KEY}.title`)}
      description={t(`${KEY}.tileDescription`)}
      after={
        <Button
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          onClick={() => setOpen(true)}
        >
          <Text size="B300">
            {t(secretStorageKey.hasPassphrase ? `${KEY}.change` : `${KEY}.setRecoveryPassword`)}
          </Text>
        </Button>
      }
    >
      {!ready && (
        <Text size="T200" role="alert" style={{ color: color.Warning.Main }}>
          {t(`${KEY}.notCovered`)}
        </Text>
      )}
      {open && (
        <SecurityOverlay onClose={close} dismissible={!keepOpen}>
          <ChangeRecoveryPassword
            secretStorageKey={secretStorageKey}
            askCurrent
            onClose={close}
            onKeepOpenChange={setKeepOpen}
          />
        </SecurityOverlay>
      )}
    </SettingTile>
  );
}

/** Changes the recovery password, or adds one; only a verified session with a secret storage key. */
export function RecoveryPasswordTile() {
  const state = useRecoveryState();
  if (state.kind !== 'ready' || !state.key) return null;
  return <RecoveryPasswordRow secretStorageKey={state.key} />;
}
