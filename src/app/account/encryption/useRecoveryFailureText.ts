import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errorMessage';
import { describeKnownError } from '../../lib/describeError';
import { INVALID_RECOVERY_INPUT } from './recoveryInput';
import { BACKUP_ALREADY_EXISTS, BACKUP_NOT_IN_USE } from './turnOnKeyBackup';
import {
  CRYPTO_NOT_FOUND as CRYPTO_MODULE_NOT_FOUND,
  RECOVERY_KEY_FAILED,
  RECOVERY_SECRETS_NOT_CACHED,
  SECRET_STORAGE_INCOMPLETE,
} from './recoveryPassword';
import { CRYPTO_NOT_FOUND, NO_CROSS_SIGNING_KEYS_IN_SECRET_STORAGE } from './unlockWithRecoveryKey';

const KEY = 'sharedUi.recoveryPassword';

/**
 * Shows a failure of unlocking or changing the recovery password: its own errors as one
 * localized message, the ones `describeKnownError` recognizes in words with the error's text
 * beside them (`detailOf`), and any other error as thrown.
 */
export const useRecoveryFailureText = () => {
  const { t } = useTranslation();
  return (error: unknown): { text: string; detailOf?: unknown } => {
    const message = errorMessage(error);
    if (message === INVALID_RECOVERY_INPUT) return { text: t(`${KEY}.wrongInput`) };
    if (message === NO_CROSS_SIGNING_KEYS_IN_SECRET_STORAGE) {
      return { text: t('sharedUi.manualVerification.noCrossSigningKeys') };
    }
    if (message === RECOVERY_SECRETS_NOT_CACHED) return { text: t(`${KEY}.notCached`) };
    if (message === SECRET_STORAGE_INCOMPLETE) return { text: t(`${KEY}.incompleteError`) };
    if (message === BACKUP_ALREADY_EXISTS) return { text: t(`${KEY}.backupExists`) };
    if (
      message === CRYPTO_NOT_FOUND ||
      message === CRYPTO_MODULE_NOT_FOUND ||
      message === RECOVERY_KEY_FAILED ||
      message === BACKUP_NOT_IN_USE
    ) {
      return { text: t('sharedUi.deviceVerificationSetup.unexpectedError') };
    }
    const known = describeKnownError(t, error);
    return known === undefined ? { text: message } : { text: known, detailOf: error };
  };
};
