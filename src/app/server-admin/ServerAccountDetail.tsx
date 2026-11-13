import { useEffect, useState } from 'react';
import { Box, Button, Spinner, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useAlive } from '../lib/hooks/useAlive';
import { describeError } from '../lib/describeError';
import { timeDayMonthYear } from '../lib/time';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { ActionDialog } from '../ui/ActionDialog';
import { ErrorDetail } from '../ui/ErrorDetail';
import { SettingTile } from '../ui/SettingTile';
import { SettingsCard } from '../ui/settings/SettingsCard';
import { AccountBadges } from './AccountBadges';
import {
  accountActions,
  getServerAccount,
  listAccountRooms,
  runAccountAction,
  type AccountAction,
  type AccountRoom,
  type ServerAccount,
} from './serverAccounts';

type ConfirmActionProps = {
  userId: string;
  action: AccountAction;
  onClose: () => void;
  /** Called after the server took the action. */
  onDone: () => void;
};

/** Asks before an action, naming the account; it stays open with the error when the server refuses. */
function ConfirmAction({ userId, action, onClose, onDone }: ConfirmActionProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const alive = useAlive();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const label = t(`serverAccounts.actions.${action}`);

  const run = () => {
    setBusy(true);
    setError(undefined);
    runAccountAction(mx, userId, action).then(
      () => alive() && onDone(),
      (reason: unknown) => {
        if (!alive()) return;
        setError(reason ?? new Error('unknown'));
        setBusy(false);
      }
    );
  };

  return (
    <ActionDialog label={label} onClose={onClose} busy={busy}>
      <Text size="T300">{t(`serverAccounts.confirm.${action}`, { user: userId })}</Text>
      {error !== undefined && (
        <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
          {describeError(t, error)}
          <ErrorDetail error={error} />
        </Text>
      )}
      <Box justifyContent="End" gap="200">
        <Button
          type="button"
          size="300"
          variant="Secondary"
          fill="Soft"
          radii="300"
          disabled={busy}
          onClick={onClose}
        >
          <Text size="B300">{t('threadActions.cancel')}</Text>
        </Button>
        <Button
          type="button"
          size="300"
          variant={action === 'deactivate' ? 'Critical' : 'Primary'}
          radii="300"
          disabled={busy}
          data-confirm-action={action}
          onClick={run}
        >
          <Text size="B300">{label}</Text>
        </Button>
      </Box>
    </ActionDialog>
  );
}

type ServerAccountDetailProps = {
  /** The account as the list has it. */
  account: ServerAccount;
  onBack: () => void;
  /** Called after an action changed the account, so the list reads it again. */
  onChanged: () => void;
};

type Loaded = {
  /** The account's details; unset while they load or when the server did not give them. */
  details?: ServerAccount;
  detailsError?: unknown;
  /** Unset while they load or when the server did not list them. */
  rooms?: AccountRoom[];
  roomsFailed?: boolean;
};

/** One account: its state, the rooms it is in, and what the administrator may do to it. */
export function ServerAccountDetail({ account, onBack, onChanged }: ServerAccountDetailProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const language = useAppLanguageCode();
  const { userId } = account;
  const [loaded, setLoaded] = useState<Loaded>({});
  const [version, setVersion] = useState(0);
  const [confirming, setConfirming] = useState<AccountAction>();

  useEffect(() => {
    let current = true;
    getServerAccount(mx, userId).then(
      (details) => current && setLoaded((previous) => ({ ...previous, details })),
      (reason: unknown) =>
        current &&
        setLoaded((previous) => ({ ...previous, detailsError: reason ?? new Error('unknown') }))
    );
    listAccountRooms(mx, userId).then(
      (rooms) => current && setLoaded((previous) => ({ ...previous, rooms, roomsFailed: false })),
      () => current && setLoaded((previous) => ({ ...previous, roomsFailed: true }))
    );
    return () => {
      current = false;
    };
  }, [mx, userId, version]);

  const { details, detailsError, rooms, roomsFailed } = loaded;
  const shown = details ?? account;
  // The details say whether the account is suspended, so the actions wait for them.
  const actions = details ? accountActions(details, mx.getUserId()) : [];
  const isProtected = details !== undefined && !details.deactivated && actions.length === 0;

  return (
    <Box direction="Column" gap="500">
      <Box>
        <Button size="300" variant="Secondary" fill="Soft" radii="300" onClick={onBack}>
          <Text size="B300">{t('thread.back')}</Text>
        </Button>
      </Box>
      <Box direction="Column" gap="100">
        <Text size="L400" data-settings-heading="">
          {shown.displayName ?? userId}
        </Text>
        <SettingsCard>
          <SettingTile
            title={userId}
            description={
              shown.lastSeenTs !== undefined &&
              t('serverAccounts.lastSeen', { date: timeDayMonthYear(shown.lastSeenTs, language) })
            }
            after={<AccountBadges account={shown} showActive={details !== undefined} />}
          >
            {shown.external && (
              <Text size="T200" priority="300">
                {t('serverAccounts.externalNote')}
              </Text>
            )}
            {detailsError !== undefined && (
              <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
                {describeError(t, detailsError)}
              </Text>
            )}
          </SettingTile>
        </SettingsCard>
      </Box>
      <Box direction="Column" gap="100">
        <Text size="L400" data-settings-heading="">
          {t('nav.rooms')}
        </Text>
        <SettingsCard>
          {!rooms && !roomsFailed && <Spinner size="200" />}
          {roomsFailed && <SettingTile title={t('serverAccounts.roomsFailed')} />}
          {rooms?.length === 0 && <SettingTile title={t('serverAccounts.noRooms')} />}
          {rooms?.map(({ roomId, name }) => (
            <SettingTile
              key={roomId}
              title={name}
              description={name === roomId ? undefined : roomId}
            />
          ))}
        </SettingsCard>
      </Box>
      {(actions.length > 0 || isProtected) && (
        <Box direction="Column" gap="100">
          <Text size="L400" data-settings-heading="">
            {t('commandPalette.sections.actions')}
          </Text>
          <SettingsCard>
            {isProtected && <SettingTile title={t('serverAccounts.protected')} />}
            <Box gap="200" wrap="Wrap">
              {actions.map((action) => (
                <Button
                  key={action}
                  size="300"
                  variant={action === 'deactivate' ? 'Critical' : 'Secondary'}
                  fill="Soft"
                  radii="300"
                  data-account-action={action}
                  onClick={() => setConfirming(action)}
                >
                  <Text size="B300">{t(`serverAccounts.actions.${action}`)}</Text>
                </Button>
              ))}
            </Box>
          </SettingsCard>
        </Box>
      )}
      {confirming && (
        <ConfirmAction
          userId={userId}
          action={confirming}
          onClose={() => setConfirming(undefined)}
          onDone={() => {
            setConfirming(undefined);
            setVersion((previous) => previous + 1);
            onChanged();
          }}
        />
      )}
    </Box>
  );
}
