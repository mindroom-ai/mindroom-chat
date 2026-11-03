import React, { CSSProperties, forwardRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, Icons, Spinner, Text, color, config } from 'folds';
import type { MatrixClient } from 'matrix-js-sdk';
import { Dialog, Header, IconButton } from './glass/GlassPrimitives';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { useAlive } from '../hooks/useAlive';
import { logoutClient } from '../../client/initMatrix';
import { ContainerColor } from '../styles/ContainerColor.css';

type EncryptionRisk = 'none' | 'unverified-device' | 'no-verification';

/**
 * What logging out costs this device: messages it alone can decrypt are lost when cross-signing
 * is not set up, or when this device is not verified and so holds keys nobody else has.
 */
const getEncryptionRisk = async (client: MatrixClient): Promise<EncryptionRisk> => {
  const crypto = client.getCrypto();
  const userId = client.getUserId();
  const deviceId = client.getDeviceId();
  if (!crypto || !userId || !deviceId) return 'none';
  if (!(await crypto.isCrossSigningReady())) return 'no-verification';
  const status = await crypto.getDeviceVerificationStatus(userId, deviceId);
  return status?.crossSigningVerified ? 'none' : 'unverified-device';
};

type LogoutDialogProps = { handleClose: () => void };

const RISK_PANEL_SHAPE: CSSProperties = {
  borderRadius: config.radii.R400,
  padding: config.space.S300,
};

/**
 * Confirms logging out, warning first when this device holds the only copy of message keys.
 * The ref reaches the dialog element, so a focus trap around it knows what counts as inside.
 */
export const LogoutDialog = forwardRef<HTMLDivElement, LogoutDialogProps>(function LogoutDialog(
  { handleClose },
  ref
) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const [risk, setRisk] = useState<EncryptionRisk>('none');
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let current = true;
    getEncryptionRisk(client).then(
      (next) => {
        if (current) setRisk(next);
      },
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [client]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setError(undefined);
    try {
      await logoutClient(client);
    } catch (logoutError) {
      if (!alive()) return;
      const message = logoutError instanceof Error ? logoutError.message : String(logoutError);
      setError(t('sharedUi.logoutDialog.logoutFailed', { error: message }));
      setLoggingOut(false);
    }
  };

  return (
    <Dialog ref={ref} role="dialog" aria-labelledby="logout-dialog-title" variant="Surface">
      <Header size="500" style={{ padding: `0 ${config.space.S200} 0 ${config.space.S400}` }}>
        <Box grow="Yes">
          <Text id="logout-dialog-title" size="H4">
            {t('sharedUi.logoutDialog.logout')}
          </Text>
        </Box>
        <IconButton
          size="300"
          radii="300"
          onClick={handleClose}
          aria-label={t('sharedUi.logoutDialog.cancel')}
        >
          <Icon src={Icons.Cross} />
        </IconButton>
      </Header>
      <Box direction="Column" gap="400" style={{ padding: config.space.S400, paddingTop: 0 }}>
        {risk !== 'none' && (
          <Box
            className={ContainerColor({ variant: 'Warning' })}
            style={RISK_PANEL_SHAPE}
            gap="100"
            direction="Column"
          >
            <Box alignItems="Center" gap="200">
              <Icon size="100" src={Icons.Warning} filled />
              <Text size="L400">
                {risk === 'unverified-device'
                  ? t('sharedUi.logoutDialog.unverifiedDevice')
                  : t('sharedUi.logoutDialog.alert')}
              </Text>
            </Box>
            <Text size="T200">
              {risk === 'unverified-device'
                ? t(
                    'sharedUi.logoutDialog.verifyYourDeviceBeforeLoggingOutToSaveYourEncryptedMessages'
                  )
                : t(
                    'sharedUi.logoutDialog.enableDeviceVerificationOrExportYourEncryptedDataFromSettingsToAvoid'
                  )}
            </Text>
          </Box>
        )}
        <Text priority="400">{t('sharedUi.logoutDialog.youReAboutToLogOutAreYouSure')}</Text>
        {error && (
          <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
            <b>{error}</b>
          </Text>
        )}
        <Box direction="Column" gap="200">
          <Button
            variant="Critical"
            onClick={handleLogout}
            disabled={loggingOut}
            before={loggingOut ? <Spinner variant="Critical" fill="Solid" size="200" /> : undefined}
          >
            <Text size="B400">{t('sharedUi.logoutDialog.logout')}</Text>
          </Button>
          <Button variant="Secondary" fill="Soft" onClick={handleClose} disabled={loggingOut}>
            <Text size="B400">{t('sharedUi.logoutDialog.cancel')}</Text>
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
});
