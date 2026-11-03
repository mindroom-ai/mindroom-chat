import React from 'react';
import { Avatar, Box, Button, Icon, Icons, Spinner, Text, config } from 'folds';
import { useTranslation } from 'react-i18next';
import type { StoredSession } from '../../../state/sessions';
import { UserAvatar } from '../../../components/user-avatar';
import { nameInitials } from '../../../utils/common';

export type AccountSwitcherAccount = {
  session: StoredSession;
  active: boolean;
  displayName?: string;
  avatarUrl?: string;
};

type AccountSwitcherProps = {
  accounts: AccountSwitcherAccount[];
  /** The session being switched to or removed, while that runs. */
  busySessionId?: string;
  /** Why the last switch or removal failed. */
  error?: string;
  onOpenSettings: () => void;
  onSwitchAccount: (session: StoredSession) => void;
  onRemoveAccount: (session: StoredSession) => void;
  onAddAccount?: () => void;
  onClose: () => void;
};

/** The actions under an account all share one compact button shape. */
const rowActionProps = { size: '300', radii: '300' } as const;

function AccountRow({
  account,
  busy,
  onOpenSettings,
  onSwitchAccount,
  onRemoveAccount,
}: {
  account: AccountSwitcherAccount;
  busy: boolean;
  onOpenSettings: () => void;
  onSwitchAccount: (session: StoredSession) => void;
  onRemoveAccount: (session: StoredSession) => void;
}) {
  const { t } = useTranslation();
  const { session, active, displayName, avatarUrl } = account;
  const name = displayName ?? session.userId;

  return (
    <Box
      direction="Column"
      gap="200"
      style={{ padding: config.space.S300, borderRadius: config.radii.R400 }}
    >
      <Box gap="300" alignItems="Center">
        <Avatar size="300" radii="Pill">
          <UserAvatar
            userId={session.userId}
            alt={name}
            src={avatarUrl}
            renderFallback={() => <Text size="H6">{nameInitials(name)}</Text>}
          />
        </Avatar>
        <Box direction="Column" grow="Yes" style={{ minWidth: 0 }}>
          <Text size="T300" truncate>
            {name}
          </Text>
          <Text size="T200" priority="300" truncate>
            {session.userId}
          </Text>
        </Box>
        {active && <Icon size="100" src={Icons.Check} aria-label={t('accountSwitcher.active')} />}
      </Box>
      <Box gap="200" wrap="Wrap">
        {active ? (
          <Button {...rowActionProps} variant="Secondary" fill="Soft" onClick={onOpenSettings}>
            <Text size="B300">{t('accountSwitcher.openSettings')}</Text>
          </Button>
        ) : (
          <>
            <Button
              {...rowActionProps}
              variant="Primary"
              fill="Soft"
              disabled={busy}
              onClick={() => onSwitchAccount(session)}
            >
              {busy ? (
                <Spinner size="100" />
              ) : (
                <Text size="B300">{t('accountSwitcher.switch')}</Text>
              )}
            </Button>
            <Button
              {...rowActionProps}
              variant="Critical"
              fill="None"
              disabled={busy}
              onClick={() => onRemoveAccount(session)}
            >
              <Text size="B300">{t('accountSwitcher.removeFromDevice')}</Text>
            </Button>
          </>
        )}
      </Box>
    </Box>
  );
}

/** The accounts signed in on this device: switch, remove, or add one. */
export function AccountSwitcher({
  accounts,
  busySessionId,
  error,
  onOpenSettings,
  onSwitchAccount,
  onRemoveAccount,
  onAddAccount,
  onClose,
}: AccountSwitcherProps) {
  const { t } = useTranslation();
  return (
    <Box direction="Column" gap="200" style={{ padding: config.space.S400 }}>
      <Text size="H4">{t('accountSwitcher.title')}</Text>
      <Text size="T300" priority="300">
        {t('accountSwitcher.description')}
      </Text>
      {error && (
        <Text size="T200" role="alert">
          {error}
        </Text>
      )}
      {accounts.map((account) => (
        <AccountRow
          key={account.session.sessionId}
          account={account}
          busy={busySessionId === account.session.sessionId}
          onOpenSettings={onOpenSettings}
          onSwitchAccount={onSwitchAccount}
          onRemoveAccount={onRemoveAccount}
        />
      ))}
      <Box gap="200" justifyContent="End">
        {onAddAccount && (
          <Button size="300" variant="Primary" radii="300" onClick={onAddAccount}>
            <Text size="B300">{t('accountSwitcher.addAccount')}</Text>
          </Button>
        )}
        <Button size="300" variant="Secondary" fill="Soft" radii="300" onClick={onClose}>
          <Text size="B300">{t('accountSwitcher.close')}</Text>
        </Button>
      </Box>
    </Box>
  );
}
