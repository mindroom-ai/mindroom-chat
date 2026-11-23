import { useTranslation } from 'react-i18next';
import { Icons } from 'folds';
import { useSetAtom } from 'jotai';
import { useClientConfig } from '../../config/useClientConfig';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { recoveryDialogAtom } from '../encryption/recoveryDialog';
import { useRecoveryState } from '../encryption/recoveryState';
import { WelcomeNotice } from './WelcomeNotice';

function KeyBackupNudgeRow() {
  const { t } = useTranslation();
  const setRecoveryDialog = useSetAtom(recoveryDialogAtom);
  const state = useRecoveryState();

  // Only an account with nothing set up is nudged; while a fact is still being read the state is
  // `unknown`, so a network hiccup at mount never nags an account that is already protected.
  if (state.kind !== 'none') return null;

  return (
    <WelcomeNotice
      icon={Icons.Shield}
      action={t('home.recovery.action')}
      onAction={() => setRecoveryDialog('setup')}
      text={t('home.recovery.text')}
    />
  );
}

/**
 * First-run onboarding nudge that steers a user into a recovery password so a new device login
 * can still read their encrypted history. Renders nothing when room encryption is disabled by
 * policy, without crypto, or once the account has any recovery set up.
 */
export function KeyBackupNudge() {
  const mx = useMatrixClient();
  const { createRoom } = useClientConfig();
  const crypto = mx.getCrypto();
  const encryptionDisabled =
    createRoom?.showEncryptionOption === false && createRoom?.defaultEncryption === false;

  if (encryptionDisabled || !crypto) return null;

  return <KeyBackupNudgeRow />;
}
