import { CSSProperties, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FileSaver from 'file-saver';
import { Box, Button, Checkbox, Chip, Icon, Icons, Text, config } from 'folds';
import { copyToClipboard } from '../../lib/dom';
import { ContainerColor } from '../../ui/styles/ContainerColor.css';

const RECOVERY_KEY_BOX_STYLE: CSSProperties = {
  padding: config.space.S300,
  border: `${config.borderWidth.B300} solid var(--mr-container-line)`,
  borderRadius: config.radii.R400,
  // The key wraps between its groups of four, never inside one.
  overflowWrap: 'break-word',
};

type RecoveryKeyForOtherAppsProps = { recoveryKey: string };

function RecoveryKeyForOtherApps({ recoveryKey }: RecoveryKeyForOtherAppsProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(recoveryKey).then(
      (ok) => setCopied(ok),
      () => undefined
    );
  };
  const handleDownload = () => {
    const blob = new Blob([recoveryKey], { type: 'text/plain;charset=us-ascii' });
    FileSaver.saveAs(blob, 'recovery-key.txt');
  };

  return (
    <>
      <Box className={ContainerColor({ variant: 'SurfaceVariant' })} style={RECOVERY_KEY_BOX_STYLE}>
        <Text as="code" size="T300">
          {recoveryKey}
        </Text>
      </Box>
      <Box gap="200" wrap="Wrap">
        <Chip
          variant="Secondary"
          radii="Pill"
          onClick={handleCopy}
          after={copied ? <Icon size="50" src={Icons.Check} /> : undefined}
        >
          <Text size="B300">{t('sharedUi.deviceVerificationSetup.copy')}</Text>
        </Chip>
        <Chip variant="Secondary" radii="Pill" onClick={handleDownload}>
          <Text size="B300">{t('sharedUi.deviceVerificationSetup.download')}</Text>
        </Chip>
      </Box>
    </>
  );
}

/** `recoveryKey` is the encoded key, kept behind a toggle for other apps. */
type RecoverySavedStepProps = { recoveryKey: string; onDone: () => void };

/** Asks for the recovery password to be written down; Done waits for the person to say so. */
export function RecoverySavedStep({ recoveryKey, onDone }: RecoverySavedStepProps) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  const [keyShown, setKeyShown] = useState(false);

  return (
    <Box direction="Column" gap="400">
      <Text size="T300">{t('sharedUi.recoveryPassword.savedIntro')}</Text>
      <Box as="label" alignItems="Center" gap="200">
        <Checkbox
          variant="Primary"
          size="200"
          checked={saved}
          // folds leaves onChange out of its Checkbox type; the click toggles the choice.
          readOnly
          onClick={() => setSaved((current) => !current)}
        />
        <Text size="T300">{t('sharedUi.recoveryPassword.savedCheckbox')}</Text>
      </Box>
      <Box direction="Column" gap="200">
        <Button
          type="button"
          size="300"
          variant="Secondary"
          fill="None"
          aria-expanded={keyShown}
          onClick={() => setKeyShown((shown) => !shown)}
        >
          <Text size="B300">{t('sharedUi.recoveryPassword.keyToggle')}</Text>
        </Button>
        {keyShown && <RecoveryKeyForOtherApps recoveryKey={recoveryKey} />}
      </Box>
      <Button variant="Primary" disabled={!saved} onClick={onDone}>
        <Text size="B400">{t('sharedUi.recoveryPassword.done')}</Text>
      </Button>
    </Box>
  );
}
