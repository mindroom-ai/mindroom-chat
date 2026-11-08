import { Trans, useTranslation } from 'react-i18next';
import { Button, Text, color } from 'folds';
import { SecurityDialog } from './SecurityDialog';

const KEY = 'sharedUi.deviceVerificationSetup';
const EMPHASIS = { b: <b /> };

type ResetVerificationDialogProps = {
  onReset: () => void;
  onCancel: () => void;
};

/**
 * Asks before replacing the account's cross-signing keys, secret storage and key backup. Every
 * verification made with the old keys stops counting, so the warning says who will notice.
 */
export function ResetVerificationDialog({ onReset, onCancel }: ResetVerificationDialogProps) {
  const { t } = useTranslation();
  return (
    <SecurityDialog
      role="alertdialog"
      title={t(`${KEY}.resetDeviceVerification`)}
      onClose={onCancel}
    >
      <Text as="p" size="T300" style={{ color: color.Critical.Main, margin: 0 }}>
        <b>{t(`${KEY}.resettingDeviceVerificationIsPermanent`)}</b>
      </Text>
      <Text as="p" size="T300" style={{ margin: 0 }}>
        <Trans i18nKey={`${KEY}.resetWarning`} components={EMPHASIS} />
      </Text>
      <Text as="p" size="T300" style={{ margin: 0 }}>
        {t('sharedUi.recoveryPassword.resetLoss')}
      </Text>
      <Button onClick={onReset} fill="Solid" variant="Critical">
        <Text size="B400">{t(`${KEY}.reset`)}</Text>
      </Button>
    </SecurityDialog>
  );
}
