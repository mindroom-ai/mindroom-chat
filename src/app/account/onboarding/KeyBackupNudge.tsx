import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, Icons, Text, color } from 'folds';
import { useSetAtom } from 'jotai';
import { useClientConfig } from '../../config/useClientConfig';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { recoveryDialogAtom } from '../encryption/recoveryDialog';
import { useRecoveryState } from '../encryption/recoveryState';
import { WelcomeCardStyle } from './welcomeCard';

const KEY = 'sharedUi.recoveryPassword';

function KeyBackupNudgeCard() {
  const { t } = useTranslation();
  const setRecoveryDialog = useSetAtom(recoveryDialogAtom);
  const state = useRecoveryState();

  // Only an account with nothing set up is nudged; while a fact is still being read the state is
  // `unknown`, so a network hiccup at mount never nags an account that is already protected.
  if (state.kind !== 'none') return null;

  return (
    <Box direction="Column" gap="200" style={WelcomeCardStyle}>
      <Box alignItems="Center" gap="200">
        <Icon size="100" src={Icons.ShieldLock} style={{ color: color.Success.Main }} />
        <Text as="span" size="L400">
          {t(`${KEY}.nudgeTitle`)}
        </Text>
      </Box>
      <Text as="span" size="T200" priority="300">
        {t(`${KEY}.nudgeBody`)}
      </Text>
      <Button
        fill="Soft"
        onClick={() => setRecoveryDialog('setup')}
        before={<Icon size="200" src={Icons.ShieldLock} />}
        style={{ justifyContent: 'flex-start' }}
        outlined
        radii="300"
      >
        <Text as="span" size="B300">
          {t(`${KEY}.nudgeButton`)}
        </Text>
      </Button>
    </Box>
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

  return <KeyBackupNudgeCard />;
}
