import React from 'react';
import { Avatar, Box, Button, Icon, Icons, Spinner, Text, config } from 'folds';
import { StoredSession } from '../../../state/sessions';
import { UserAvatar } from '../../../components/user-avatar';
import { nameInitials } from '../../../utils/common';

export type AccountSwitcherItem = {
  session: StoredSession;
  active: boolean;
  displayName: string;
  avatarUrl?: string;
};

type AccountSwitcherProps = {
  accounts: AccountSwitcherItem[];
  removingSessionId?: string;
  onOpenSettings: () => void;
  onSwitchAccount: (session: StoredSession) => void;
  onRemoveAccount: (session: StoredSession) => void;
  onAddAccount: () => void;
  onClose: () => void;
};

export function AccountSwitcher({
  accounts,
  removingSessionId,
  onOpenSettings,
  onSwitchAccount,
  onRemoveAccount,
  onAddAccount,
  onClose,
}: AccountSwitcherProps) {
  return (
    <Box direction="Column" gap="300" style={{ padding: config.space.S400 }}>
      <Box direction="Column" gap="100">
        <Text size="H4">Accounts</Text>
        <Text size="T200">Switch accounts, add another account, or remove an inactive one.</Text>
      </Box>

      <Box direction="Column" gap="200">
        {accounts.map(({ session, active, displayName, avatarUrl }) => {
          const removing = removingSessionId === session.sessionId;

          return (
            <Box
              key={session.sessionId}
              direction="Column"
              gap="200"
              style={{
                padding: config.space.S300,
                borderRadius: config.radii.R400,
              }}
            >
              <Box alignItems="Center" gap="300">
                <Avatar size="300" radii="300">
                  <UserAvatar
                    userId={session.userId}
                    src={avatarUrl}
                    renderFallback={() => <Text size="H6">{nameInitials(displayName)}</Text>}
                  />
                </Avatar>
                <Box direction="Column" grow="Yes" gap="100">
                  <Text size="H5" truncate>
                    {displayName}
                  </Text>
                  <Text size="T200" truncate>
                    {session.userId}
                  </Text>
                </Box>
                {active && (
                  <Box alignItems="Center" gap="100">
                    <Icon size="100" src={Icons.Check} />
                    <Text size="T200">Active</Text>
                  </Box>
                )}
              </Box>

              <Box gap="200" wrap="Wrap">
                {active ? (
                  <Button size="300" radii="300" onClick={onOpenSettings}>
                    <Text size="B300">Open Settings</Text>
                  </Button>
                ) : (
                  <>
                    <Button
                      size="300"
                      radii="300"
                      onClick={() => onSwitchAccount(session)}
                      disabled={removing}
                    >
                      <Text size="B300">Switch</Text>
                    </Button>
                    <Button
                      size="300"
                      radii="300"
                      variant="Critical"
                      fill="None"
                      onClick={() => onRemoveAccount(session)}
                      disabled={removing}
                    >
                      <Text size="B300">
                        {removing ? 'Removing...' : 'Remove from Device'}
                      </Text>
                    </Button>
                    {removing && <Spinner variant="Secondary" size="200" />}
                  </>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box gap="200" wrap="Wrap">
        <Button size="300" radii="300" onClick={onAddAccount}>
          <Text size="B300">Add Account</Text>
        </Button>
        <Button size="300" radii="300" fill="None" onClick={onClose}>
          <Text size="B300">Close</Text>
        </Button>
      </Box>
    </Box>
  );
}
