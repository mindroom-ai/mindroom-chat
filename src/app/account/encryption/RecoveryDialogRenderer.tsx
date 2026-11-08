import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Spinner, Text } from 'folds';
import { useAtom } from 'jotai';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { hasServerEncryptionSetup } from '../devices/serverEncryptionSetup';
import { DeviceVerificationSetup } from '../verification/DeviceVerificationSetup';
import { ResetVerificationDialog } from '../verification/ResetVerificationDialog';
import { SecurityDialog } from '../verification/SecurityDialog';
import { SecurityOverlay } from '../verification/SecurityOverlay';
import { ChangeRecoveryPassword } from './ChangeRecoveryPassword';
import { recoveryDialogAtom, type RecoveryDialog } from './recoveryDialog';
import { RecoveryUnlockDialog } from './RecoveryUnlockDialog';
import {
  useRecoveryState,
  type DefaultSecretStorageKey,
  type RecoveryState,
} from './recoveryState';

const KEY = 'sharedUi.recoveryPassword';

type ServerCheck = 'checking' | 'failed' | 'none' | 'existing';

const keyOf = (state: RecoveryState): DefaultSecretStorageKey | null =>
  state.kind === 'locked' || state.kind === 'ready' ? state.key : null;

/**
 * Asks the server, when `setup` is asked for, whether the account already has encryption set up
 * (this session's view can lag, so Settings' Enable makes the same check). `retry` asks again;
 * `found` records a setup that a later check found.
 */
function useServerCheck(enabled: boolean): [ServerCheck, () => void, () => void] {
  const client = useMatrixClient();
  const [check, setCheck] = useState<ServerCheck>('checking');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    setCheck('checking');
    hasServerEncryptionSetup(client).then(
      (existing) => current && setCheck(existing ? 'existing' : 'none'),
      () => current && setCheck('failed')
    );
    return () => {
      current = false;
    };
  }, [client, enabled, attempt]);
  return [check, () => setAttempt((count) => count + 1), () => setCheck('existing')];
}

type OpenDialogProps = { dialog: RecoveryDialog; onChange: (dialog?: RecoveryDialog) => void };

/**
 * One open recovery flow. It stays mounted from the first dialog to the close, so the key it
 * works with, taken once from the state, and the reset confirmation outlive the dialog changes.
 */
function OpenRecoveryDialog({ dialog, onChange }: OpenDialogProps) {
  const { t } = useTranslation();
  const state = useRecoveryState();
  const [secretStorageKey, setSecretStorageKey] = useState<DefaultSecretStorageKey>();
  const [keepOpen, setKeepOpen] = useState(false);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [check, retry, foundExisting] = useServerCheck(dialog === 'setup');
  const close = () => onChange(undefined);

  // A Set up that sits open, as the start prompt leaves it, gives way once the account is set up
  // on another device meanwhile: this session's state turns locked (or ready), and the welcome
  // page offers Unlock. A running setup, its saved step and a confirmed reset stay.
  const setUpElsewhere = state.kind === 'locked' || state.kind === 'ready';
  useEffect(() => {
    if (dialog === 'setup' && setUpElsewhere && !resetConfirmed && !keepOpen) onChange(undefined);
  }, [dialog, setUpElsewhere, resetConfirmed, keepOpen, onChange]);

  // Unlocking moves the state from locked to ready, and a read can fall back to unknown, so the
  // last key a state carried is kept; a key replaced on another device (a changed password)
  // takes its place, or the new password would be checked against the old key.
  const stateKey = keyOf(state);
  if (stateKey && stateKey.keyId !== secretStorageKey?.keyId) setSecretStorageKey(stateKey);

  // Continue asks the server again unless the person has just confirmed replacing the setup.
  const setup = (
    <DeviceVerificationSetup
      confirmFresh={!resetConfirmed}
      onExistingSetup={foundExisting}
      onCancel={close}
      onKeepOpenChange={setKeepOpen}
    />
  );
  let content;
  if (dialog === 'unlock' || dialog === 'change') {
    if (!secretStorageKey) return null;
    content =
      dialog === 'unlock' ? (
        <RecoveryUnlockDialog
          secretStorageKey={secretStorageKey}
          onClose={close}
          onForgot={() => onChange('reset')}
          onSetPassword={() => onChange('change')}
        />
      ) : (
        <ChangeRecoveryPassword
          secretStorageKey={secretStorageKey}
          askCurrent={false}
          onClose={close}
          onKeepOpenChange={setKeepOpen}
        />
      );
  } else if (dialog === 'reset') {
    content = resetConfirmed ? (
      setup
    ) : (
      <ResetVerificationDialog onReset={() => setResetConfirmed(true)} onCancel={close} />
    );
  } else if (check === 'checking') {
    // The overlay stays mounted while the check runs: unmounting it would close the dialog.
    content = (
      <SecurityDialog title={t(`${KEY}.setupTitle`)} onClose={close}>
        <Spinner size="400" variant="Secondary" />
      </SecurityDialog>
    );
  } else if (check === 'failed') {
    content = (
      <SecurityDialog title={t(`${KEY}.setupTitle`)} onClose={close}>
        <Text as="p" size="T300" role="alert" style={{ margin: 0 }}>
          {t(`${KEY}.setupCheckFailed`)}
        </Text>
        <Button onClick={retry} fill="Solid" variant="Primary">
          <Text size="B400">{t('sharedUi.partUnavailable.retry')}</Text>
        </Button>
      </SecurityDialog>
    );
  } else if (check === 'existing' && !resetConfirmed) {
    content = <ResetVerificationDialog onReset={() => setResetConfirmed(true)} onCancel={close} />;
  } else {
    content = setup;
  }

  return (
    <SecurityOverlay onClose={close} dismissible={!keepOpen}>
      {content}
    </SecurityOverlay>
  );
}

/** Shows the recovery dialog that `recoveryDialogAtom` names, from anywhere in the app. */
export function RecoveryDialogRenderer() {
  const [dialog, setDialog] = useAtom(recoveryDialogAtom);
  return dialog ? <OpenRecoveryDialog dialog={dialog} onChange={setDialog} /> : null;
}
