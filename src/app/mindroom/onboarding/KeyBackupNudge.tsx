import React, { useState } from 'react';
import { Box, Button, Icon, IconButton, Icons, Text, color } from 'folds';
import { CryptoApi } from 'matrix-js-sdk/lib/crypto-api';
import { useSetAtom } from 'jotai';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useKeyBackupInfo } from '../../hooks/useKeyBackup';
import { settingsModalAtom } from '../../state/settingsModal';
import { SettingsPages } from '../../features/settings/settingsPages';
import { dismissKeyBackupNudge, readKeyBackupNudgeDismissed } from './keyBackupNudge';

function KeyBackupNudgeCard({ crypto }: { crypto: CryptoApi }) {
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const [dismissed, setDismissed] = useState(() => readKeyBackupNudgeDismissed(userId));
  const backupInfo = useKeyBackupInfo(crypto);

  // Only nudge once the server has confirmed there is no backup (`null`).
  // `undefined` means the lookup is still in flight; an object means a backup
  // already exists, so there is nothing to set up.
  if (dismissed || backupInfo !== null) return null;

  const openSecuritySettings = () => setSettingsModal({ initialPage: SettingsPages.DevicesPage });
  const onDismiss = () => {
    dismissKeyBackupNudge(userId);
    setDismissed(true);
  };

  return (
    <Box
      direction="Column"
      gap="200"
      style={{
        border: '1px solid rgba(125, 125, 125, 0.28)',
        borderRadius: '8px',
        padding: '12px',
        textAlign: 'left',
      }}
    >
      <Box alignItems="Center" gap="200">
        <Icon size="100" src={Icons.ShieldLock} style={{ color: color.Success.Main }} />
        <Text as="span" size="L400">
          Back up your encrypted history
        </Text>
        <Box grow="Yes" />
        <IconButton
          size="300"
          variant="Background"
          aria-label="Dismiss backup reminder"
          onClick={onDismiss}
        >
          <Icon size="100" src={Icons.Cross} />
        </IconButton>
      </Box>
      <Text as="span" size="T200" priority="300">
        Set up secure backup so you can still read your encrypted agent chats after signing in on a
        new device.
      </Text>
      <Button
        aria-label="Set up secure key backup"
        fill="Soft"
        onClick={openSecuritySettings}
        before={<Icon size="200" src={Icons.ShieldLock} />}
        style={{ justifyContent: 'flex-start' }}
      >
        <Text as="span" size="B300">
          Set up backup
        </Text>
      </Button>
    </Box>
  );
}

/**
 * First-run onboarding nudge that steers a user into secure key backup so a new
 * device login can still read their encrypted agent history. Renders nothing
 * without crypto, when a backup already exists, or after the user dismisses it.
 */
export function KeyBackupNudge() {
  const mx = useMatrixClient();
  const crypto = mx.getCrypto();
  if (!crypto) return null;

  // Key by user id so the per-account dismissal state (read once on mount) is
  // re-evaluated if the active session changes without a full unmount.
  return <KeyBackupNudgeCard key={mx.getSafeUserId()} crypto={crypto} />;
}
